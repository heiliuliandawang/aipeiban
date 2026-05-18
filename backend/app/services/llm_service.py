"""
LLM 服务封装 —— 兼容讯飞星火 OpenAI SDK 接口
OpenAI 兼容 HTTP（与控制台里 Websocket 地址不同）：
  base_url 应为「根路径」，如 https://spark-api-open.xf-yun.com/v1 或 …/v2，不要带 /chat/completions。
  Ultra（32K）HTTP 模型名一般为 4.0Ultra（不是控制台展示名 Spark Ultra-32K）。

超时与日志：通过环境变量 LLM_HTTP_CONNECT_TIMEOUT / LLM_HTTP_READ_TIMEOUT 控制；
异常会打清类型与耗时，便于区分网络/TLS 问题与模型侧错误。

星火 QPS：错误码 11202 / AppIdQpsOverFlow 表示 AppId 维度 QPS 超限。chat_completion 内会做有限次退避重试
（SPARK_QPS_MAX_ATTEMPTS）；资源生成侧仍建议用 RESOURCE_LLM_CONCURRENCY 限制并发（见 resource_agent）。
"""
import asyncio
import logging
import os
import time
from typing import Any, AsyncGenerator

import httpx
from openai import APIConnectionError, APIError, APIStatusError, APITimeoutError, AsyncOpenAI

logger = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None


def _normalize_openai_base_url(raw: str) -> str:
    """OpenAI SDK 会自行请求 /chat/completions，base_url 若误带该后缀会导致路径错误。"""
    u = raw.strip().rstrip("/")
    if u.endswith("/chat/completions"):
        u = u[: -len("/chat/completions")].rstrip("/")
    return u or "https://spark-api-open.xf-yun.com/v2"


def _normalize_spark_model(raw: str) -> str:
    """将控制台展示名等映射为 HTTP 文档中的 model 取值。"""
    if not raw:
        return "spark-x"
    key = raw.strip().lower().replace(" ", "").replace("_", "-")
    # Spark 4.0 Ultra（32K）—— 官方 HTTP 参数为 4.0Ultra
    if key in ("sparkultra-32k", "4.0ultra", "sparkultra32k"):
        return "4.0Ultra"
    if "ultra-32k" in key or "ultra32k" in key or ("spark" in key and "ultra" in key):
        return "4.0Ultra"
    return raw.strip()


def _resolve_api_key() -> str:
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    if openai_key:
        return openai_key

    spark_api_key = os.getenv("SPARK_API_KEY", "").strip()
    spark_api_secret = os.getenv("SPARK_API_SECRET", "").strip()
    if spark_api_key and spark_api_secret:
        return f"{spark_api_key}:{spark_api_secret}"

    raise ValueError(
        "Missing Spark credentials. Set OPENAI_API_KEY to APIpassword or APIKey:APISecret, "
        "or provide both SPARK_API_KEY and SPARK_API_SECRET."
    )


def _client_timeout() -> httpx.Timeout:
    connect = float(os.getenv("LLM_HTTP_CONNECT_TIMEOUT", "20"))
    read = float(os.getenv("LLM_HTTP_READ_TIMEOUT", "240"))
    write = float(os.getenv("LLM_HTTP_WRITE_TIMEOUT", "60"))
    return httpx.Timeout(connect=connect, read=read, write=write, pool=10.0)


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        base_url = _normalize_openai_base_url(
            os.getenv("OPENAI_BASE_URL", "https://spark-api-open.xf-yun.com/v2")
        )
        _client = AsyncOpenAI(
            api_key=_resolve_api_key(),
            base_url=base_url,
            timeout=_client_timeout(),
            # 0 合法；若遇兼容问题可改为 2（与 SDK 默认一致）
            max_retries=int(os.getenv("LLM_HTTP_MAX_RETRIES", "2")),
        )
        logger.info(
            "LLM client init base_url=%s model=%s timeout_connect=%s read=%s",
            base_url,
            _normalize_spark_model(os.getenv("SPARK_MODEL", "spark-x").strip()),
            os.getenv("LLM_HTTP_CONNECT_TIMEOUT", "20"),
            os.getenv("LLM_HTTP_READ_TIMEOUT", "240"),
        )
    return _client


def _spark_model() -> str:
    return _normalize_spark_model(os.getenv("SPARK_MODEL", "spark-x").strip())


def _is_spark_qps_overflow(exc: BaseException) -> bool:
    """讯飞星火 QPS 超限：11202 / AppIdQpsOverFlowError 等。"""
    text = f"{exc!s}".lower()
    if "11202" in text or "appidqpsoverflow" in text or "qpsoverflow" in text:
        return True
    if isinstance(exc, APIStatusError):
        body: Any = exc.body
        if isinstance(body, dict):
            err = body.get("error")
            if isinstance(err, dict):
                code = str(err.get("code", ""))
                msg = str(err.get("message", "")).lower()
                if code == "11202" or "qps" in msg or "overflow" in msg:
                    return True
    return False


