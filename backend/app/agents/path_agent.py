"""
学习路径规划 Agent
职责：根据学生画像，为其规划个性化的课程学习路径
"""
import asyncio
import json
import logging
from typing import AsyncGenerator

from app.services import llm_service
from app.services.content_filter import content_filter
from app.models.schemas import StudentProfile

logger = logging.getLogger(__name__)

COURSE_OUTLINE = {
    "人工智能导论": [
        "AI概述与发展历史",
        "搜索算法与问题求解",
        "机器学习基础",
        "监督学习：线性回归与分类",
        "神经网络与深度学习入门",
        "卷积神经网络（CNN）",
        "自然语言处理基础",
        "大语言模型与Transformer",
        "强化学习基础",
        "AI伦理与未来展望",
    ]
}


def _profile_context(profile: StudentProfile) -> str:
    mastery = (
        f"{profile.knowledge_mastery:.0%}" if profile.knowledge_mastery is not None
        else profile.knowledge_level or "初级"
    )
    pref = profile.learning_preference or profile.cognitive_style or "逻辑型"
    prog = f"，编程经验：{profile.programming_experience}" if profile.programming_experience else ""
    return (
        f"- 专业方向：{profile.major or '未知'}\n"
        f"- 知识掌握度：{mastery}\n"
        f"- 学习偏好：{pref}{prog}\n"
        f"- 学习目标：{profile.learning_goal or '学习提升'}\n"
        f"- 学习节奏：{profile.learning_pace or '深度'}\n"
        f"- 薄弱知识点：{'、'.join(profile.weak_points) if profile.weak_points else '暂无特别薄弱点'}\n"
        f"- 每日可用时间：{profile.available_time or '每天1小时'}"
    )


def _content_from_agent_response(raw: str) -> str:
    from app.agents.agent_response import content_from_agent_response

    return content_from_agent_response(raw)


async def plan_path(profile: StudentProfile, course: str = "人工智能导论") -> str:
    """根据画像生成个性化学习路径"""
    outline = COURSE_OUTLINE.get(course, COURSE_OUTLINE["人工智能导论"])
    outline_str = "\n".join(f"{i+1}. {topic}" for i, topic in enumerate(outline))

    messages = [
        {
            "role": "system",
            "content": """你是一位专业的教育路径规划师（路径规划 Agent），必须根据学生六维画像制定个性化课程学习路径。

【路径规划原则】
- 必须显式使用六维画像：专业方向、知识基础、认知风格、学习目标、学习节奏、薄弱知识点。
- 知识基础低：先补前置概念；知识基础高：减少基础铺垫，增加挑战任务。
- 视觉型：路径中安排图表、流程图、知识地图；逻辑型：安排定义、推导、概念辨析；实操型：安排代码实验、项目任务。
- 学习目标为考研：加入易考点和题型训练；就业：加入项目和面试表达；竞赛：加入复杂度与进阶题；兴趣：加入探索性材料。
- 薄弱知识点必须被安排为专项补强节点。

【统一输出格式】
你必须只输出一个合法 JSON 对象，不要输出 Markdown 代码块，不要在 JSON 前后添加任何文字。
JSON 结构固定为：
{
  "content": "给学生看的 Markdown 学习路径正文",
  "metadata": {
    "agent": "path_agent",
    "course": "课程名",
    "profile_used": {
      "major": "使用到的专业方向",
      "knowledge_level": "使用到的知识基础",
      "cognitive_style": "使用到的认知风格",
      "learning_goal": "使用到的学习目标",
      "learning_pace": "使用到的学习节奏",
      "weak_points": ["使用到的薄弱知识点"]
    },
    "estimated_total_time": "总时间估计",
    "adaptation_notes": ["画像适配说明"]
  }
}

【few-shot 示例 1】
用户：计算机专业，入门，视觉型，就业目标，快速节奏，薄弱点是指针。
助手：
{
  "content": "# 个性化学习路径\\n\\n## 阶段 1：基础速通（3 天）\\n- 用表格复习变量、地址和值。\\n- 指针专项：用图解释 `p` 和 `*p`。\\n\\n## 阶段 2：项目应用（5 天）\\n- 完成一个小型内存调试案例。\\n\\n## 就业建议\\n把指针错误案例整理成面试复盘。",
  "metadata": {
    "agent": "path_agent",
    "course": "C语言基础",
    "profile_used": {
      "major": "计算机",
      "knowledge_level": "入门",
      "cognitive_style": "视觉型",
      "learning_goal": "就业",
      "learning_pace": "快速",
      "weak_points": ["指针"]
    },
    "estimated_total_time": "8天",
    "adaptation_notes": ["使用图表路线", "安排指针专项", "偏就业项目表达"]
  }
}

【few-shot 示例 2】
用户：人工智能方向，中级，逻辑型，考研目标，深度节奏，薄弱点是反向传播。
助手：
{
  "content": "# 个性化学习路径\\n\\n## 阶段 1：数学前置（1 周）\\n- 复习链式法则、矩阵求导。\\n\\n## 阶段 2：反向传播专项（1 周）\\n- 按计算图逐步推导梯度。\\n- 做 5 道考研风格推导题。\\n\\n## 阶段 3：综合训练（1 周）\\n- 对比 CNN 与 MLP 的梯度传播差异。",
  "metadata": {
    "agent": "path_agent",
    "course": "人工智能导论",
    "profile_used": {
      "major": "人工智能",
      "knowledge_level": "中级",
      "cognitive_style": "逻辑型",
      "learning_goal": "考研",
      "learning_pace": "深度",
      "weak_points": ["反向传播"]
    },
    "estimated_total_time": "3周",
    "adaptation_notes": ["强化推导链条", "加入考研题型", "安排薄弱点专项"]
  }
}""",
        },
        {
            "role": "user",
            "content": f"""学生情况：
- 课程：{course}
{_profile_context(profile)}

课程大纲：
{outline_str}

请为该学生制定个性化学习路径。""",
        },
    ]

    raw = await llm_service.chat_completion(messages, temperature=0.5)
    content = _content_from_agent_response(raw)
    filtered_content, detected = content_filter.filter_text(content)
    if detected:
        logger.warning("path_agent filtered %d sensitive patterns", len(detected))
    return filtered_content


