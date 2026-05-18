"""
智能辅导 Agent（加分项）
职责：学生在学习过程中遇到问题时，提供即时、个性化的答疑解惑服务

特点：
- 感知学生画像，自动调整解释深度与表达方式
- 多轮追问支持（保持对话上下文）
- 认知风格适配（视觉型/逻辑型/实操型 输出不同）
- 每次回答末尾附带「自查题」，帮助学生验证理解
- 防幻觉：只解答与学习相关的问题，对不确定内容明确告知
"""
from typing import AsyncGenerator
from app.services import llm_service, session_store
from app.models.schemas import StudentProfile

_STYLE_GUIDANCE = {
    "视觉型": "多用类比、ASCII图示或 Mermaid 流程图辅助说明，让抽象概念可视化。",
    "逻辑型": "注重定义的严谨性和推理过程，分步骤推导，逻辑链清晰。",
    "实操型": "先给出可直接运行的代码示例，再解释背后的原理。",
}

_LEVEL_GUIDANCE = {
    "入门": "避免术语堆砌，用日常生活类比，例子要简单直观。",
    "初级": "可以引入基本术语，但需配合解释，例子贴近初学者。",
    "中级": "可以使用专业术语，深入讲解原理，可涉及代码实现细节。",
    "高级": "可直接讨论底层机制、算法复杂度、工程权衡等高阶话题。",
}

_SYSTEM_TEMPLATE = """你是一位耐心专业的智能辅导助手（辅导Agent），专注于帮助大学生解决学习中的具体问题。

【当前学生画像】
- 知识基础：{knowledge_level}（{level_guidance}）
- 认知风格：{cognitive_style}（{style_guidance}）
- 学习目标：{learning_goal}
- 薄弱知识点：{weak_points}
- 正在学习：{current_topic}

【回答规范】
1. 使用 Markdown 格式，结构：核心解释 → 示例/代码（若适用）→ 类比理解（可选）
2. 严格按认知风格和知识基础调整内容深度
3. 在回答末尾用 `---` 分隔线后，添加一道「💡 自查一下」小题，帮助学生确认理解
4. 语气亲切鼓励，不给学生增加心理压力
5. 若问题超出学习范围或知识盲区，坦诚说明而不编造答案

【防幻觉要求】
- 只回答与课程/专业学习相关的问题
- 对不确定的知识点，明确用「这里我不完全确定，建议查阅...」提示
- 代码示例必须是标准、可运行的，注释用中文"""


def _build_system(profile: StudentProfile, topic: str) -> str:
    level = profile.knowledge_level or "初级"
    style = profile.cognitive_style or "逻辑型"
    return _SYSTEM_TEMPLATE.format(
        knowledge_level=level,
        level_guidance=_LEVEL_GUIDANCE.get(level, ""),
        cognitive_style=style,
        style_guidance=_STYLE_GUIDANCE.get(style, ""),
        learning_goal=profile.learning_goal or "学习提升",
        weak_points="、".join(profile.weak_points) if profile.weak_points else "暂无特别薄弱点",
        current_topic=topic or "通用学习内容",
    )


async def ask_stream(
    session_id: str,
    question: str,
    current_topic: str = "",
) -> AsyncGenerator[str, None]:
    """
    流式辅导问答
    - 保持多轮上下文（最近 10 条消息）
    - 自动从 session_store 读取学生画像
    """
    profile = session_store.get_profile(session_id)
    history = session_store.get_tutor_history(session_id)

    messages = [{"role": "system", "content": _build_system(profile, current_topic)}]
    messages.extend(history[-10:])
    messages.append({"role": "user", "content": question})

    full_response = ""
    async for chunk in llm_service.chat_stream(messages, temperature=0.5):
        full_response += chunk
        yield chunk

    session_store.append_tutor_history(session_id, "user", question)
    session_store.append_tutor_history(session_id, "assistant", full_response)


def get_suggested_questions(topic: str) -> list[str]:
    """
    根据主题返回推荐问题列表（帮助学生快速发起提问）
    """
    topic_questions: dict[str, list[str]] = {
        "机器学习基础": [
            "监督学习和无监督学习有什么区别？",
            "过拟合是什么？如何防止？",
            "什么是交叉验证，为什么要用它？",
            "损失函数的作用是什么？",
        ],
        "神经网络与深度学习": [
            "反向传播算法的原理是什么？",
            "激活函数为什么重要，常见的有哪些？",
            "Dropout 层的作用是什么？",
            "批归一化（Batch Norm）解决了什么问题？",
        ],
        "自然语言处理": [
            "词向量（Word2Vec）是怎么训练的？",
            "注意力机制（Attention）的直觉是什么？",
            "BERT 和 GPT 的主要区别是什么？",
            "什么是 tokenization，为什么需要它？",
        ],
        "大语言模型与Transformer": [
            "Transformer 的自注意力机制如何计算？",
            "位置编码（Positional Encoding）的作用是什么？",
            "预训练和微调（Fine-tuning）分别是什么？",
            "为什么大模型会产生幻觉？",
        ],
        "卷积神经网络（CNN）": [
            "卷积操作和全连接层有什么区别？",
            "池化层的作用是什么？",
            "什么是感受野（Receptive Field）？",
            "ResNet 中的残差连接解决了什么问题？",
        ],
        "强化学习基础": [
            "强化学习中的奖励函数如何设计？",
            "Q-learning 的更新公式如何理解？",
            "探索与利用的权衡（Exploration vs Exploitation）是什么？",
            "策略梯度方法和 Q-learning 的区别？",
        ],
        "AI概述与发展历史": [
            "AI 的三次浪潮分别是什么？",
            "图灵测试的意义和局限是什么？",
            "专家系统为什么在 80 年代失败了？",
            "深度学习为什么在 2012 年突破？",
        ],
    }

    default_questions = [
        "这个概念能用简单的话解释一下吗？",
        "能给我一个具体的例子吗？",
        "这个知识点在实际中怎么应用？",
        "学习这部分需要什么前置知识？",
    ]

    return topic_questions.get(topic, default_questions)
