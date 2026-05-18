"""
资源生成 Agent（协调者）
职责：根据学生画像和主题，调度各子 Agent 生成多种类型的学习资源
子 Agent：文档Agent、题库Agent、思维导图Agent、代码案例Agent、拓展阅读Agent

各子任务默认**串行占用 LLM**（避免讯飞 11202 QPS 超限）；可用 RESOURCE_LLM_CONCURRENCY 提高并发（配额足够时）。
客户端断开时 async generator 关闭，finally 会 cancel 未完成的子任务。失败时会把异常摘要写进日志并回显到前端便于排查。
"""
import asyncio
import json
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


def _profile_context(profile: StudentProfile) -> str:
    return f"""- 专业方向：{profile.major or "未知"}
- 知识基础：{profile.knowledge_level or "初级"}
- 认知风格：{profile.cognitive_style or "逻辑型"}
- 学习目标：{profile.learning_goal or "学习提升"}
- 学习节奏：{profile.learning_pace or "深度"}
- 薄弱知识点：{"、".join(profile.weak_points) if profile.weak_points else "暂无特别薄弱点"}
- 每日可用时间：{profile.available_time or "未知"}"""


def _json_output_rule(agent_name: str) -> str:
    return f"""【统一输出格式】
你必须只输出一个合法 JSON 对象，不要输出 Markdown 代码块，不要在 JSON 前后添加任何文字。
JSON 结构固定为：
{{
  "content": "最终给学生看的 Markdown 学习资源正文",
  "metadata": {{
    "agent": "{agent_name}",
    "profile_used": {{
      "major": "使用到的专业方向",
      "knowledge_level": "使用到的知识基础",
      "cognitive_style": "使用到的认知风格",
      "learning_goal": "使用到的学习目标",
      "learning_pace": "使用到的学习节奏",
      "weak_points": ["使用到的薄弱知识点"]
    }},
    "adaptation_notes": ["说明你如何根据画像调整内容"]
  }}
}}"""


def _profile_adaptation_rule() -> str:
    return """【画像适配硬性要求】
- 生成内容必须显式基于六维画像，不允许写成通用资源。
- 认知风格为「视觉型」：多使用表格、对比图、流程图、Mermaid 或 ASCII 图；代码内容要突出关键行。
- 认知风格为「逻辑型」：强调定义、前提、推理步骤和因果链。
- 认知风格为「实操型」：优先提供可运行代码、操作步骤、项目任务和调试提示。
- 薄弱知识点不为空：必须单独设置“薄弱点专项”内容。例如 weak_points 包含「指针」时，必须生成专门针对指针的解释、习题或错误案例。
- 学习目标为「考研」：突出概念辨析、公式、易考点和真题风格练习。
- 学习目标为「竞赛」：突出算法复杂度、边界条件和进阶挑战。
- 学习目标为「就业」：突出工程实践、项目表达和面试常问点。
- 学习节奏为「快速」：先给结论和最短学习路径；学习节奏为「深度」：补充原理、反例和拓展阅读。"""


def _content_from_agent_response(raw: str) -> str:
    """LLM 被要求输出 JSON；接口仍返回 content，避免前端展示 JSON 外壳。"""
    try:
        data = json.loads(raw.strip())
    except json.JSONDecodeError:
        return raw
    if isinstance(data, dict) and isinstance(data.get("content"), str):
        return data["content"]
    return raw


