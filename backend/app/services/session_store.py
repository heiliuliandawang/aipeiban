"""
内存级 Session 存储（生产环境替换为 Redis）
存储学生画像、对话历史、辅导历史
"""
from typing import Dict
from app.models.schemas import StudentProfile, ChatMessage

_profiles: Dict[str, StudentProfile] = {}
_histories: Dict[str, list[dict]] = {}
_tutor_histories: Dict[str, list[dict]] = {}


def get_profile(session_id: str) -> StudentProfile:
    if session_id not in _profiles:
        _profiles[session_id] = StudentProfile(session_id=session_id)
    return _profiles[session_id]


def update_profile(profile: StudentProfile) -> None:
    _profiles[profile.session_id] = profile


def get_history(session_id: str) -> list[dict]:
    return _histories.get(session_id, [])


def append_history(session_id: str, role: str, content: str) -> None:
    if session_id not in _histories:
        _histories[session_id] = []
    _histories[session_id].append({"role": role, "content": content})
    # 最多保留最近 20 条，防止 token 超长
    if len(_histories[session_id]) > 20:
        _histories[session_id] = _histories[session_id][-20:]


def set_history(session_id: str, history: list[dict]) -> None:
    """直接覆盖学习对话历史，常用于前端恢复已保存会话。"""
    _histories[session_id] = history[-20:]


def get_tutor_history(session_id: str) -> list[dict]:
    """获取智能辅导对话历史"""
    return _tutor_histories.get(session_id, [])


def append_tutor_history(session_id: str, role: str, content: str) -> None:
    """追加智能辅导对话历史，最多保留最近 20 条"""
    if session_id not in _tutor_histories:
        _tutor_histories[session_id] = []
    _tutor_histories[session_id].append({"role": role, "content": content})
    if len(_tutor_histories[session_id]) > 20:
        _tutor_histories[session_id] = _tutor_histories[session_id][-20:]


def clear_tutor_history(session_id: str) -> None:
    """清除辅导历史"""
    _tutor_histories.pop(session_id, None)


def clear_session(session_id: str) -> None:
    _profiles.pop(session_id, None)
    _histories.pop(session_id, None)
    _tutor_histories.pop(session_id, None)
