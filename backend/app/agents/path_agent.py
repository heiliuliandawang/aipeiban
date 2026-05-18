"""
学习路径规划 Agent
职责：根据学生画像，为其规划个性化的课程学习路径
"""
import json

from app.services import llm_service
from app.models.schemas import StudentProfile

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
    return f"""- 专业方向：{profile.major or "未知"}
- 知识基础：{profile.knowledge_level or "初级"}
- 认知风格：{profile.cognitive_style or "逻辑型"}
- 学习目标：{profile.learning_goal or "学习提升"}
- 学习节奏：{profile.learning_pace or "深度"}
- 薄弱知识点：{"、".join(profile.weak_points) if profile.weak_points else "暂无特别薄弱点"}
- 每日可用时间：{profile.available_time or "每天1小时"}"""


def _content_from_agent_response(raw: str) -> str:
    try:
        data = json.loads(raw.strip())
    except json.JSONDecodeError:
        return raw
    if isinstance(data, dict) and isinstance(data.get("content"), str):
        return data["content"]
    return raw


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
    return _content_from_agent_response(raw)


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