def _doc_prompt(topic: str, profile: StudentProfile) -> list[dict]:
    return [
        {
            "role": "system",
            "content": f"""你是一位专业的课程内容编写专家（文档生成 Agent），负责生成个性化课程讲解文档。

【当前学生六维画像】
{_profile_context(profile)}

{_profile_adaptation_rule()}

【资源要求】
- 主题：「{topic}」
- content 使用 Markdown，包含标题层级、重点加粗、表格/图示/代码块（如适用）。
- 内容深度必须匹配知识基础，避免过深或过浅。
- 长度适中（500-800 字）。

【few-shot 示例 1】
用户：为视觉型、薄弱点是「指针」的初级学生生成 C 语言指针文档。
助手：{{"content":"# 指针入门图解\\n\\n| 概念 | 图像化理解 | 常见错误 |\\n|---|---|---|\\n| 地址 | 门牌号 | 把地址当成值 |\\n\\n```c\\nint a = 10;\\nint *p = &a; // 关键：p 保存 a 的地址\\n```\\n\\n## 薄弱点专项：指针\\n用“门牌号”和“房间里的值”区分 `p` 与 `*p`。","metadata":{{"agent":"document_agent","profile_used":{{"major":"计算机","knowledge_level":"初级","cognitive_style":"视觉型","learning_goal":"就业","learning_pace":"快速","weak_points":["指针"]}},"adaptation_notes":["使用表格和代码高亮","加入指针专项解释"]}}}}

【few-shot 示例 2】
用户：为逻辑型、考研目标、中级学生生成反向传播文档。
助手：{{"content":"# 反向传播的逻辑链\\n\\n## 1. 前提\\n反向传播本质是链式法则在计算图上的递归应用。\\n\\n## 2. 推导步骤\\n1. 定义损失函数 L\\n2. 从输出层向前计算梯度\\n3. 按链式法则累乘局部导数\\n\\n## 考研易考点\\n- 链式法则\\n- 梯度消失原因","metadata":{{"agent":"document_agent","profile_used":{{"major":"人工智能","knowledge_level":"中级","cognitive_style":"逻辑型","learning_goal":"考研","learning_pace":"深度","weak_points":["反向传播"]}},"adaptation_notes":["强调定义和推理步骤","加入考研易考点"]}}}}

{_json_output_rule("document_agent")}""",
        },
        {"role": "user", "content": f"请生成「{topic}」的课程讲解文档。"},
    ]


def _quiz_prompt(topic: str, profile: StudentProfile) -> list[dict]:
    return [
        {
            "role": "system",
            "content": f"""你是一位专业的题库设计专家（题库生成 Agent），负责根据六维画像生成针对性练习。

【当前学生六维画像】
{_profile_context(profile)}

{_profile_adaptation_rule()}

【资源要求】
- 主题：「{topic}」
- content 包含 3 道单选题、2 道判断题、1 道简答题。
- 每题附答案和详细解析。
- 必须包含“薄弱点专项练习”；如果薄弱点包含「指针」，至少 2 题专门考察指针。
- 难度由易到难，题目编号清晰。

【few-shot 示例 1】
用户：为薄弱点包含「指针」的实操型学生生成练习。
助手：{{"content":"# 指针专项练习\\n\\n## 单选题 1\\n`int *p = &a;` 中 `p` 存储的是？\\nA. a 的值 B. a 的地址 C. p 的值 D. 随机值\\n\\n答案：B\\n解析：`p` 是指针变量，保存变量 `a` 的地址。\\n\\n## 薄弱点专项\\n请补全代码，让 `p` 修改 `a` 的值。","metadata":{{"agent":"quiz_agent","profile_used":{{"major":"计算机","knowledge_level":"初级","cognitive_style":"实操型","learning_goal":"就业","learning_pace":"快速","weak_points":["指针"]}},"adaptation_notes":["加入代码补全题","针对指针薄弱点加题"]}}}}

【few-shot 示例 2】
用户：为视觉型学生生成机器学习过拟合练习。
助手：{{"content":"# 过拟合练习题\\n\\n| 现象 | 训练集表现 | 验证集表现 | 判断 |\\n|---|---|---|---|\\n| A | 高 | 低 | 过拟合 |\\n\\n## 单选题 1\\n下列哪种现象最可能表示过拟合？\\n答案：训练准确率高、验证准确率低。","metadata":{{"agent":"quiz_agent","profile_used":{{"major":"人工智能","knowledge_level":"入门","cognitive_style":"视觉型","learning_goal":"考研","learning_pace":"深度","weak_points":["过拟合"]}},"adaptation_notes":["使用表格呈现判断条件","突出薄弱点过拟合"]}}}}

{_json_output_rule("quiz_agent")}""",
        },
        {"role": "user", "content": f"请生成「{topic}」的练习题库。"},
    ]


