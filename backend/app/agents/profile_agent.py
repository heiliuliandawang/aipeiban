"""
学生画像构建 Agent — 六维重构版

六维画像定义
────────────
1. knowledge_mastery   知识掌握度   float 0.0–1.0
2. learning_preference 学习偏好    视觉型 | 逻辑型 | 实操型
3. learning_goal       学习目标    考研 | 竞赛 | 就业 | 兴趣
4. weak_points         薄弱知识点  list[str]
5. programming_experience 编程经验 无 | 初级 | 中级 | 高级
6. learning_pace       学习节奏    快速 | 深度

设计说明
────────
- SYSTEM_PROMPT 是静态常量；每次调用时在 system 消息末尾注入当前画像快照，
  让 LLM 在多轮对话中感知已收集的维度，避免重复提问。
- _rule_extract：同步规则推断，用于 infer_and_update_profile（首帧即时刷新侧栏）。
- _extract_profile_update：解析 LLM 输出的 JSON，容错三种常见格式。
- _merge_profile_update：增量合并，weak_points 做 union 去重，
  knowledge_mastery 取 max（只升不降），completed_at 只能 false→true。
- 异常路径：LLM 调用失败时记录日志并返回友好提示，不抛出给调用方。
"""
import json
import logging
import re
from typing import AsyncGenerator, TypedDict

from app.models.schemas import StudentProfile
from app.services import llm_service, session_store
from app.services.content_filter import content_filter

logger = logging.getLogger(__name__)

# ── 类型定义 ─────────────────────────────────────────────────────────────────


class ProfileUpdate(TypedDict, total=False):
    """LLM profile_update 块的类型化结构，所有字段均可选。"""
    knowledge_mastery: float | None
    learning_preference: str | None
    learning_goal: str | None
    weak_points: list[str]
    programming_experience: str | None
    learning_pace: str | None
    major: str | None
    available_time: str | None
    completed: bool


# ── 常量 ─────────────────────────────────────────────────────────────────────

_VALID_PREFERENCES: frozenset[str] = frozenset({"视觉型", "逻辑型", "实操型"})
_VALID_GOALS: frozenset[str] = frozenset({"考研", "竞赛", "就业", "兴趣"})
_VALID_PACES: frozenset[str] = frozenset({"快速", "深度"})
_VALID_PROG_EXP: frozenset[str] = frozenset({"无", "初级", "中级", "高级"})

# knowledge_mastery → knowledge_level（向后兼容标签）
_MASTERY_THRESHOLDS: list[tuple[float, str]] = [
    (0.25, "入门"),
    (0.50, "初级"),
    (0.75, "中级"),
    (1.01, "高级"),
]

# 默认画像（LLM 失败时使用）
_DEFAULT_PROFILE_UPDATE: ProfileUpdate = {
    "knowledge_mastery": None,
    "learning_preference": None,
    "learning_goal": None,
    "weak_points": [],
    "programming_experience": None,
    "learning_pace": None,
    "major": None,
    "available_time": None,
    "completed": False,
}

# ── Prompt ───────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
你是一位友善、专业的学习画像构建 Agent。  
职责：通过自然对话逐轮收集学生的六维学习画像，并在每轮回复后输出结构化 JSON。

【六维画像定义】
1. knowledge_mastery（知识掌握度）: 0.0–1.0 的浮点数。
   0.0–0.25 完全没接触 | 0.25–0.5 入门了解 | 0.5–0.75 初步掌握 | 0.75–1.0 熟练/精通
   请根据用户描述给出合理估计：「刚开始学」≈0.2，「接触过但不熟」≈0.35，「做过项目」≈0.65，「深度研究」≈0.85。

2. learning_preference（学习偏好）: 只能是 "视觉型" | "逻辑型" | "实操型" | null。
   视觉型=喜欢图表/流程图/可视化 | 逻辑型=喜欢公式/推导/定义 | 实操型=喜欢写代码/做项目

3. learning_goal（学习目标）: 只能是 "考研" | "竞赛" | "就业" | "兴趣" | null。

4. weak_points（薄弱知识点）: 字符串数组，空数组表示暂无。只记录学生明确提到的难点。

5. programming_experience（编程经验）: 只能是 "无" | "初级" | "中级" | "高级" | null。
   无=从未写过代码 | 初级=写过脚本/入门课 | 中级=有项目经验 | 高级=熟悉框架底层/多年经验

