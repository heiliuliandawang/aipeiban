"""从各 Agent 的 LLM 回复中提取供前端展示的 content 正文。"""
import json
import re


def _normalize_raw(text: str) -> str:
    cleaned = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned, re.IGNORECASE)
    if fence:
        cleaned = fence.group(1).strip()
    brace = cleaned.find("{")
    if brace > 0:
        cleaned = cleaned[brace:]
    return cleaned


def _unescape_json_string(raw: str) -> str:
    try:
        return json.loads(f'"{raw}"')
    except json.JSONDecodeError:
        return (
            raw.replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace('\\"', '"')
            .replace("\\\\", "\\")
        )


def _extract_quoted_content(text: str) -> str | None:
    m = re.search(r'"content"\s*:\s*"', text, re.DOTALL)
    if not m:
        return None
    start = m.end()
    meta = re.search(r'"\s*,\s*"metadata"\s*:', text[start:], re.DOTALL)
    if meta:
        return _unescape_json_string(text[start : start + meta.start()])
    out: list[str] = []
    i = start
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text):
            out.append(text[i : i + 2])
            i += 2
            continue
        if ch == '"':
            break
        out.append(ch)
        i += 1
    return _unescape_json_string("".join(out))


def content_from_agent_response(raw: str) -> str:
    """解析 Agent JSON 回复中的 content；兼容 Markdown 代码块与非法 JSON。"""
    if not raw or not raw.strip():
        return raw

    normalized = _normalize_raw(raw)
    try:
        data = json.loads(normalized)
        if isinstance(data, dict) and isinstance(data.get("content"), str):
            return data["content"].strip()
    except json.JSONDecodeError:
        pass

    extracted = _extract_quoted_content(normalized) or _extract_quoted_content(raw)
    if extracted:
        return extracted.strip()

    return raw.strip()
