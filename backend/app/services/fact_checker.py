"""
Fact-checking service: verifies AI-generated content against the local knowledge base.
"""
import re
from typing import Any

from app.services.knowledge_service import knowledge_service


async def check_facts(text: str, course: str = "人工智能导论", top_k: int = 3) -> dict[str, Any]:
    """
    Verify factual accuracy of generated text against the knowledge base.

    Returns a dict with:
      - confidence: float 0.0-1.0
      - sources:    list of KB chunks that corroborate the content
      - flagged_claims: statements that could not be verified
      - fact_checked: True
    """
    sentences = _extract_key_claims(text)
    if not sentences:
        return {"confidence": 0.5, "sources": [], "flagged_claims": [], "fact_checked": True}

    verified = 0
    raw_sources: list[dict] = []
    flagged: list[str] = []

    for sentence in sentences[:5]:
        results = knowledge_service.search(sentence, course_name=course, top_k=top_k)
        if results:
            best_score = results[0].get("relevance_score", 0.0)
            if best_score > 0.55:
                verified += 1
                raw_sources.extend(results[:2])
            elif best_score < 0.3:
                flagged.append(sentence)
        else:
            flagged.append(sentence)

    confidence = verified / len(sentences) if sentences else 0.5

    seen: set[str] = set()
    unique_sources: list[dict] = []
    for s in raw_sources:
        key = s.get("chapter_id", "") + s.get("content_preview", "")[:60]
        if key not in seen:
            seen.add(key)
            unique_sources.append({
                "chapter": s.get("chapter_id", ""),
                "title": s.get("title", ""),
                "excerpt": s.get("content_preview", "")[:150],
                "score": s.get("relevance_score", 0.0),
            })

    return {
        "confidence": round(confidence, 2),
        "sources": unique_sources[:3],
        "flagged_claims": flagged[:2],
        "fact_checked": True,
    }


def _extract_key_claims(text: str) -> list[str]:
    """Extract factual-sounding sentences worth verifying."""
    sentences = re.split(r"[。！？.!?]\s*", text)
    result: list[str] = []
    indicators = {"是", "称为", "定义", "包括", "用于", "可以", "能够",
                  "由", "通过", "基于", "算法", "模型", "方法", "技术", "表示", "实现"}
    for s in sentences:
        s = s.strip()
        if 10 < len(s) < 200 and any(kw in s for kw in indicators):
            result.append(s)
    return result[:8]
