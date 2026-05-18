"""
学生画像构建 Agent
职责：通过对话自动抽取学生信息，构建六维画像
六维：专业方向、知识基础、认知风格、学习目标、学习节奏、薄弱知识点
"""
import json
import re
from app.services import llm_service, session_store
from app.models.schemas import StudentProfile

SYSTEM_PROMPT = """你是一位友善、专业的学习画像构建 Agent，负责通过自然对话收集学生的六维学习画像，并在每轮对话后输出结构化 JSON。

【必须收集的六维画像】
1. 专业方向 major：学生专业、学习方向或当前关注领域。
2. 知识基础 knowledge_level：只能是「入门」「初级」「中级」「高级」之一。
3. 认知风格 cognitive_style：只能是「视觉型」「逻辑型」「实操型」之一。
4. 学习目标 learning_goal：只能是「考研」「竞赛」「就业」「兴趣」之一。
5. 学习节奏 learning_pace：只能是「快速」「深度」之一。
6. 薄弱知识点 weak_points：学生明确觉得难、容易错或需要补强的知识点列表。

【对话策略】
- 不要一次性问完所有维度，每轮优先追问 1-2 个缺失或不明确的维度。
- 如果用户一句话里包含多个维度，要全部抽取并更新。
- 对不确定的信息不要臆测，未知字段用 null 或空数组。
- 每次回复都要先回应用户当前表达，再自然引导下一个关键信息。
- 如果画像已基本完整，content 中给出简短确认，并说明后续资源会按画像个性化。

【统一输出格式】
你必须只输出一个合法 JSON 对象，不要输出 Markdown 代码块，不要在 JSON 前后添加任何文字。
JSON 结构固定为：
{
  "content": "给学生看的中文自然语言回复",
  "metadata": {
    "agent": "profile_agent",
    "profile_update": {
      "major": "专业方向或 null",
      "knowledge_level": "入门|初级|中级|高级|null",
      "cognitive_style": "视觉型|逻辑型|实操型|null",
      "learning_goal": "考研|竞赛|就业|兴趣|null",
      "learning_pace": "快速|深度|null",
      "weak_points": ["薄弱知识点"],
      "available_time": "每天可用时间或 null",
      "completed": false
    },
    "next_focus": ["下一轮建议追问的维度"]
  }
}

【few-shot 示例 1】
用户：我是计算机专业大二学生，刚开始学人工智能，想为就业做准备。
助手：
{
  "content": "了解啦，你是计算机专业大二学生，AI 基础还处在入门阶段，目标偏就业。我接下来会按更实用的路线帮你规划。为了更贴合你，我还想了解一下：你更喜欢看图表理解概念、按逻辑推导理解，还是通过代码实操来掌握？",
  "metadata": {
    "agent": "profile_agent",
    "profile_update": {
      "major": "计算机",
      "knowledge_level": "入门",
      "cognitive_style": null,
      "learning_goal": "就业",
      "learning_pace": null,
      "weak_points": [],
      "available_time": null,
      "completed": false
    },
    "next_focus": ["认知风格", "学习节奏", "薄弱知识点"]
  }
}

【few-shot 示例 2】
用户：我喜欢先看图和表格，节奏希望快一点，最近反向传播和矩阵求导总是搞混，每天大概 1.5 小时。
助手：
{
  "content": "好的，你更偏视觉型学习，适合用流程图、表格和对比图来理解；学习节奏希望快一些。反向传播和矩阵求导会作为重点薄弱点处理。我已经能形成较完整画像，后续会优先用图解和针对性练习帮你补这两块。",
  "metadata": {
    "agent": "profile_agent",
    "profile_update": {
      "major": null,
      "knowledge_level": null,
      "cognitive_style": "视觉型",
      "learning_goal": null,
      "learning_pace": "快速",
      "weak_points": ["反向传播", "矩阵求导"],
      "available_time": "每天1.5小时",
      "completed": true
    },
    "next_focus": []
  }
}"""


def _extract_agent_json(text: str) -> dict | None:
    """从 LLM 回复中提取统一 JSON；兼容旧版 json_profile 标记块。"""
    cleaned = text.strip()
    try:
        value = json.loads(cleaned)
        return value if isinstance(value, dict) else None
    except json.JSONDecodeError:
        pass

    start = text.find("```json_profile")
    end = text.find("```", start + 15)
    if start == -1 or end == -1:
        return None
    json_str = text[start + 15:end].strip()
    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        return None


def _extract_profile_json(text: str) -> dict | None:
    """从统一 JSON 的 metadata.profile_update 中提取画像更新。"""
    data = _extract_agent_json(text)
    if not data:
        return None
    metadata = data.get("metadata")
    if isinstance(metadata, dict) and isinstance(metadata.get("profile_update"), dict):
        return metadata["profile_update"]
    return data


def _clean_response(text: str) -> str:
    """返回给用户展示的 content；兼容旧版 JSON 标记块。"""
    data = _extract_agent_json(text)
    if isinstance(data, dict) and isinstance(data.get("content"), str):
        return data["content"].strip()

    start = text.find("```json_profile")
    if start == -1:
        return text
    return text[:start].strip()


