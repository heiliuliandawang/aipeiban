"""
学习进度接口
提供章节完成标记、测试得分记录、理解度评分查询等功能
"""
from fastapi import APIRouter
from pydantic import BaseModel

from app.services import session_store

router = APIRouter(prefix="/progress", tags=["progress"])


class MarkChapterRequest(BaseModel):
    session_id: str
    course: str
    chapter_id: str


class RecordQuizScoreRequest(BaseModel):
    session_id: str
    quiz_topic: str
    score: float
    total: float


@router.post("/chapter/complete")
async def mark_chapter_complete(req: MarkChapterRequest):
    """标记章节完成"""
    await session_store.mark_chapter_complete(req.session_id, req.course, req.chapter_id)
    return {"message": "章节已标记完成", "chapter_id": req.chapter_id}


@router.get("/chapters/{session_id}")
async def get_completed_chapters(session_id: str, course: str = None):
    """获取已完成的章节列表"""
    chapters = await session_store.get_completed_chapters(session_id, course)
    return {"session_id": session_id, "completed_chapters": chapters, "count": len(chapters)}


@router.post("/quiz/score")
async def record_quiz_score(req: RecordQuizScoreRequest):
    """记录测试得分"""
    await session_store.record_quiz_score(
        req.session_id, req.quiz_topic, req.score, req.total
    )
    pct = round(req.score / req.total * 100, 1) if req.total > 0 else 0
    return {"message": "得分已记录", "percentage": pct}


@router.get("/quiz/scores/{session_id}")
async def get_quiz_scores(session_id: str, limit: int = 20):
    """获取测试得分历史"""
    scores = await session_store.get_quiz_scores(session_id, limit)
    avg = round(sum(s["percentage"] for s in scores) / len(scores), 1) if scores else 0
    return {"session_id": session_id, "scores": scores, "average": avg}


@router.get("/comprehension/{session_id}")
async def get_comprehension_scores(session_id: str, limit: int = 10):
    """获取辅导理解度评分历史"""
    scores = await session_store.get_comprehension_scores(session_id, limit)
    avg = round(sum(s["score"] for s in scores) / len(scores), 3) if scores else 0
    return {"session_id": session_id, "scores": scores, "average": avg}


@router.get("/summary/{session_id}")
async def get_progress_summary(session_id: str):
    """获取完整学习进度摘要"""
    completed_chapters = await session_store.get_completed_chapters(session_id)
    quiz_scores = await session_store.get_quiz_scores(session_id, limit=10)
    comprehension_scores = await session_store.get_comprehension_scores(session_id, limit=10)
    weak_points = await session_store.get_weak_points_history(session_id)

    quiz_avg = (
        round(sum(s["percentage"] for s in quiz_scores) / len(quiz_scores), 1)
        if quiz_scores else 0
    )
    comp_avg = (
        round(sum(s["score"] for s in comprehension_scores) / len(comprehension_scores), 3)
        if comprehension_scores else 0
    )

    return {
        "session_id": session_id,
        "completed_chapters": completed_chapters,
        "chapter_count": len(completed_chapters),
        "quiz_scores": quiz_scores,
        "quiz_average": quiz_avg,
        "comprehension_scores": comprehension_scores,
        "comprehension_average": comp_avg,
        "weak_points": weak_points,
    }