def _log_llm_failure(kind: str, elapsed: float, exc: BaseException) -> None:
    """区分常见失败类型，便于判断是网络还是模型。"""
    if isinstance(exc, APITimeoutError):
        logger.error(
            "[LLM] %s APITimeoutError after %.2fs — 读响应超时，多为模型生成慢或链路阻塞",
            kind,
            elapsed,
        )
        return
    if isinstance(exc, APIConnectionError):
        logger.error(
            "[LLM] %s APIConnectionError after %.2fs — 连接失败（DNS/TLS/代理/防火墙/服务不可达）: %s",
            kind,
            elapsed,
            exc,
        )
        return
    if isinstance(exc, APIStatusError):
        logger.error(
            "[LLM] %s APIStatusError after %.2fs — HTTP %s: %s body=%s",
            kind,
            elapsed,
            exc.status_code,
            exc.message,
            exc.body,
        )
        return
    if isinstance(exc, APIError):
        logger.error(
            "[LLM] %s APIError after %.2fs — message=%s body=%s",
            kind,
            elapsed,
            getattr(exc, "message", str(exc)),
            getattr(exc, "body", None),
        )
        return
    logger.exception("[LLM] %s unexpected error after %.2fs: %s", kind, elapsed, type(exc).__name__)


async def chat_completion(
    messages: list[dict],
    temperature: float = 0.7,
    max_tokens: int | None = None,
) -> str:
    """普通调用，返回完整字符串。遇星火 QPS 超限（11202）时自动退避重试。"""
    client = get_client()
    kwargs: dict = {
        "model": _spark_model(),
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens

    max_attempts = max(1, int(os.getenv("SPARK_QPS_MAX_ATTEMPTS", "6")))
    base_sleep = float(os.getenv("SPARK_QPS_RETRY_BASE_SEC", "1.0"))

    t0 = time.monotonic()
    for attempt in range(max_attempts):
        if attempt > 0:
            delay = min(base_sleep * (2 ** (attempt - 1)), 20.0)
            logger.warning(
                "[LLM] chat_completion QPS/可重试错误后等待 %.2fs（第 %s/%s 次）",
                delay,
                attempt + 1,
                max_attempts,
            )
            await asyncio.sleep(delay)
        try:
            resp = await client.chat.completions.create(**kwargs)
            elapsed = time.monotonic() - t0
            usage = getattr(resp, "usage", None)
            choices = getattr(resp, "choices", None) or []
            if not choices:
                try:
                    raw_preview = str(resp.model_dump())[:2000]
                except Exception:
                    raw_preview = repr(resp)[:2000]
                logger.error(
                    "[LLM] chat_completion empty choices model=%s elapsed=%.2fs snapshot=%s",
                    _spark_model(),
                    elapsed,
                    raw_preview,
                )
                raise ValueError("模型返回空 choices，请检查星火 OpenAI 兼容接口与 SPARK_MODEL 配置")
            msg = choices[0].message
            text = (getattr(msg, "content", None) or "") if msg is not None else ""
            logger.info(
                "[LLM] chat_completion ok model=%s elapsed=%.2fs usage=%s content_len=%s attempts=%s",
                _spark_model(),
                elapsed,
                usage,
                len(text),
                attempt + 1,
            )
            return text
        except APIStatusError as e:
            if _is_spark_qps_overflow(e) and attempt + 1 < max_attempts:
                logger.warning(
                    "[LLM] chat_completion 星火 QPS 超限，将重试: %s",
                    getattr(e, "message", str(e))[:300],
                )
                continue
            _log_llm_failure("chat_completion", time.monotonic() - t0, e)
            raise
        except (APITimeoutError, APIConnectionError, APIError, httpx.TimeoutException, httpx.HTTPError) as e:
            _log_llm_failure("chat_completion", time.monotonic() - t0, e)
            raise
        except Exception as e:
            _log_llm_failure("chat_completion", time.monotonic() - t0, e)
            raise


async def chat_stream(messages: list[dict], temperature: float = 0.7) -> AsyncGenerator[str, None]:
    """流式调用，逐 token yield"""
    client = get_client()
    t0 = time.monotonic()
    try:
        stream = await client.chat.completions.create(
            model=_spark_model(),
            messages=messages,
            temperature=temperature,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
        logger.info("[LLM] chat_stream finished model=%s elapsed=%.2fs", _spark_model(), time.monotonic() - t0)
    except (APITimeoutError, APIConnectionError, APIError, httpx.TimeoutException, httpx.HTTPError) as e:
        _log_llm_failure("chat_stream", time.monotonic() - t0, e)
        raise
    except Exception as e:
        _log_llm_failure("chat_stream", time.monotonic() - t0, e)
        raise