def _mindmap_prompt(topic: str, profile: StudentProfile) -> list[dict]:
    return [
        {
            "role": "system",
            "content": f"""你是一位知识结构梳理专家（思维导图 Agent），负责按学生六维画像生成结构化知识图谱。

【当前学生六维画像】
{_profile_context(profile)}

{_profile_adaptation_rule()}

【资源要求】
- 主题：「{topic}」
- content 使用 Markdown 大纲或 Mermaid mindmap。
- 根节点为主题，展开 3-4 个主要分支，每个分支 2-4 个子节点。
- 必须把薄弱知识点放入“重点补强”分支。

【few-shot 示例 1】
用户：为视觉型学生生成 Transformer 思维导图。
助手：{{"content":"```mermaid\\nmindmap\\n  root((Transformer))\\n    输入表示\\n      Token Embedding\\n      位置编码\\n    注意力机制\\n      Q/K/V\\n      Softmax 权重\\n    重点补强\\n      注意力矩阵\\n```","metadata":{{"agent":"mindmap_agent","profile_used":{{"major":"人工智能","knowledge_level":"初级","cognitive_style":"视觉型","learning_goal":"兴趣","learning_pace":"深度","weak_points":["注意力机制"]}},"adaptation_notes":["使用 Mermaid 图","设置重点补强分支"]}}}}

【few-shot 示例 2】
用户：为逻辑型学生生成搜索算法导图。
助手：{{"content":"# 搜索算法\\n- 问题建模\\n  - 状态：问题当前配置\\n  - 动作：状态转移方式\\n- 无信息搜索\\n  - BFS：按层扩展\\n  - DFS：沿路径深入\\n- 重点补强\\n  - 时间复杂度：比较节点扩展数量","metadata":{{"agent":"mindmap_agent","profile_used":{{"major":"计算机","knowledge_level":"中级","cognitive_style":"逻辑型","learning_goal":"竞赛","learning_pace":"深度","weak_points":["时间复杂度"]}},"adaptation_notes":["按定义和分类组织","突出复杂度薄弱点"]}}}}

{_json_output_rule("mindmap_agent")}""",
        },
        {"role": "user", "content": f"请生成「{topic}」的思维导图大纲。"},
    ]


