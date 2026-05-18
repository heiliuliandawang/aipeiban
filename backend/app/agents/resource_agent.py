"""
资源生成 Agent（协调者）
职责：根据学生画像和主题，调度各子 Agent 生成多种类型的学习资源
子 Agent：文档Agent、题库Agent、思维导图Agent、代码案例Agent、拓展阅读Agent

各子任务默认**串行占用 LLM**（避免讯飞 11202 QPS 超限）；可用 RESOURCE_LLM_CONCURRENCY 提高并发（配额足够时）。
客户端断开时 async generator 关闭，finally 会 cancel 未完成的子任务。失败时会把异常摘要写进日志并回显到前端便于排查。
"""
import asyncio
import logging
import os
from typing import AsyncGenerator

from app.services import llm_service
from app.models.schemas import StudentProfile, ResourceType

logger = logging.getLogger(__name__)

# 星火 AppId 常有 QPS 上限：五类资源同时请求易触发 11202。默认串行（1），配额高时可改为 2。
_RESOURCE_LLM_CONCURRENCY = max(1, int(os.getenv("RESOURCE_LLM_CONCURRENCY", "1")))
_resource_llm_sem = asyncio.Semaphore(_RESOURCE_LLM_CONCURRENCY)

# ── 各子 Agent 的系统提示 ──────────────────────────────────────────────────────


def _doc_prompt(topic: str, profile: StudentProfile) -> list[dict]:
    level = profile.knowledge_level or "初级"
    style = profile.cognitive_style or "逻辑型"
    return [
        {
            "role": "system",
            "content": f"""你是一位专业的课程内容编写专家（文档生成Agent）。
请为{level}水平、{style}学习风格的学生，撰写关于「{topic}」的详细课程讲解文档。

要求：
- 使用 Markdown 格式，包含标题层级、重点加粗、代码块（如适用）
- 内容深度匹配{level}水平，避免过深或过浅
- 如果是视觉型学生，多用类比和图示说明（用 ASCII 或 Mermaid 图）
- 如果是实操型学生，结合实际应用场景
- 长度适中（500-800字）""",
        },
        {"role": "user", "content": f"请生成「{topic}」的课程讲解文档。"},
    ]


def _quiz_prompt(topic: str, profile: StudentProfile) -> list[dict]:
    weak = "、".join(profile.weak_points) if profile.weak_points else "通用知识点"
    return [
        {
            "role": "system",
            "content": f"""你是一位专业的题库设计专家（题库生成Agent）。
请针对「{topic}」设计一套练习题，重点覆盖学生薄弱点：{weak}。

要求：
- 包含 3 道单选题、2 道判断题、1 道简答题
- 每题附答案和详细解析
- 难度由易到难，循序渐进
- 使用 Markdown 格式，题目编号清晰""",
        },
        {"role": "user", "content": f"请生成「{topic}」的练习题库。"},
    ]


def _mindmap_prompt(topic: str, profile: StudentProfile) -> list[dict]:
    return [
        {
            "role": "system",
            "content": f"""你是一位知识结构梳理专家（思维导图Agent）。
请为「{topic}」生成一份结构化思维导图，使用 Markdown 大纲格式输出。

要求：
- 根节点为主题
- 展开 3-4 个主要分支
- 每个分支下有 2-4 个子节点
- 重要概念标注简要说明
- 使用标准 Markdown 列表层级格式（- 符号缩进）""",
        },
        {"role": "user", "content": f"请生成「{topic}」的思维导图大纲。"},
    ]


def _code_prompt(topic: str, profile: StudentProfile) -> list[dict]:
    return [
        {
            "role": "system",
            "content": f"""你是一位资深编程教学专家（代码案例Agent）。
请为「{topic}」设计一个完整的 Python 代码实操案例。

要求：
- 代码完整可运行，包含详细的中文注释
- 先讲解核心原理（2-3句），再给出代码
- 代码后说明运行方式和预期输出
- 最后提供 1-2 个扩展练习建议
- 如果该主题涉及 AI/ML，使用 scikit-learn 或 numpy 等常见库""",
        },
        {"role": "user", "content": f"请生成「{topic}」的代码实操案例。"},
    ]


