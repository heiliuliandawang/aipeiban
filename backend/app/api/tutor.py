"""
智能辅导接口 —— 支持流式输出（SSE）
"""
import json
from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel

from app.agents import tutor_agent
from app.services import session_store

router = APIRouter(prefix="/tutor", tags=["tutor"])


class TutorAskRequest(BaseModel):
    session_id: str
    question: str
    current_topic: str = ""


@router.post("/ask/stream")
async def ask_stream(req: TutorAskRequest):
    """
    流式辅导问答，SSE 推送逐字回复
    事件类型：
      - delta: { text }         每个文本片段
      - done: ""                回答完成
    """
    async def event_generator():
        async for chunk in tutor_agent.ask_stream(
            session_id=req.session_id,
            question=req.question,
            current_topic=req.current_topic,
        ):
            yield {
                "event": "delta",
                "data": json.dumps({"text": chunk}, ensure_ascii=False),
            }
        yield {"event": "done", "data": ""}

    return EventSourceResponse(event_generator())


@router.get("/suggested-questions")
async def get_suggested_questions(topic: str = ""):
    """根据主题获取推荐问题列表"""
    questions = tutor_agent.get_suggested_questions(topic)
    return {"topic": topic, "questions": questions}


@router.get("/history/{session_id}")
async def get_history(session_id: str, limit: int = 50):
    """获取辅导对话历史（供前端恢复会话）"""
    messages = await session_store.get_tutor_history(session_id, limit=limit)
    return {"session_id": session_id, "messages": messages}


@router.delete("/history/{session_id}")
async def clear_history(session_id: str):
    """清除辅导对话历史"""
    await session_store.clear_tutor_history(session_id)
    return {"message": "tutor history cleared"}