# ── 路径调整 ──────────────────────────────────────────────────────────────────

_ADJUST_SYSTEM_PROMPT = """\
你是一位专业的学习路径调整 Agent。学生对现有路径给出了反馈，请据此对路径做针对性修改。

【调整策略（严格按照反馈执行）】
- "太难了 / 跟不上 / 听不懂"    → 在当前阶段前插入复习节点，降低难度梯度，增加铺垫说明
- "想多做练习 / 练习太少"        → 在相关知识点后插入专项练习节点（≥3 道示例题/任务）
- "进度太快 / 想打好基础"        → 推迟进阶内容，当前阶段增加巩固环节
- "太简单 / 想快点进入正题"      → 精简基础模块，合并步骤，加快进入核心内容
- "某个知识点不理解"             → 为该知识点插入前置知识节点与专项图解/推导
- 其他自定义反馈                 → 理解意图，合理重构对应阶段

【输出格式】（与原路径格式保持一致，纯 JSON）
必须只输出合法 JSON 对象，不加任何 Markdown 代码块或额外文字：
{
  "content": "# 调整后的学习路径（Markdown）\\n\\n## 调整说明\\n...\\n\\n## 阶段 1...",
  "metadata": {
    "agent": "path_agent",
    "adjustment_type": "调整类型标签",
    "original_feedback": "原始反馈摘要",
    "changes": ["变更描述1", "变更描述2"]
  }
}

【few-shot 示例 1 — 难度过高】
原路径节选：阶段1：神经网络入门（线性代数、反向传播）
学生反馈：反向传播太难了，完全跟不上
助手：
{
  "content": "# 调整后的学习路径\\n\\n## 调整说明\\n针对「反向传播」难点，在阶段1前插入数学前置节点，并拆分推导步骤。\\n\\n## 阶段 0（新增）：数学前置复习（2天）\\n- 链式法则图解 + 3道练习\\n- 矩阵乘法与转置\\n\\n## 阶段 1：神经网络入门（延长至5天）\\n- 先理解前向传播，再逐步引入反向传播\\n- 用可视化工具（如 Netron）观察梯度流动",
  "metadata": {
    "agent": "path_agent",
    "adjustment_type": "difficulty_reduction",
    "original_feedback": "反向传播太难了，完全跟不上",
    "changes": ["新增阶段0数学前置节点", "阶段1拆分成前向+反向两步", "延长阶段1至5天"]
  }
}

【few-shot 示例 2 — 想多练习】
原路径节选：阶段2：监督学习（线性回归、逻辑回归）
学生反馈：想多做几道题，感觉练习太少
助手：
{
  "content": "# 调整后的学习路径\\n\\n## 调整说明\\n在监督学习阶段末尾插入专项练习模块。\\n\\n## 阶段 2：监督学习（原内容保留）\\n- 线性回归原理与实现\\n- 逻辑回归与决策边界\\n\\n## 阶段 2.5（新增）：监督学习专项练习（2天）\\n1. 手推线性回归梯度推导\\n2. 用 sklearn 实现逻辑回归并绘制 ROC 曲线\\n3. 选做：对比 Ridge 与 Lasso 正则化效果",
  "metadata": {
    "agent": "path_agent",
    "adjustment_type": "add_practice",
    "original_feedback": "想多做几道题，练习太少",
    "changes": ["新增阶段2.5专项练习模块（3道题）"]
  }
}\
"""


