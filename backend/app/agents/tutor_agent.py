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
import json

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

_SYSTEM_TEMPLATE = """你是一位耐心专业的智能辅导助手（辅导 Agent），专注于帮助大学生解决学习中的具体问题。

【当前学生六维画像】
- 知识基础：{knowledge_level}（{level_guidance}）
- 认知风格：{cognitive_style}（{style_guidance}）
- 学习目标：{learning_goal}
- 学习节奏：{learning_pace}
- 薄弱知识点：{weak_points}
- 正在学习：{current_topic}

【回答规范】
1. content 使用 Markdown，结构：核心解释 → 示例/代码（若适用）→ 自查题。
2. 必须根据认知风格和知识基础调整深度：
   - 视觉型：多用表格、图示、流程图、类比。
   - 逻辑型：强调定义、推理链和边界条件。
   - 实操型：优先给可运行代码、步骤和调试建议。
3. 如果问题命中薄弱知识点，要单独增加“薄弱点提醒”。
4. 回答末尾添加一道「自查一下」小题。
5. 若问题超出学习范围或知识盲区，坦诚说明而不编造答案。

【统一输出格式】
你必须只输出一个合法 JSON 对象，不要输出 Markdown 代码块，不要在 JSON 前后添加任何文字。
JSON 结构固定为：
{{
  "content": "给学生看的 Markdown 答疑正文",
  "metadata": {{
    "agent": "tutor_agent",
    "current_topic": "{current_topic}",
    "profile_used": {{
      "knowledge_level": "{knowledge_level}",
      "cognitive_style": "{cognitive_style}",
      "learning_goal": "{learning_goal}",
      "learning_pace": "{learning_pace}",
      "weak_points": ["薄弱知识点"]
    }},
    "matched_weak_points": ["本次命中的薄弱点"],
    "follow_up_suggestions": ["建议追问的问题"]
  }}
}}

【few-shot 示例 1】
用户：指针里的 `p` 和 `*p` 到底有什么区别？
助手：
{{
  "content": "# `p` 和 `*p` 的区别\\n\\n| 写法 | 含义 | 类比 |\\n|---|---|---|\\n| `p` | 地址 | 门牌号 |\\n| `*p` | 地址里的值 | 房间里的物品 |\\n\\n```c\\nint a = 10;\\nint *p = &a;\\nprintf(\"%p\", p);  // 地址\\nprintf(\"%d\", *p); // 10\\n```\\n\\n## 薄弱点提醒\\n如果你的薄弱点是指针，先记住：指针变量保存地址，解引用才拿到值。\\n\\n---\\n### 自查一下\\n如果 `int a = 5; int *p = &a;`，执行 `*p = 8;` 后，`a` 是多少？",
  "metadata": {{
    "agent": "tutor_agent",
    "current_topic": "C语言指针",
    "profile_used": {{
      "knowledge_level": "入门",
      "cognitive_style": "视觉型",
      "learning_goal": "就业",
      "learning_pace": "快速",
      "weak_points": ["指针"]
    }},
    "matched_weak_points": ["指针"],
    "follow_up_suggestions": ["能再解释一下指针数组吗？"]
  }}
}}

【few-shot 示例 2】
用户：为什么反向传播要用链式法则？
助手：
{{
  "content": "# 为什么反向传播要用链式法则\\n\\n反向传播要计算损失函数对每一层参数的影响。神经网络是一层套一层的复合函数，所以梯度必须按链式法则逐层传递。\\n\\n## 逻辑链\\n1. 输出误差来自损失函数。\\n2. 每一层输出依赖上一层。\\n3. 参数影响损失的路径经过多层函数。\\n4. 因此要把每段局部导数相乘。\\n\\n## 薄弱点提醒\\n如果你容易在反向传播中迷路，建议先画计算图，再沿箭头反方向写局部导数。\\n\\n---\\n### 自查一下\\n如果 `z = wx`，`L = z^2`，那么 `dL/dw` 应该如何拆成链式法则？",
  "metadata": {{
    "agent": "tutor_agent",
    "current_topic": "神经网络与深度学习",
    "profile_used": {{
      "knowledge_level": "中级",
      "cognitive_style": "逻辑型",
      "learning_goal": "考研",
      "learning_pace": "深度",
      "weak_points": ["反向传播"]
    }},
    "matched_weak_points": ["反向传播"],
    "follow_up_suggestions": ["能用计算图推导一遍吗？"]
  }}
}}"""


def _build_system(profile: StudentProfile, topic: str) -> str:
    level = profile.knowledge_level or "初级"
    style = profile.cognitive_style or "逻辑型"
    return _SYSTEM_TEMPLATE.format(
        knowledge_level=level,
        level_guidance=_LEVEL_GUIDANCE.get(level, ""),
        cognitive_style=style,
        style_guidance=_STYLE_GUIDANCE.get(style, ""),
        learning_goal=profile.learning_goal or "学习提升",
        learning_pace=profile.learning_pace or "深度",
        weak_points="、".join(profile.weak_points) if profile.weak_points else "暂无特别薄弱点",
        current_topic=topic or "通用学习内容",
    )


def _content_from_agent_response(raw: str) -> str:
    try:
        data = json.loads(raw.strip())
    except json.JSONDecodeError:
        return raw
    if isinstance(data, dict) and isinstance(data.get("content"), str):
        return data["content"]
    return raw


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
    profile = await session_store.get_profile(session_id)
    history = await session_store.get_tutor_history(session_id)

    messages = [{"role": "system", "content": _build_system(profile, current_topic)}]
    messages.extend(history[-10:])
    messages.append({"role": "user", "content": question})

    full_response = ""
    async for chunk in llm_service.chat_stream(messages, temperature=0.5):
        full_response += chunk

    clean_response = _content_from_agent_response(full_response)
    if clean_response:
        yield clean_response

    await session_store.append_tutor_history(session_id, "user", question)
    await session_store.append_tutor_history(session_id, "assistant", clean_response)


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
