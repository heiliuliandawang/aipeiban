"""
对话接口 —— 支持流式输出（SSE）
"""
import json
import uuid

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from app.models.schemas import ChatRequest, SessionSyncRequest
from app.agents import profile_agent
from app.services import session_store

router = APIRouter(prefix="/chat", tags=["chat"])


def _format_stream_error(exc: Exception) -> str:
    detail = str(exc)
    if "apikey not found" in detail.lower() or "authenticationerror" in detail.lower():
        return (
            "模型鉴权失败，请检查讯飞配置。"
            "可优先使用 OPENAI_API_KEY=APIKey:APISecret，"
            "并确认 OPENAI_BASE_URL 为 …/v1 或 …/v2 根路径（勿含 /chat/completions），Ultra 模型名为 4.0Ultra。"
        )
    return "对话服务暂时不可用，请稍后重试。"


@router.post("/session")
async def create_session():
    """创建新的对话 session"""
    session_id = str(uuid.uuid4())
    return {"session_id": session_id}


@router.post("/session/sync")
async def sync_session(req: SessionSyncRequest):
    """用前端保存的快照恢复当前会话。"""
    session_store.update_profile(req.profile.model_copy(update={"session_id": req.session_id}))
    session_store.set_history(
        req.session_id,
        [{"role": msg.role.value if hasattr(msg.role, "value") else str(msg.role), "content": msg.content} for msg in req.history],
    )
    return {"message": "session synced"}


@router.post("/message")
async def send_message(req: ChatRequest):
    """普通对话（画像构建阶段）"""
    reply, profile = await profile_agent.chat(req.session_id, req.message)
    return {
        "reply": reply,
        "profile": profile.model_dump(),
    }


@router.get("/message/stream")
async def send_message_stream(session_id: str, message: str):
    """流式对话，使用 SSE"""

    async def event_generator():
        try:
            initial_profile = profile_agent.infer_and_update_profile(session_id, message)
            yield {
                "event": "profile_update",
                "data": json.dumps(initial_profile.model_dump(), ensure_ascii=False),
            }

            # profile_agent.chat_stream 内部已过滤 json_profile 块，此处直接转发
            async for chunk in profile_agent.chat_stream(session_id, message):
                yield {
                    "event": "delta",
                    "data": json.dumps({"text": chunk}, ensure_ascii=False),
                }

            # 流结束后 profile 已在 chat_stream 内部更新，直接读取推送
            profile = session_store.get_profile(session_id)
            yield {
                "event": "profile_update",
                "data": json.dumps(profile.model_dump(), ensure_ascii=False),
            }
        except Exception as exc:
            yield {
                "event": "server_error",
                "data": json.dumps(
                    {"message": _format_stream_error(exc), "detail": str(exc)},
                    ensure_ascii=False,
                ),
            }
        yield {"event": "done", "data": ""}

    return EventSourceResponse(event_generator())


@router.get("/profile/{session_id}")
async def get_profile(session_id: str):
    """获取当前学生画像"""
    profile = session_store.get_profile(session_id)
    return profile.model_dump()


@router.delete("/session/{session_id}")
async def clear_session(session_id: str):
    """清除 session 数据"""
    session_store.clear_session(session_id)
    return {"message": "session cleared"}