async def _apply_profile_data(profile: StudentProfile, profile_data: dict | None) -> StudentProfile:
    """将 LLM 返回的部分画像信息合并进现有 profile。"""
    if not profile_data:
        return profile

    if profile_data.get("major"):
        profile.major = profile_data["major"]
    if profile_data.get("knowledge_level"):
        profile.knowledge_level = profile_data["knowledge_level"]
    if profile_data.get("cognitive_style"):
        profile.cognitive_style = profile_data["cognitive_style"]
    if profile_data.get("learning_goal"):
        profile.learning_goal = profile_data["learning_goal"]
    if profile_data.get("weak_points"):
        profile.weak_points = profile_data["weak_points"]
    if profile_data.get("learning_pace"):
        profile.learning_pace = profile_data["learning_pace"]
    if profile_data.get("available_time"):
        profile.available_time = profile_data["available_time"]

    if profile_data.get("completed") is True:
        profile.completed_at = True

    await session_store.update_profile(profile)
    return profile


def _infer_profile_from_user_message(text: str) -> dict | None:
    """从用户原话中做轻量规则提取，保证画像侧栏能及时刷新。"""
    content = text.strip()
    if not content:
        return None

    result: dict = {}

    major_match = re.search(
        r"(?:我是|本人是|学的是|读的是)?([\u4e00-\u9fffA-Za-z0-9·、/]+(?:与[\u4e00-\u9fffA-Za-z0-9·、/]+)*)专业",
        content,
    )
    if major_match:
        result["major"] = major_match.group(1).strip()

    if any(keyword in content for keyword in ["零基础", "没有基础", "小白"]):
        result["knowledge_level"] = "入门"
    elif any(keyword in content for keyword in ["基础一般", "一般般", "基础薄弱", "会一点", "接触过"]):
        result["knowledge_level"] = "初级"
    elif any(keyword in content for keyword in ["基础不错", "比较熟悉", "做过项目", "有经验", "中级"]):
        result["knowledge_level"] = "中级"
    elif any(keyword in content for keyword in ["高级", "精通", "很熟练"]):
        result["knowledge_level"] = "高级"

    if "考研" in content:
        result["learning_goal"] = "考研"
    elif "竞赛" in content:
        result["learning_goal"] = "竞赛"
    elif any(keyword in content for keyword in ["就业", "实习", "工作", "赚钱", "接单"]):
        result["learning_goal"] = "就业"
    elif any(keyword in content for keyword in ["兴趣", "感兴趣", "喜欢"]):
        result["learning_goal"] = "兴趣"

    weak_points: list[str] = []
    weak_point_keywords = {
        "反爬": "反爬机制",
        "逆向": "逆向分析",
        "数据解析": "数据解析",
        "网络请求": "网络请求",
        "存储": "数据存储",
        "验证码": "验证码处理",
        "代理": "代理与 IP 池",
    }
    for keyword, label in weak_point_keywords.items():
        if keyword in content:
            weak_points.append(label)
    if weak_points:
        result["weak_points"] = weak_points

    if any(keyword in content for keyword in ["深入", "深度", "钻研", "细节"]):
        result["learning_pace"] = "深度"
    elif "快速" in content:
        result["learning_pace"] = "快速"

    time_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:个)?小时", content)
    if time_match:
        result["available_time"] = f"每天{time_match.group(1)}小时"

    if any(keyword in content for keyword in ["看视频", "视频教程", "图解", "图文"]):
        result["cognitive_style"] = "视觉型"
    if any(keyword in content for keyword in ["实践", "动手", "实操", "项目"]):
        result["cognitive_style"] = "实操型"

    return result or None


async def infer_and_update_profile(session_id: str, user_message: str) -> StudentProfile:
    """先用规则从用户消息中提取明显画像信息，便于前端实时展示。"""
    profile = await session_store.get_profile(session_id)
    return await _apply_profile_data(profile, _infer_profile_from_user_message(user_message))


async def chat(session_id: str, user_message: str) -> tuple[str, StudentProfile]:
    """
    处理用户消息，返回 (回复文本, 最新画像)
    """
    profile = await infer_and_update_profile(session_id, user_message)
    history = await session_store.get_history(session_id)

    # 构建消息列表
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    # 调用 LLM
    raw_response = await llm_service.chat_completion(messages)

    # 尝试解析画像更新
    profile = await _apply_profile_data(profile, _extract_profile_json(raw_response))

    # 清理回复（移除 JSON 标记），存历史
    clean_reply = _clean_response(raw_response)
    await session_store.append_history(session_id, "user", user_message)
    await session_store.append_history(session_id, "assistant", clean_reply)

    return clean_reply, profile


async def chat_stream(session_id: str, user_message: str):
    """
    流式版本，yield 干净的 content（自动过滤统一 JSON 外壳）
    在内部完成 profile 提取和 session 更新，调用方无需做任何裁剪。
    """
    profile = await infer_and_update_profile(session_id, user_message)
    history = await session_store.get_history(session_id)

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    full_response = ""

    async for chunk in llm_service.chat_stream(messages):
        full_response += chunk

    # 提取并更新画像（始终在流结束后执行，无论是否 break）
    profile = await _apply_profile_data(profile, _extract_profile_json(full_response))

    clean_reply = _clean_response(full_response)
    if clean_reply:
        yield clean_reply
    await session_store.append_history(session_id, "user", user_message)
    await session_store.append_history(session_id, "assistant", clean_reply)
