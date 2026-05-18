"""
联网检索：优先 ddgs 多引擎回退，失败时用 Wikipedia Open API（均无需 Key）。
旧版 duckduckgo-search 默认走 Bing，国内常报 ConnectError / return None。
"""
import logging
import os
from typing import Any
import httpx

logger = logging.getLogger(__name__)

_DEFAULT_BACKENDS = ("mojeek", "brave", "duckduckgo", "yahoo")


def _normalize_item(raw: dict[str, Any]) -> dict[str, str] | None:
    title = (raw.get("title") or "").strip() or "无标题"
    url = (raw.get("href") or raw.get("link") or raw.get("url") or "").strip()
    snippet = (raw.get("body") or raw.get("snippet") or raw.get("description") or "").strip()
    if not url and not snippet:
        return None
    return {"title": title, "url": url, "snippet": snippet}


def _search_ddgs(query: str, max_results: int) -> list[dict[str, Any]]:
    try:
        from ddgs import DDGS
        from ddgs.exceptions import DDGSException
    except ImportError as e:
        raise ImportError(
            "未安装 ddgs，请在 backend 目录执行: pip install ddgs"
        ) from e

    backends_raw = os.getenv("WEB_SEARCH_BACKENDS", ",".join(_DEFAULT_BACKENDS))
    backends = [b.strip() for b in backends_raw.split(",") if b.strip()]

    last_err: Exception | None = None
    for backend in backends:
        try:
            collected: list[dict[str, Any]] = []
            with DDGS(timeout=int(os.getenv("WEB_SEARCH_TIMEOUT", "25"))) as ddgs:
                for item in ddgs.text(query, max_results=max_results, backend=backend):
                    if not item:
                        continue
                    norm = _normalize_item(item)
                    if norm:
                        collected.append(norm)
            if collected:
                logger.info(
                    "联网检索成功 backend=%s query=%s count=%s",
                    backend,
                    query[:80],
                    len(collected),
                )
                return collected[:max_results]
        except DDGSException as e:
            last_err = e
            logger.warning("ddgs backend=%s 无结果: %s", backend, str(e)[:200])
        except Exception as e:
            last_err = e
            logger.warning("ddgs backend=%s 失败: %s", backend, str(e)[:200])

    if last_err:
        raise last_err
    return []


def _search_wikipedia(query: str, max_results: int) -> list[dict[str, Any]]:
    """Wikipedia OpenSearch，教育类关键词较稳。"""
    results: list[dict[str, Any]] = []
    timeout = float(os.getenv("WEB_SEARCH_TIMEOUT", "25"))

    for lang in ("zh", "en"):
        if len(results) >= max_results:
            break
        api = f"https://{lang}.wikipedia.org/w/api.php"
        params = {
            "action": "opensearch",
            "search": query,
            "limit": max_results,
            "namespace": 0,
            "format": "json",
        }
        try:
            with httpx.Client(timeout=timeout, follow_redirects=True) as client:
                resp = client.get(api, params=params)
                resp.raise_for_status()
                data = resp.json()
            if not isinstance(data, list) or len(data) < 4:
                continue
            titles, descriptions, urls = data[1], data[2], data[3]
            for title, desc, url in zip(titles, descriptions, urls):
                if len(results) >= max_results:
                    break
                results.append(
                    {
                        "title": title or "Wikipedia",
                        "url": url or "",
                        "snippet": desc or f"维基百科词条：{title}",
                    }
                )
        except Exception as e:
            logger.warning("Wikipedia %s 检索失败: %s", lang, e)

    return results


def search_web(query: str, max_results: int = 8) -> list[dict[str, Any]]:
    q = query.strip()
    if not q:
        return []

    max_results = min(max(max_results, 1), 12)

    # 1) ddgs 多引擎
    try:
        hits = _search_ddgs(q, max_results)
        if hits:
            return hits
    except ImportError:
        raise
    except Exception as e:
        logger.warning("ddgs 全部引擎失败，尝试 Wikipedia: %s", str(e)[:300])

    # 2) Wikipedia 兜底
    wiki = _search_wikipedia(q, max_results)
    if wiki:
        logger.info("联网检索 Wikipedia 兜底成功 query=%s count=%s", q[:80], len(wiki))
        return wiki

    raise RuntimeError(
        "联网检索暂时不可用（外网搜索服务受限）。请稍后重试，或改用「本地课程」/「资源生成」。"
    )


async def _search_llm_reading_list(query: str, max_results: int) -> list[dict[str, Any]]:
    """外网检索不可用时，用星火生成推荐阅读（不编造具体 URL）。"""
    from app.services import llm_service

    n = min(max_results, 6)
    messages = [
        {
            "role": "system",
            "content": (
                "你是高等教育学习资源顾问。根据用户主题给出推荐阅读方向。"
                "不要编造无法验证的具体 URL。每条用一行，格式：标题 | 类型(书籍/课程/文档) | 一句话说明。"
            ),
        },
        {
            "role": "user",
            "content": f"请为「{query}」推荐 {n} 条中文学习资源或学习路径要点。",
        },
    ]
    text = await llm_service.chat_completion(messages, temperature=0.5, max_tokens=800)
    results: list[dict[str, Any]] = []
    for line in text.splitlines():
        line = line.strip().lstrip("-*0123456789. ")
        if not line or len(line) < 4:
            continue
        parts = [p.strip() for p in line.split("|")]
        title = parts[0] if parts else line
        snippet = parts[-1] if len(parts) > 1 else line
        results.append(
            {
                "title": title[:120],
                "url": "",
                "snippet": f"（AI 推荐，请自行在慕课/B站/教材平台检索）{snippet}",
            }
        )
        if len(results) >= n:
            break
    if not results and text.strip():
        results.append(
            {
                "title": f"关于「{query}」的学习建议",
                "url": "",
                "snippet": text.strip()[:500],
            }
        )
    return results


async def search_web_async(query: str, max_results: int = 8) -> list[dict[str, Any]]:
    """异步联网检索：先公网多引擎 + Wikipedia，失败则用星火推荐。"""
    import asyncio

    try:
        return await asyncio.to_thread(search_web, query, max_results)
    except Exception as e:
        logger.warning("公网检索失败，启用星火推荐阅读: %s", str(e)[:200])
        if os.getenv("WEB_SEARCH_LLM_FALLBACK", "1").strip().lower() in ("0", "false", "no"):
            raise
        return await _search_llm_reading_list(query, max_results)
