"""
联网检索（学习检索 Tab）

策略（WEB_SEARCH_STRATEGY，默认 fast）：
  fast     — 先 Wikipedia（中英文并行，通常 1–3s），够条数直接返回；
             否则最多 2 个 ddgs 引擎并行，单引擎超时 WEB_SEARCH_TIMEOUT（默认 10s）
  thorough — 旧逻辑：ddgs 多引擎顺序尝试，再 Wikipedia

失败时可选用星火推荐阅读（WEB_SEARCH_LLM_FALLBACK=1）。
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_BACKENDS = ("mojeek", "brave")
_CACHE_TTL_SEC = 300
_result_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def _timeout_sec() -> float:
    return float(os.getenv("WEB_SEARCH_TIMEOUT", "10"))


def _cache_key(query: str, max_results: int) -> str:
    return f"{query.strip().lower()}|{max_results}"


def _cache_get(query: str, max_results: int) -> list[dict[str, Any]] | None:
    key = _cache_key(query, max_results)
    entry = _result_cache.get(key)
    if not entry:
        return None
    ts, data = entry
    if time.monotonic() - ts > _CACHE_TTL_SEC:
        _result_cache.pop(key, None)
        return None
    logger.info("联网检索命中缓存 query=%s", query[:60])
    return list(data)


def _cache_set(query: str, max_results: int, data: list[dict[str, Any]]) -> None:
    if not data:
        return
    _result_cache[_cache_key(query, max_results)] = (time.monotonic(), list(data))


def _normalize_item(raw: dict[str, Any]) -> dict[str, str] | None:
    title = (raw.get("title") or "").strip() or "无标题"
    url = (raw.get("href") or raw.get("link") or raw.get("url") or "").strip()
    snippet = (raw.get("body") or raw.get("snippet") or raw.get("description") or "").strip()
    if not url and not snippet:
        return None
    return {"title": title, "url": url, "snippet": snippet}


def _merge_results(*groups: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for group in groups:
        for item in group:
            key = (item.get("url") or "").strip() or (item.get("title") or "")
            if key in seen:
                continue
            seen.add(key)
            out.append(item)
            if len(out) >= limit:
                return out
    return out


def _search_ddgs_one(query: str, max_results: int, backend: str) -> list[dict[str, Any]]:
    from ddgs import DDGS
    from ddgs.exceptions import DDGSException

    collected: list[dict[str, Any]] = []
    timeout = int(_timeout_sec())
    with DDGS(timeout=timeout) as ddgs:
        for item in ddgs.text(query, max_results=max_results, backend=backend):
            if not item:
                continue
            norm = _normalize_item(item)
            if norm:
                collected.append(norm)
    if collected:
        logger.info("ddgs 成功 backend=%s count=%s", backend, len(collected))
    return collected[:max_results]


def _search_ddgs_parallel(query: str, max_results: int) -> list[dict[str, Any]]:
    try:
        from ddgs.exceptions import DDGSException  # noqa: F401 — 确认已安装
    except ImportError as e:
        raise ImportError("未安装 ddgs，请在 backend 目录执行: pip install ddgs") from e

    backends_raw = os.getenv("WEB_SEARCH_BACKENDS", ",".join(_DEFAULT_BACKENDS))
    backends = [b.strip() for b in backends_raw.split(",") if b.strip()]
    max_parallel = max(1, min(int(os.getenv("WEB_SEARCH_PARALLEL", "2")), len(backends)))
    backends = backends[:max_parallel]

    timeout = _timeout_sec()
    last_err: Exception | None = None

    with ThreadPoolExecutor(max_workers=max_parallel) as pool:
        futures = {
            pool.submit(_search_ddgs_one, query, max_results, backend): backend
            for backend in backends
        }
        try:
            for future in as_completed(futures, timeout=timeout + 3):
                backend = futures[future]
                try:
                    hits = future.result()
                    if hits:
                        return hits
                except Exception as e:
                    last_err = e
                    logger.warning("ddgs backend=%s 失败: %s", backend, str(e)[:200])
        except TimeoutError:
            logger.warning("ddgs 并行检索总超时 %.0fs", timeout + 3)

    if last_err:
        raise last_err
    return []


def _search_ddgs_sequential(query: str, max_results: int) -> list[dict[str, Any]]:
    """thorough 模式：顺序尝试全部引擎。"""
    try:
        from ddgs import DDGS
        from ddgs.exceptions import DDGSException
    except ImportError as e:
        raise ImportError("未安装 ddgs，请在 backend 目录执行: pip install ddgs") from e

    backends_raw = os.getenv("WEB_SEARCH_BACKENDS", "mojeek,brave,duckduckgo,yahoo")
    backends = [b.strip() for b in backends_raw.split(",") if b.strip()]
    timeout = int(_timeout_sec())
    last_err: Exception | None = None

    for backend in backends:
        try:
            collected: list[dict[str, Any]] = []
            with DDGS(timeout=timeout) as ddgs:
                for item in ddgs.text(query, max_results=max_results, backend=backend):
                    if not item:
                        continue
                    norm = _normalize_item(item)
                    if norm:
                        collected.append(norm)
            if collected:
                logger.info("ddgs 成功 backend=%s count=%s", backend, len(collected))
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


async def _fetch_wikipedia_lang(
    client: httpx.AsyncClient, query: str, max_results: int, lang: str
) -> list[dict[str, Any]]:
    api = f"https://{lang}.wikipedia.org/w/api.php"
    params = {
        "action": "opensearch",
        "search": query,
        "limit": max_results,
        "namespace": 0,
        "format": "json",
    }
    resp = await client.get(api, params=params)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, list) or len(data) < 4:
        return []

    titles, descriptions, urls = data[1], data[2], data[3]
    results: list[dict[str, Any]] = []
    for title, desc, url in zip(titles, descriptions, urls):
        results.append(
            {
                "title": title or "Wikipedia",
                "url": url or "",
                "snippet": desc or f"维基百科词条：{title}",
            }
        )
    return results


async def _search_wikipedia_async(query: str, max_results: int) -> list[dict[str, Any]]:
    """中英文 Wikipedia 并行请求。"""
    timeout = _timeout_sec()
    results: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            parts = await asyncio.gather(
                _fetch_wikipedia_lang(client, query, max_results, "zh"),
                _fetch_wikipedia_lang(client, query, max_results, "en"),
                return_exceptions=True,
            )
        for part in parts:
            if isinstance(part, list):
                results = _merge_results(results, part, limit=max_results)
    except Exception as e:
        logger.warning("Wikipedia 异步检索失败: %s", e)
    return results[:max_results]


def _search_wikipedia_sync(query: str, max_results: int) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    timeout = _timeout_sec()
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


async def _search_web_fast(query: str, max_results: int) -> list[dict[str, Any]]:
    """fast：维基优先，不足再并行 ddgs。"""
    wiki_min = max(1, int(os.getenv("WEB_SEARCH_WIKI_MIN", "2")))

    wiki = await _search_wikipedia_async(query, max_results)
    if len(wiki) >= wiki_min:
        logger.info("联网检索 fast/Wikipedia 直接返回 count=%s", len(wiki))
        return wiki

    ddgs: list[dict[str, Any]] = []
    try:
        ddgs = await asyncio.wait_for(
            asyncio.to_thread(_search_ddgs_parallel, query, max_results),
            timeout=_timeout_sec() + 4,
        )
    except asyncio.TimeoutError:
        logger.warning("联网检索 ddgs 等待超时")
    except ImportError:
        raise
    except Exception as e:
        logger.warning("联网检索 ddgs 失败: %s", str(e)[:200])

    merged = _merge_results(wiki, ddgs, limit=max_results)
    if merged:
        return merged
    return wiki


def search_web_thorough(query: str, max_results: int) -> list[dict[str, Any]]:
    """thorough：ddgs 顺序多引擎，再 Wikipedia。"""
    try:
        hits = _search_ddgs_sequential(query, max_results)
        if hits:
            return hits
    except ImportError:
        raise
    except Exception as e:
        logger.warning("ddgs 全部引擎失败，尝试 Wikipedia: %s", str(e)[:300])

    wiki = _search_wikipedia_sync(query, max_results)
    if wiki:
        return wiki

    raise RuntimeError(
        "联网检索暂时不可用（外网搜索服务受限）。请稍后重试，或改用「本地课程」。"
    )


def search_web(query: str, max_results: int = 8) -> list[dict[str, Any]]:
    """同步入口（供 thorough 或 to_thread 使用）。"""
    strategy = os.getenv("WEB_SEARCH_STRATEGY", "fast").strip().lower()
    if strategy == "thorough":
        return search_web_thorough(query, max_results)

    wiki = _search_wikipedia_sync(query, max_results)
    if len(wiki) >= int(os.getenv("WEB_SEARCH_WIKI_MIN", "2")):
        return wiki
    try:
        ddgs = _search_ddgs_parallel(query, max_results)
        merged = _merge_results(wiki, ddgs, limit=max_results)
        return merged or wiki
    except Exception:
        return wiki


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
    """异步联网检索。"""
    q = query.strip()
    if not q:
        return []

    max_results = min(max(max_results, 1), 12)

    cached = _cache_get(q, max_results)
    if cached is not None:
        return cached

    strategy = os.getenv("WEB_SEARCH_STRATEGY", "fast").strip().lower()

    try:
        if strategy == "thorough":
            results = await asyncio.to_thread(search_web_thorough, q, max_results)
        else:
            results = await _search_web_fast(q, max_results)
    except ImportError:
        raise
    except Exception as e:
        logger.warning("公网检索失败，尝试兜底: %s", str(e)[:200])
        results = []

    if results:
        _cache_set(q, max_results, results)
        return results

    if os.getenv("WEB_SEARCH_LLM_FALLBACK", "1").strip().lower() in ("0", "false", "no"):
        raise RuntimeError(
            "联网检索暂时不可用。请改用「本地课程」，或检查网络后重试。"
        )

    logger.warning("公网检索无结果，启用星火推荐阅读（较慢）")
    llm_results = await _search_llm_reading_list(q, max_results)
    _cache_set(q, max_results, llm_results)
    return llm_results
