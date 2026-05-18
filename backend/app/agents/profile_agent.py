"""
学生画像构建 Agent
职责：通过对话自动抽取学生信息，构建六维画像
六维：知识基础、认知风格、学习目标、易错点、学习节奏、可用时间
"""
import json
import re
from app.services import llm_service, session_store
from app.models.schemas import StudentProfile

SYSTEM_PROMPT = """你是一位友善的学习顾问助手，负责通过自然对话了解学生的学习情况，构建个性化学习画像。

你需要在对话中自然地收集以下信息（不要一次性问所有问题，循序渐进）：
1. 姓名（可选）和所学专业
2. 知识基础：对当前课程的掌握程度（入门/初级/中级/高级）
3. 认知风格：偏好哪种学习方式（视觉图形型/逻辑推理型/动手实操型）
4. 学习目标：学习这门课的目的（考研备考/竞赛提升/求职就业/个人兴趣）
5. 薄弱知识点：觉得哪些内容最难理解或容易出错
6. 学习节奏：喜欢快速浏览还是深度钻研
7. 每日可用时间：每天大概能花多少时间学习

只要你已经从当前轮或历史对话中确认了任意画像信息，就在回复末尾附加如下 JSON 标记（用 ```json_profile``` 包裹），用于系统解析：
```json_profile
{
  "major": "...",
  "knowledge_level": "入门|初级|中级|高级",
  "cognitive_style": "视觉型|逻辑型|实操型",
  "learning_goal": "考研|竞赛|就业|兴趣",
  "weak_points": ["知识点1", "知识点2"],
  "learning_pace": "快速|深度",
  "available_time": "每天X小时",
  "completed": true
}
```

未确认的字段可以省略或填 null；如果信息还不完整，请将 completed 设为 false，并继续自然对话引导。
回复使用中文，语气亲切自然。"""


def _extract_profile_json(text: str) -> dict | None:
    """从 LLM 回复中提取画像 JSON"""
    start = text.find("```json_profile")
    end = text.find("```", start + 15)
    if start == -1 or end == -1:
        return None
    json_str = text[start + 15:end].strip()
    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        return None


def _clean_response(text: str) -> str:
    """去掉给用户展示的文本中的 JSON 标记块"""
    start = text.find("```json_profile")
    if start == -1:
        return text
    return text[:start].strip()


def _apply_profile_data(profile: StudentProfile, profile_data: dict | None) -> StudentProfile:
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

    session_store.update_profile(profile)
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


def infer_and_update_profile(session_id: str, user_message: str) -> StudentProfile:
    """先用规则从用户消息中提取明显画像信息，便于前端实时展示。"""
    profile = session_store.get_profile(session_id)
    return _apply_profile_data(profile, _infer_profile_from_user_message(user_message))


async def chat(session_id: str, user_message: str) -> tuple[str, StudentProfile]:
    """
    处理用户消息，返回 (回复文本, 最新画像)
    """
    profile = infer_and_update_profile(session_id, user_message)
    history = session_store.get_history(session_id)

    # 构建消息列表
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    # 调用 LLM
    raw_response = await llm_service.chat_completion(messages)

    # 尝试解析画像更新
    profile = _apply_profile_data(profile, _extract_profile_json(raw_response))

    # 清理回复（移除 JSON 标记），存历史
    clean_reply = _clean_response(raw_response)
    session_store.append_history(session_id, "user", user_message)
    session_store.append_history(session_id, "assistant", clean_reply)

    return clean_reply, profile


async def chat_stream(session_id: str, user_message: str):
    """
    流式版本，yield 干净的文本片段（自动过滤 json_profile 标记块）
    在内部完成 profile 提取和 session 更新，调用方无需做任何裁剪。
    """
    profile = infer_and_update_profile(session_id, user_message)
    history = session_store.get_history(session_id)

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    MARKER = "```json_profile"
    full_response = ""
    yielded_up_to = 0        # 已 yield 到 full_response 的第几个字符

    async for chunk in llm_service.chat_stream(messages):
        full_response += chunk
        marker_pos = full_response.find(MARKER)

        if marker_pos == -1:
            # 标记尚未出现：留出 MARKER长度-1 的尾缓冲，防止标记跨 chunk 被截断
            safe_end = max(yielded_up_to, len(full_response) - (len(MARKER) - 1))
            if safe_end > yielded_up_to:
                yield full_response[yielded_up_to:safe_end]
                yielded_up_to = safe_end
        else:
            # 标记已出现：yield 标记前的内容（若还有未 yield 的部分）
            if marker_pos > yielded_up_to:
                yield full_response[yielded_up_to:marker_pos]
                yielded_up_to = marker_pos
            # 剩余内容含 JSON，继续消费但不 yield

    # 流结束：yield 剩余缓冲（仅当全程无 marker 时）
    marker_pos = full_response.find(MARKER)
    if marker_pos == -1 and yielded_up_to < len(full_response):
        yield full_response[yielded_up_to:]

    # 提取并更新画像（始终在流结束后执行，无论是否 break）
    profile = _apply_profile_data(profile, _extract_profile_json(full_response))

    clean_reply = _clean_response(full_response)
    session_store.append_history(session_id, "user", user_message)
    session_store.append_history(session_id, "assistant", clean_reply)