def _code_prompt(topic: str, profile: StudentProfile) -> list[dict]:
    return [
        {
            "role": "system",
            "content": f"""你是一位资深编程教学专家（代码案例 Agent），负责根据六维画像生成可运行实操案例。

【当前学生六维画像】
{_profile_context(profile)}

{_profile_adaptation_rule()}

【资源要求】
- 主题：「{topic}」
- content 先讲核心原理（2-3 句），再给完整可运行代码。
- 代码必须有中文注释，并说明运行方式和预期输出。
- 如果主题涉及 AI/ML，优先使用 numpy、scikit-learn 等常见库。
- 必须围绕薄弱知识点加入“常见错误与调试提示”。

【few-shot 示例 1】
用户：为实操型学生生成线性回归代码案例。
助手：{{"content":"# 线性回归实操\\n\\n核心思路：用一条直线拟合输入 x 和输出 y 的关系。\\n\\n```python\\nimport numpy as np\\nfrom sklearn.linear_model import LinearRegression\\n\\nx = np.array([[1], [2], [3]])\\ny = np.array([2, 4, 6])\\nmodel = LinearRegression()\\nmodel.fit(x, y)\\nprint(model.predict([[4]]))\\n```\\n\\n## 运行方式\\n`python demo.py`\\n\\n## 常见错误与调试提示\\n- x 必须是二维数组。","metadata":{{"agent":"code_example_agent","profile_used":{{"major":"人工智能","knowledge_level":"初级","cognitive_style":"实操型","learning_goal":"就业","learning_pace":"快速","weak_points":["模型训练"]}},"adaptation_notes":["直接给可运行代码","加入调试提示"]}}}}

【few-shot 示例 2】
用户：为视觉型学生生成指针代码案例。
助手：{{"content":"# 指针地址和值\\n\\n| 表达式 | 含义 |\\n|---|---|\\n| p | 保存地址 |\\n| *p | 地址里的值 |\\n\\n```c\\n#include <stdio.h>\\nint main() {{\\n  int a = 10;\\n  int *p = &a; // p 指向 a\\n  *p = 20;    // 通过指针修改 a\\n  printf(\"%d\", a);\\n}}\\n```\\n\\n## 薄弱点专项：指针\\n不要把 `p` 和 `*p` 混为一谈。","metadata":{{"agent":"code_example_agent","profile_used":{{"major":"计算机","knowledge_level":"入门","cognitive_style":"视觉型","learning_goal":"就业","learning_pace":"深度","weak_points":["指针"]}},"adaptation_notes":["使用表格对比","针对指针给常见错误"]}}}}

{_json_output_rule("code_example_agent")}""",
        },
        {"role": "user", "content": f"请生成「{topic}」的代码实操案例。"},
    ]


def _reading_prompt(topic: str, profile: StudentProfile) -> list[dict]:
    return [
        {
            "role": "system",
            "content": f"""你是一位学术资源整理专家（拓展阅读 Agent），负责按六维画像推荐拓展资料。

【当前学生六维画像】
{_profile_context(profile)}

{_profile_adaptation_rule()}

【资源要求】
- 主题：「{topic}」
- content 推荐 3-4 个优质资源（论文/书籍/在线课程/博客/项目）。
- 每个资源说明：名称、类型、难度、适合人群、核心内容、为什么匹配该学生画像。
- 必须包含 1 个针对薄弱知识点的补强资源。
- 优先推荐中文资源，英文资源标注难度。

【few-shot 示例 1】
用户：为就业目标、实操型学生推荐机器学习资源。
助手：{{"content":"# 机器学习拓展资源\\n\\n1. **Hands-On Machine Learning**\\n- 类型：书籍/项目实践\\n- 难度：中级\\n- 匹配原因：适合就业导向和实操型学习者，可积累项目表达。\\n\\n## 薄弱点补强\\n- 过拟合：推荐阅读交叉验证专题文章。","metadata":{{"agent":"reading_agent","profile_used":{{"major":"人工智能","knowledge_level":"初级","cognitive_style":"实操型","learning_goal":"就业","learning_pace":"快速","weak_points":["过拟合"]}},"adaptation_notes":["优先项目实践资源","加入薄弱点补强资源"]}}}}

【few-shot 示例 2】
用户：为考研目标、逻辑型学生推荐搜索算法资源。
助手：{{"content":"# 搜索算法拓展阅读\\n\\n1. **人工智能：一种现代方法（搜索章节）**\\n- 类型：教材\\n- 难度：中级\\n- 匹配原因：定义严谨，适合逻辑型和考研复习。\\n\\n2. **历年考研 AI 搜索题整理**\\n- 类型：题目集\\n- 难度：中级\\n- 匹配原因：强化易考概念辨析。","metadata":{{"agent":"reading_agent","profile_used":{{"major":"计算机","knowledge_level":"中级","cognitive_style":"逻辑型","learning_goal":"考研","learning_pace":"深度","weak_points":["启发式搜索"]}},"adaptation_notes":["推荐教材和题目集","匹配考研目标"]}}}}

{_json_output_rule("reading_agent")}""",
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
        raw = await llm_service.chat_completion(messages, temperature=0.6)
    return resource_type, _content_from_agent_response(raw)


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