6. learning_pace（学习节奏）: 只能是 "快速" | "深度" | null。
   快速=先抓重点快速过一遍 | 深度=深入理解每个细节再推进

【对话策略】
- 每轮先自然回应用户内容，再追问 1–2 个最关键的缺失维度。
- 用户一句话可能包含多个维度，全部抽取。
- 对不确定信息保持 null，不猜测。
- 六个维度均已收集后，content 中确认完整并告知后续资源将个性化。

【统一输出格式】
必须只输出一个合法 JSON 对象（不要 Markdown 代码块，JSON 前后不加任何文字）：
{
  "content": "给学生看的中文回复（支持 Markdown）",
  "metadata": {
    "agent": "profile_agent",
    "profile_update": {
      "knowledge_mastery": 0.3,
      "learning_preference": "实操型",
      "learning_goal": "就业",
      "weak_points": ["反向传播"],
      "programming_experience": "初级",
      "learning_pace": "快速",
      "major": "计算机科学",
      "available_time": "每天2小时",
      "completed": false
    },
    "next_focus": ["尚未填写的维度名"]
  }
}

【few-shot 示例 1 — 首轮，信息较多】
用户：我是计算机科学大二学生，机器学习刚开始接触，写过一些 Python 脚本，想找 AI 方向的工作。
助手：
{
  "content": "你好！了解了，你是计算机科学专业大二，机器学习刚起步，有一定 Python 基础，目标是 AI 方向就业，规划得很清晰！\n\n为了更精准地帮你规划，想再问两点：\n1. 学习时你更倾向于哪种方式——看图表/可视化理解概念、推导公式/定义，还是直接上手写代码？\n2. 希望学习节奏是**快速过重点**还是**深入研究细节**？",
  "metadata": {
    "agent": "profile_agent",
    "profile_update": {
      "knowledge_mastery": 0.2,
      "learning_preference": null,
      "learning_goal": "就业",
      "weak_points": [],
      "programming_experience": "初级",
      "learning_pace": null,
      "major": "计算机科学",
      "available_time": null,
      "completed": false
    },
    "next_focus": ["learning_preference", "learning_pace", "weak_points"]
  }
}

【few-shot 示例 2 — 补充轮次，完成画像】
用户：我喜欢边写代码边理解，节奏快一些。反向传播和梯度消失总搞不清，每天大概 1.5 小时。
助手：
{
  "content": "明白了！你是**实操型**学习者，直接写代码理解效果最好；节奏偏快速。\n\n反向传播和梯度消失会作为**专项弱点**优先强化。每天 1.5 小时，快速模式下完全够用。\n\n🎉 **你的六维画像已完整**，后续资源将按以下画像个性化生成：\n- 知识掌握度：约 0.20（入门起步）\n- 学习偏好：实操型\n- 薄弱点：反向传播、梯度消失",
  "metadata": {
    "agent": "profile_agent",
    "profile_update": {
      "knowledge_mastery": null,
      "learning_preference": "实操型",
      "learning_goal": null,
      "weak_points": ["反向传播", "梯度消失"],
      "programming_experience": null,
      "learning_pace": "快速",
      "major": null,
      "available_time": "每天1.5小时",
      "completed": true
    },
    "next_focus": []
  }
}

【few-shot 示例 3 — 高水平用户，竞赛方向】
用户：我研究生在读，做过两年深度学习项目，熟悉 PyTorch，想备考算法竞赛，Transformer 位置编码有些模糊。
助手：
{
  "content": "你好！两年深度学习项目经验，熟悉 PyTorch，基础相当扎实，掌握度应该在 0.75 以上。目标是算法竞赛，Transformer 位置编码是明确弱点，我会重点安排。\n\n还想了解一下：\n1. 你更倾向深入推导数学原理，还是先实现再理解？\n2. 每天大概能投入多少时间？",
  "metadata": {
    "agent": "profile_agent",
    "profile_update": {
      "knowledge_mastery": 0.78,
      "learning_preference": null,
      "learning_goal": "竞赛",
      "weak_points": ["Transformer位置编码"],
      "programming_experience": "高级",
      "learning_pace": null,
      "major": null,
      "available_time": null,
      "completed": false
    },
    "next_focus": ["learning_preference", "learning_pace"]
  }
}\
"""

# 当前画像状态注入模板（动态拼入 system 消息末尾）
_PROFILE_CONTEXT_TEMPLATE = """
【当前已收集的画像（null 表示尚未获取）】
- knowledge_mastery   知识掌握度:    {knowledge_mastery}
- learning_preference 学习偏好:      {learning_preference}
- learning_goal       学习目标:      {learning_goal}
- weak_points         薄弱知识点:    {weak_points}
- programming_experience 编程经验:   {programming_experience}
- learning_pace       学习节奏:      {learning_pace}
- major               专业方向:      {major}
- available_time      每日时间:      {available_time}