def _reading_prompt(topic: str, profile: StudentProfile) -> list[dict]:
    goal = profile.learning_goal or "学习提升"
    return [
        {
            "role": "system",
            "content": f"""你是一位学术资源整理专家（拓展阅读Agent）。
请为学习目标是「{goal}」的学生，整理「{topic}」的拓展阅读资料清单。

要求：
- 推荐 3-4 个优质学习资源（论文/书籍/在线课程/博客）
- 每个资源说明：名称、类型、难度、适合人群、核心内容（2句话）
- 优先推荐中文资源，英文资源标注难度
- 使用 Markdown 格式，结构清晰""",
        },
        {"role": "user", "content": f"请推荐「{topic}」的拓展阅读资料。"},
    ]


# ── 资源类型到子 Agent 的路由 ─────────────────────────────────────────────────

_PROMPT_BUILDERS = {
    ResourceType.document: _doc_prompt,
    ResourceType.quiz: _quiz_prompt,
    ResourceType.mindmap: _mindmap_prompt,
    ResourceType.code_example: _code_prompt,
    ResourceType.reading: _reading_prompt,
}

RESOURCE_LABELS = {
    ResourceType.document: "课程讲解文档",
    ResourceType.quiz: "练习题库",
    ResourceType.mindmap: "思维导图",
    ResourceType.code_example: "代码实操案例",
    ResourceType.reading: "拓展阅读",
}


async def _generate_single(
    resource_type: ResourceType, topic: str, profile: StudentProfile
) -> tuple[ResourceType, str]:
    """单个子 Agent 生成任务（受 RESOURCE_LLM_CONCURRENCY 限制，减轻星火 QPS 压力）"""
    builder = _PROMPT_BUILDERS[resource_type]
    messages = builder(topic, profile)
    async with _resource_llm_sem:
        content = await llm_service.chat_completion(messages, temperature=0.6)
    return resource_type, content


async def generate_resources(
    topic: str,
    resource_types: list[ResourceType],
    profile: StudentProfile,
    progress_callback=None,
) -> dict[ResourceType, str]:
    """
    并发调度多个子 Agent 生成资源（阻塞版，供同步接口使用）
    progress_callback(resource_type, label): 每完成一个子任务时回调
    """
    tasks = [_generate_single(rt, topic, profile) for rt in resource_types]
    results = {}

    for coro in asyncio.as_completed(tasks):
        rt, content = await coro
        results[rt] = content
        if progress_callback:
            await progress_callback(rt, RESOURCE_LABELS[rt])

    return results


async def generate_resources_stream(
    topic: str,
    resource_types: list[ResourceType],
    profile: StudentProfile,
) -> AsyncGenerator[tuple[ResourceType, str], None]:
    """
    并发调度多个子 Agent，按完成顺序逐个 yield (resource_type, content)
    供 SSE 流式接口使用。客户端断开时 async generator 被关闭，finally 会 cancel 未完成的子任务。
    """
    task_to_rt: dict[asyncio.Task, ResourceType] = {
        asyncio.create_task(_generate_single(rt, topic, profile)): rt for rt in resource_types
    }
    pending: set[asyncio.Task] = set(task_to_rt.keys())
    try:
        while pending:
            done, _ = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                pending.discard(task)
                expected_rt = task_to_rt.pop(task)
                try:
                    rtype, content = task.result()
                    yield rtype, content
                except asyncio.CancelledError:
                    continue
                except Exception as e:
                    logger.exception(
                        "资源子任务失败 resource_type=%s topic=%s error=%s",
                        expected_rt,
                        topic,
                        e,
                    )
                    detail = (str(e).strip() or type(e).__name__)[:800]
                    yield (
                        expected_rt,
                        f"**生成失败**（{type(e).__name__}）\n\n{detail}\n\n"
                        "请在后端终端查看完整堆栈；常见原因：鉴权/配额、模型名、网络超时或接口返回空结果。",
                    )
    finally:
        for task in list(pending):
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