async def adjust_path_stream(
    current_path: str,
    feedback: str,
    profile: StudentProfile,
) -> AsyncGenerator[str, None]:
    """
    根据学生反馈流式调整学习路径。

    策略：
    - 缓冲 LLM 流式输出，提取 content 字段
    - 以 30 字/块的速度模拟流式推送，兼顾前端体验与解析稳定性

    参数
    ----
    current_path : 当前路径正文（Markdown 格式）
    feedback     : 学生反馈文本，如"题库太难了"
    profile      : 最新学生画像
    """
    messages = [
        {"role": "system", "content": _ADJUST_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"【学生画像】\n{_profile_context(profile)}\n\n"
                f"【当前学习路径】\n{current_path or '（暂无路径，请直接生成一份适合该画像的新路径）'}\n\n"
                f"【学生反馈】\n{feedback.strip()}\n\n"
                "请根据以上反馈调整学习路径，输出完整的调整后路径。"
            ),
        },
    ]

    full_response = ""
    try:
        async for chunk in llm_service.chat_stream(messages, temperature=0.5):
            full_response += chunk
    except Exception:
        logger.exception("[path_agent] adjust_path_stream LLM 调用失败")
        yield "抱歉，路径调整服务暂时不可用，请稍后重试。"
        return

    content = _content_from_agent_response(full_response) or full_response.strip()
    if not content:
        logger.warning(
            "[path_agent] adjust_path_stream 未能提取有效 content，raw_len=%s",
            len(full_response),
        )
        yield "抱歉，未能生成调整后的路径，请重试。"
        return

    # 以小块重新推送，给前端流式体验
    chunk_size = 30
    for i in range(0, len(content), chunk_size):
        yield content[i : i + chunk_size]
        await asyncio.sleep(0.018)


async def recommend_resources(profile: StudentProfile, available_topics: list[str]) -> str:
    """根据画像推荐当前应该学习的资源"""
    topics_str = "\n".join(f"- {t}" for t in available_topics)

    messages = [
        {
            "role": "system",
            "content": """你是一位智能资源推荐助手（推荐 Agent），必须根据学生六维画像从已有主题中推荐最适合当前学习的内容。

【推荐原则】
- 推荐必须显式依据：专业方向、知识基础、认知风格、学习目标、学习节奏、薄弱知识点。
- 薄弱知识点对应主题优先；若已有主题不能直接覆盖，要推荐最接近的前置主题。
- 视觉型推荐含图解、导图、对比表的主题；逻辑型推荐概念链清晰的主题；实操型推荐实验或项目主题。

【统一输出格式】
你必须只输出一个合法 JSON 对象，不要输出 Markdown 代码块，不要在 JSON 前后添加任何文字。
JSON 结构固定为：
{
  "content": "给学生看的 Markdown 推荐正文",
  "metadata": {
    "agent": "recommendation_agent",
    "recommended_topics": ["主题1", "主题2", "主题3"],
    "profile_used": {
      "major": "使用到的专业方向",
      "knowledge_level": "使用到的知识基础",
      "cognitive_style": "使用到的认知风格",
      "learning_goal": "使用到的学习目标",
      "learning_pace": "使用到的学习节奏",
      "weak_points": ["使用到的薄弱知识点"]
    },
    "adaptation_notes": ["推荐理由摘要"]
  }
}

【few-shot 示例 1】
用户：入门、视觉型、薄弱点是过拟合，可选主题有机器学习基础、神经网络。
助手：
{
  "content": "# 推荐学习主题\\n\\n1. **机器学习基础**：先用图表理解训练集、验证集和过拟合现象。\\n2. **监督学习**：适合补充模型评估概念。\\n3. **神经网络入门**：作为后续进阶。",
  "metadata": {
    "agent": "recommendation_agent",
    "recommended_topics": ["机器学习基础", "监督学习", "神经网络入门"],
    "profile_used": {
      "major": "人工智能",
      "knowledge_level": "入门",
      "cognitive_style": "视觉型",
      "learning_goal": "兴趣",
      "learning_pace": "快速",
      "weak_points": ["过拟合"]
    },
    "adaptation_notes": ["优先补薄弱点", "推荐适合图解的基础主题"]
  }
}

【few-shot 示例 2】
用户：中级、逻辑型、考研目标、薄弱点是搜索算法。
助手：
{
  "content": "# 推荐学习主题\\n\\n1. **搜索算法与问题求解**：直接对应薄弱点，适合做概念辨析。\\n2. **机器学习基础**：补充 AI 课程主线。\\n3. **AI伦理与未来展望**：适合作为简答题素材。",
  "metadata": {
    "agent": "recommendation_agent",
    "recommended_topics": ["搜索算法与问题求解", "机器学习基础", "AI伦理与未来展望"],
    "profile_used": {
      "major": "计算机",
      "knowledge_level": "中级",
      "cognitive_style": "逻辑型",
      "learning_goal": "考研",
      "learning_pace": "深度",
      "weak_points": ["搜索算法"]
    },
    "adaptation_notes": ["优先考研易考主题", "突出逻辑辨析"]
  }
}""",
        },
        {
            "role": "user",
            "content": f"""学生情况：
{_profile_context(profile)}

当前已有资源主题：
{topics_str}

请推荐 3 个最适合该学生现阶段学习的主题，并说明推荐理由。""",
        },
    ]

    raw = await llm_service.chat_completion(messages, temperature=0.5)
    return _content_from_agent_response(raw)