请根据以上已知信息决定本轮追问方向，不要重复询问已有的维度。\
"""

# ── 辅助：mastery ↔ level ────────────────────────────────────────────────────


def _mastery_to_level(mastery: float) -> str:
    """将 0.0–1.0 掌握度映射为旧 knowledge_level 标签（向后兼容）。"""
    for threshold, label in _MASTERY_THRESHOLDS:
        if mastery < threshold:
            return label
    return "高级"


def _level_to_mastery(level: str) -> float:
    """将旧 knowledge_level 标签近似转换为掌握度（仅规则提取使用）。"""
    mapping = {"入门": 0.15, "初级": 0.35, "中级": 0.60, "高级": 0.85}
    return mapping.get(level, 0.2)


# ── JSON 解析 ────────────────────────────────────────────────────────────────


def _normalize_agent_raw(text: str) -> str:
    """去掉 Markdown 围栏、JSON 前的说明文字等常见包裹。"""
    cleaned = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned, re.IGNORECASE)
    if fence:
        cleaned = fence.group(1).strip()
    brace = cleaned.find("{")
    if brace > 0:
        cleaned = cleaned[brace:]
    return cleaned


def _unescape_json_string(raw: str) -> str:
    try:
        return json.loads(f'"{raw}"')
    except json.JSONDecodeError:
        return (
            raw.replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace('\\"', '"')
            .replace("\\\\", "\\")
        )


def _extract_quoted_field(text: str, field: str) -> str | None:
    """
    从 Agent JSON 中提取字符串字段；兼容 content 内含未转义换行导致整段 JSON 非法的情况。
    """
    m = re.search(rf'"{re.escape(field)}"\s*:\s*"', text, re.DOTALL)
    if not m:
        return None
    start = m.end()

    # 优先：在 metadata 块之前截断（模型常把 content 写成多行纯文本）
    meta = re.search(r'"\s*,\s*"metadata"\s*:', text[start:], re.DOTALL)
    if meta:
        return _unescape_json_string(text[start : start + meta.start()])

    out: list[str] = []
    i = start
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text):
            out.append(text[i : i + 2])
            i += 2
            continue
        if ch == '"':
            break
        out.append(ch)
        i += 1
    return _unescape_json_string("".join(out))


def _extract_json_object_at(text: str, open_index: int) -> dict | None:
    """从 open_index 处的 `{` 起做括号匹配，尝试解析单个 JSON 对象。"""
    if open_index < 0 or open_index >= len(text) or text[open_index] != "{":
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(open_index, len(text)):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    val = json.loads(text[open_index : i + 1])
                except json.JSONDecodeError:
                    return None
                return val if isinstance(val, dict) else None
    return None


def _extract_agent_json(text: str) -> dict | None:
    """
    从 LLM 回复中提取 JSON 对象，容错：
    1. 纯 JSON
    2. Markdown 代码块
    3. 前置说明文字 + JSON
    4. JSONDecoder.raw_decode（尾部多余文字）
    5. 括号匹配提取首个对象
    """
    cleaned = _normalize_agent_raw(text)
    if not cleaned:
        return None

    try:
        val = json.loads(cleaned)
        return val if isinstance(val, dict) else None
    except json.JSONDecodeError:
        pass

    try:
        val, _ = json.JSONDecoder().raw_decode(cleaned)
        return val if isinstance(val, dict) else None
    except json.JSONDecodeError:
        pass

    return _extract_json_object_at(cleaned, cleaned.find("{"))


def _extract_profile_update_fallback(text: str) -> ProfileUpdate | None:
    """整段 JSON 非法时，单独抠出 profile_update 对象。"""
    m = re.search(r'"profile_update"\s*:\s*\{', text)
    if not m:
        return None
    obj = _extract_json_object_at(text, m.end() - 1)
    return obj if isinstance(obj, dict) else None  # type: ignore[return-value]


def _extract_profile_update(text: str) -> ProfileUpdate | None:
    """
    从 LLM 回复文本中提取 profile_update 字典。
    优先读 metadata.profile_update，兼容直接返回扁平字典的旧格式。
    """
    data = _extract_agent_json(text)

    if data:
        metadata = data.get("metadata")
        if isinstance(metadata, dict):
            update = metadata.get("profile_update")
            if isinstance(update, dict):
                return update  # type: ignore[return-value]
        if "knowledge_mastery" in data or "learning_goal" in data:
            return data  # type: ignore[return-value]

    return _extract_profile_update_fallback(text)


def _clean_response(text: str) -> str:
    """提取供前端展示的 content；避免把 Agent 结构化 JSON 原样显示给用户。"""
    data = _extract_agent_json(text)
    if isinstance(data, dict) and isinstance(data.get("content"), str):
        return data["content"].strip()

    content = _extract_quoted_field(text, "content")
    if content:
        return content.strip()

    idx = text.find("```json_profile")
    if idx != -1:
        return text[:idx].strip()

    # 仍无法解析时，不展示整段 JSON 外壳
    normalized = _normalize_agent_raw(text)
    if normalized.startswith("{") and '"content"' in normalized:
        return "抱歉，回复格式解析失败，请重试或换种说法描述你的情况。"
    return text.strip()


# ── 画像合并 ─────────────────────────────────────────────────────────────────


def _merge_profile_update(
    profile: StudentProfile, update: ProfileUpdate
) -> StudentProfile:
    """
    将 LLM 返回的 profile_update 增量合并到现有画像。

    合并规则
    --------
    - 标量字段：仅当 update 中值非 null/None 时覆盖。
    - knowledge_mastery：取 max（只升不降，防 LLM 低估后覆盖）。
    - weak_points：union 去重合并（不减少已知弱点）。
    - completed_at：只允许 false → true 的单向转变。
    - knowledge_level / cognitive_style：由新字段同步写入，保持向后兼容。
    """
    # 1. knowledge_mastery
    new_mastery = update.get("knowledge_mastery")
    if isinstance(new_mastery, (int, float)) and 0.0 <= float(new_mastery) <= 1.0:
        old = profile.knowledge_mastery or 0.0
        profile.knowledge_mastery = round(max(old, float(new_mastery)), 4)
        profile.knowledge_level = _mastery_to_level(profile.knowledge_mastery)

    # 2. learning_preference
    pref = update.get("learning_preference")
    if pref in _VALID_PREFERENCES:
        profile.learning_preference = pref
        profile.cognitive_style = pref  # backward compat

    # 3. learning_goal
    goal = update.get("learning_goal")
    if goal in _VALID_GOALS:
        profile.learning_goal = goal

    # 4. weak_points — union 去重
    new_wp = update.get("weak_points")
    if isinstance(new_wp, list):
        existing = set(profile.weak_points)
        for wp in new_wp:
            if isinstance(wp, str) and wp.strip():
                existing.add(wp.strip())
        profile.weak_points = sorted(existing)

    # 5. programming_experience
    prog = update.get("programming_experience")
    if prog in _VALID_PROG_EXP:
        profile.programming_experience = prog

    # 6. learning_pace
    pace = update.get("learning_pace")
    if pace in _VALID_PACES:
        profile.learning_pace = pace

    # 附加字段
    major = update.get("major")
    if isinstance(major, str) and major.strip():
        profile.major = major.strip()

    avail = update.get("available_time")
    if isinstance(avail, str) and avail.strip():
        profile.available_time = avail.strip()

    # completed：单向 false→true
    if update.get("completed") is True:
        profile.completed_at = True

    return profile


async def _apply_profile_data(
    profile: StudentProfile, update: ProfileUpdate | None
) -> StudentProfile:
    """合并 update 并持久化到 session_store。update 为 None 时直接返回。"""
    if not update:
        return profile
    profile = _merge_profile_update(profile, update)
    await session_store.update_profile(profile)
    return profile


# ── 规则快速推断 ─────────────────────────────────────────────────────────────


def _rule_extract(text: str) -> ProfileUpdate:
    """
    从用户原话做轻量规则提取，用于 infer_and_update_profile 的即时侧栏刷新。
    不依赖 LLM，延迟极低；结果会被 LLM 结果二次覆盖/修正。
    """
    result: ProfileUpdate = {}
    c = text.strip()

    # major
    m = re.search(
        r"(?:我是|本人是|学的是|读的是)?"
        r"([\u4e00-\u9fffA-Za-z0-9·、/]+(?:与[\u4e00-\u9fffA-Za-z0-9·、/]+)*)专业",
        c,
    )
    if m:
        result["major"] = m.group(1).strip()

    # knowledge_mastery（规则近似值）
    if any(k in c for k in ["零基础", "没有基础", "小白", "刚开始学", "刚接触", "完全不懂"]):
        result["knowledge_mastery"] = 0.15
    elif any(k in c for k in ["了解一些", "接触过", "会一点", "基础一般", "基础薄弱"]):
        result["knowledge_mastery"] = 0.35
    elif any(k in c for k in ["比较熟悉", "基础不错", "做过项目", "有经验", "熟悉"]):
        result["knowledge_mastery"] = 0.65
    elif any(k in c for k in ["精通", "很熟练", "深入研究", "多年经验"]):
        result["knowledge_mastery"] = 0.88

    # 学习目标
    if "考研" in c:
        result["learning_goal"] = "考研"
    elif "竞赛" in c:
        result["learning_goal"] = "竞赛"
    elif any(k in c for k in ["就业", "实习", "工作", "面试", "找工作"]):
        result["learning_goal"] = "就业"
    elif any(k in c for k in ["兴趣", "感兴趣", "喜欢", "好玩"]):
        result["learning_goal"] = "兴趣"

    # 编程经验
    if any(k in c for k in ["从没写过", "不会编程", "没有编程", "零编程"]):
        result["programming_experience"] = "无"
    elif any(k in c for k in ["写过脚本", "简单代码", "Python 基础", "入门代码", "会一点代码"]):
        result["programming_experience"] = "初级"
    elif any(k in c for k in ["做过项目", "有项目经验", "开发经验", "实习过"]):
        result["programming_experience"] = "中级"
    elif any(k in c for k in ["熟悉框架", "底层原理", "多年经验", "高级", "研究生", "工作两年"]):
        result["programming_experience"] = "高级"

    # 学习节奏
    if any(k in c for k in ["深入", "深度", "钻研", "细节", "彻底理解", "系统学"]):
        result["learning_pace"] = "深度"
    elif any(k in c for k in ["快速", "快点", "速成", "先过一遍", "大致了解"]):
        result["learning_pace"] = "快速"

    # 学习偏好
    if any(k in c for k in ["看图", "图表", "可视化", "图解", "视觉", "动图"]):
        result["learning_preference"] = "视觉型"
    elif any(k in c for k in ["动手", "实操", "写代码", "代码驱动", "项目驱动", "边写边学"]):
        result["learning_preference"] = "实操型"
    elif any(k in c for k in ["推导", "公式", "定义严谨", "逻辑推理", "数学原理"]):
        result["learning_preference"] = "逻辑型"

    # 每日时间
    mt = re.search(r"(\d+(?:\.\d+)?)\s*(?:个)?小时", c)
    if mt:
        result["available_time"] = f"每天{mt.group(1)}小时"

    # 薄弱知识点（AI 领域常见词）
    _WEAK_POINT_PATTERNS: dict[str, str] = {
        "反向传播": "反向传播",
        "梯度消失": "梯度消失",
        "梯度爆炸": "梯度爆炸",
        "过拟合": "过拟合",
        "正则化": "正则化",
        "注意力机制": "注意力机制",
        "Transformer": "Transformer",
        "位置编码": "位置编码",
        "卷积": "卷积神经网络",
        "激活函数": "激活函数",
        "损失函数": "损失函数",
        "链式法则": "链式法则",
        "矩阵求导": "矩阵求导",
        "指针": "指针",
        "递归": "递归",
        "动态规划": "动态规划",
    }
    found = [label for kw, label in _WEAK_POINT_PATTERNS.items() if kw in c]
    if found:
        result["weak_points"] = found

    return result


# ── 画像上下文注入 ────────────────────────────────────────────────────────────


def _build_profile_context(profile: StudentProfile) -> str:
    """将当前画像格式化为注入 system 消息的上下文字符串。"""
    mastery_str = (
        f"{profile.knowledge_mastery:.2f}"
        if profile.knowledge_mastery is not None
        else "null"
    )
    wp_str = (
        "、".join(profile.weak_points) if profile.weak_points else "null"
    )
    return _PROFILE_CONTEXT_TEMPLATE.format(
        knowledge_mastery=mastery_str,
        learning_preference=profile.learning_preference or "null",
        learning_goal=profile.learning_goal or "null",
        weak_points=wp_str,
        programming_experience=profile.programming_experience or "null",
        learning_pace=profile.learning_pace or "null",
        major=profile.major or "null",
        available_time=profile.available_time or "null",
    )


def _build_messages(
    profile: StudentProfile, history: list[dict], user_message: str
) -> list[dict]:
    """组装发给 LLM 的消息列表：system（含画像快照）+ 历史 + 本轮用户消息。"""
    system_content = SYSTEM_PROMPT + "\n" + _build_profile_context(profile)
    return [
        {"role": "system", "content": system_content},
        *history,
        {"role": "user", "content": user_message},
    ]


# ── 公共接口 ──────────────────────────────────────────────────────────────────


async def infer_and_update_profile(
    session_id: str, user_message: str
) -> StudentProfile:
    """
    规则快速推断（同步，无 LLM 调用），用于流式首帧前即时刷新侧栏。
    LLM 结果会在 chat_stream 结束后对画像做更精准的更新。
    """
    profile = await session_store.get_profile(session_id)
    update = _rule_extract(user_message)
    if not update:
        return profile
    return await _apply_profile_data(profile, update)


async def chat(
    session_id: str, user_message: str
) -> tuple[str, StudentProfile]:
    """
    非流式对话（调试/备用），返回 (展示文本, 最新画像)。
    """
    profile = await infer_and_update_profile(session_id, user_message)
    history = await session_store.get_history(session_id)
    messages = _build_messages(profile, history, user_message)

    clean_reply = ""
    try:
        raw = await llm_service.chat_completion(messages)
        update = _extract_profile_update(raw)
        if update is None:
            logger.warning(
                "[profile_agent] chat: LLM 回复未包含可解析的 profile_update，"
                "使用默认值 session=%s raw_len=%s",
                session_id,
                len(raw),
            )
            update = _DEFAULT_PROFILE_UPDATE
        profile = await _apply_profile_data(profile, update)
        clean_reply = _clean_response(raw) or raw.strip()
    except Exception:
        logger.exception(
            "[profile_agent] chat: LLM 调用失败 session=%s，返回降级回复", session_id
        )
        clean_reply = "抱歉，暂时无法回复，请稍后重试。"

    await session_store.append_history(session_id, "user", user_message)
    await session_store.append_history(session_id, "assistant", clean_reply)
    return clean_reply, profile


async def chat_stream(
    session_id: str, user_message: str
) -> AsyncGenerator[str, None]:
    """
    流式版本。
    - LLM 要求输出完整 JSON，因此先收集全文，解析后再 yield content。
    - 异常时 yield 降级提示并记录日志，不向上抛出。
    """
    profile = await infer_and_update_profile(session_id, user_message)
    history = await session_store.get_history(session_id)
    messages = _build_messages(profile, history, user_message)

    full_response = ""
    try:
        async for chunk in llm_service.chat_stream(messages):
            full_response += chunk
    except Exception:
        logger.exception(
            "[profile_agent] chat_stream: LLM 流式调用失败 session=%s", session_id
        )
        fallback = "抱歉，流式回复出现异常，请稍后重试。"
        await session_store.append_history(session_id, "user", user_message)
        await session_store.append_history(session_id, "assistant", fallback)
        yield fallback
        return

    # 解析画像更新
    try:
        update = _extract_profile_update(full_response)
        if update is None:
            logger.warning(
                "[profile_agent] chat_stream: LLM 回复未包含可解析的 profile_update，"
                "使用默认值 session=%s raw_len=%s",
                session_id,
                len(full_response),
            )
            update = _DEFAULT_PROFILE_UPDATE
        profile = await _apply_profile_data(profile, update)
    except Exception:
        logger.exception(
            "[profile_agent] chat_stream: 画像解析/更新失败 session=%s", session_id
        )

    clean_reply = _clean_response(full_response) or full_response.strip()
    filtered_reply, detected = content_filter.filter_text(clean_reply)
    if detected:
        logger.warning("profile_agent filtered %d sensitive patterns", len(detected))
    await session_store.append_history(session_id, "user", user_message)
    await session_store.append_history(session_id, "assistant", filtered_reply)

    if filtered_reply:
        yield filtered_reply
