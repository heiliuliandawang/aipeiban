"""
资源生成接口 —— 支持进度推送（SSE）
"""
import json
import logging

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from app.models.schemas import GenerateResourceRequest, ResourceType, LearningPathRequest
from app.agents import resource_agent, path_agent
from app.services import session_store

router = APIRouter(prefix="/resources", tags=["resources"])
logger = logging.getLogger(__name__)

RESOURCE_LABELS = {
    ResourceType.document: "课程讲解文档",
    ResourceType.quiz: "练习题库",
    ResourceType.mindmap: "思维导图",
    ResourceType.code_example: "代码实操案例",
    ResourceType.reading: "拓展阅读",
}


@router.post("/generate/stream")
async def generate_resources_stream(req: GenerateResourceRequest):
    """
    流式资源生成，SSE 推送每个子 Agent 完成进度
    事件类型：
      - progress: { type, label, status: "generating"|"done" }
      - resource: { type, label, content }
      - done
    """
    profile = req.profile or await session_store.get_profile(req.session_id)

    async def event_generator():
        # 先通知前端各 Agent 开始工作
        for rt in req.resource_types:
            yield {
                "event": "progress",
                "data": json.dumps(
                    {"type": rt.value, "label": RESOURCE_LABELS[rt], "status": "generating"},
                    ensure_ascii=False,
                ),
            }

        # 并发生成，每完成一个子Agent立即推送进度+内容
        try:
            async for rt, content in resource_agent.generate_resources_stream(
                topic=req.topic,
                resource_types=req.resource_types,
                profile=profile,
            ):
                yield {
                    "event": "progress",
                    "data": json.dumps(
                        {"type": rt.value, "label": RESOURCE_LABELS[rt], "status": "done"},
                        ensure_ascii=False,
                    ),
                }
                yield {
                    "event": "resource",
                    "data": json.dumps(
                        {
                            "type": rt.value,
                            "label": RESOURCE_LABELS[rt],
                            "content": content,
                        },
                        ensure_ascii=False,
                    ),
                }
                await session_store.save_resource(req.session_id, rt.value, content)
        except Exception as e:
            logger.exception("资源生成流异常（含客户端断开）: %s", e)
            yield {
                "event": "server_error",
                "data": json.dumps({"message": str(e) or "资源生成中断"}, ensure_ascii=False),
            }

        yield {"event": "done", "data": ""}

    return EventSourceResponse(event_generator())


@router.post("/generate")
async def generate_resources_sync(req: GenerateResourceRequest):
    """同步版资源生成（调试用）"""
    profile = req.profile or await session_store.get_profile(req.session_id)
    results = await resource_agent.generate_resources(
        topic=req.topic,
        resource_types=req.resource_types,
        profile=profile,
    )
    for rt, content in results.items():
        await session_store.save_resource(req.session_id, rt.value, content)
    return {
        rt.value: {"label": RESOURCE_LABELS[rt], "content": content}
        for rt, content in results.items()
    }


@router.post("/learning-path")
async def get_learning_path(req: LearningPathRequest):
    """生成个性化学习路径"""
    profile = req.profile or await session_store.get_profile(req.session_id)
    path = await path_agent.plan_path(profile, req.course)
    return {"path": path}


@router.get("/recommend/{session_id}")
async def get_recommendations(session_id: str):
    """基于画像推荐学习资源"""
    profile = await session_store.get_profile(session_id)
    topics = [
        "AI概述与发展历史",
        "机器学习基础",
        "神经网络与深度学习入门",
        "自然语言处理基础",
        "大语言模型与Transformer",
    ]
    recommendation = await path_agent.recommend_resources(profile, topics)
    return {"recommendation": recommendation}


@router.get("/{session_id}/saved")
async def list_saved_resources(session_id: str):
    """列出某个 session 已持久化的生成资源。"""
    return {"resources": await session_store.list_resources(session_id)}
