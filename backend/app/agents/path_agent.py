"""
学习路径规划 Agent
职责：根据学生画像，为其规划个性化的课程学习路径
"""
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


async def plan_path(profile: StudentProfile, course: str = "人工智能导论") -> str:
    """根据画像生成个性化学习路径"""
    outline = COURSE_OUTLINE.get(course, COURSE_OUTLINE["人工智能导论"])
    outline_str = "\n".join(f"{i+1}. {topic}" for i, topic in enumerate(outline))

    weak_str = "、".join(profile.weak_points) if profile.weak_points else "暂无"
    level = profile.knowledge_level or "初级"
    goal = profile.learning_goal or "学习提升"
    pace = profile.learning_pace or "深度"
    time = profile.available_time or "每天1小时"

    messages = [
        {
            "role": "system",
            "content": """你是一位专业的教育路径规划师（路径规划Agent）。
请根据学生的个人情况，从给定的课程大纲中，制定个性化学习路径。
输出要求：
- 使用 Markdown 格式
- 分阶段规划（建议2-3个阶段），每阶段列出学习主题和预计时间
- 针对学生薄弱点重点安排
- 每个主题后简要说明学习建议（1句话）
- 最后给出整体学习计划时间预估""",
        },
        {
            "role": "user",
            "content": f"""学生情况：
- 课程：{course}
- 知识基础：{level}
- 学习目标：{goal}
- 薄弱知识点：{weak_str}
- 学习节奏偏好：{pace}
- 每日可用时间：{time}

课程大纲：
{outline_str}

请为该学生制定个性化学习路径。""",
        },
    ]

    return await llm_service.chat_completion(messages, temperature=0.5)


async def recommend_resources(profile: StudentProfile, available_topics: list[str]) -> str:
    """根据画像推荐当前应该学习的资源"""
    weak_str = "、".join(profile.weak_points) if profile.weak_points else "暂无特别薄弱点"
    topics_str = "\n".join(f"- {t}" for t in available_topics)

    messages = [
        {
            "role": "system",
            "content": "你是一位智能资源推荐助手（推荐Agent）。根据学生画像，从已有资源中推荐最适合当前学习的内容，并说明推荐理由。",
        },
        {
            "role": "user",
            "content": f"""学生情况：
- 知识基础：{profile.knowledge_level or "初级"}
- 薄弱知识点：{weak_str}
- 认知风格：{profile.cognitive_style or "未知"}

当前已有资源主题：
{topics_str}

请推荐 3 个最适合该学生现阶段学习的主题，并说明推荐理由。""",
        },
    ]

    return await llm_service.chat_completion(messages, temperature=0.5)
