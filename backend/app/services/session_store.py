"""
SQLite 持久化 Session 存储。

数据表：
- sessions: session_id, user_id, created_at, last_access
- profiles: session_id, profile_json
- messages: session_id, role, content, timestamp
- resources: session_id, resource_type, content_json, created_at
"""
import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite

from app.models.schemas import StudentProfile

_DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "sessions.db"
_DB_PATH = Path(os.getenv("SESSION_DB_PATH", str(_DEFAULT_DB_PATH)))
_DEFAULT_USER_ID = "demo_user"
_init_lock = asyncio.Lock()
_initialized = False

MAIN_CHAT_ROLES = ("user", "assistant")
TUTOR_ROLE_PREFIX = "tutor:"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _profile_json(profile: StudentProfile) -> str:
    return json.dumps(profile.model_dump(), ensure_ascii=False)


async def init_db() -> None:
    """初始化 SQLite 数据库和索引。"""
    global _initialized
    if _initialized:
        return

    async with _init_lock:
        if _initialized:
            return

        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(_DB_PATH) as db:
            await db.execute("PRAGMA foreign_keys = ON")
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_access TEXT NOT NULL
                )
                """
            )
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS profiles (
                    session_id TEXT PRIMARY KEY,
                    profile_json TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
                )
                """
            )
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
                )
                """
            )
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS resources (
                    session_id TEXT NOT NULL,
                    resource_type TEXT NOT NULL,
                    content_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
                )
                """
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_messages_session_time ON messages(session_id, timestamp)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_resources_session_time ON resources(session_id, created_at)"
            )
            await db.commit()

        _initialized = True


async def _connect() -> aiosqlite.Connection:
    await init_db()
    db = await aiosqlite.connect(_DB_PATH)
    await db.execute("PRAGMA foreign_keys = ON")
    return db


@asynccontextmanager
async def _db():
    db = await _connect()
    try:
        yield db
    finally:
        await db.close()


async def create_session(session_id: str, user_id: str = _DEFAULT_USER_ID) -> None:
    """创建会话；如果已存在则只刷新 last_access。"""
    now = _now_iso()
    async with _db() as db:
        await db.execute(
            """
            INSERT INTO sessions(session_id, user_id, created_at, last_access)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET last_access = excluded.last_access
            """,
            (session_id, user_id, now, now),
        )
        await db.execute(
            """
            INSERT OR IGNORE INTO profiles(session_id, profile_json)
            VALUES (?, ?)
            """,
            (session_id, _profile_json(StudentProfile(session_id=session_id))),
        )
        await db.commit()


async def touch_session(session_id: str) -> None:
    await create_session(session_id)


async def list_sessions(user_id: str = _DEFAULT_USER_ID) -> list[dict[str, Any]]:
    """列出模拟用户的历史会话，供前端侧边栏恢复使用。"""
    async with _db() as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall(
            """
            SELECT s.session_id, s.user_id, s.created_at, s.last_access, p.profile_json
            FROM sessions s
            LEFT JOIN profiles p ON p.session_id = s.session_id
            WHERE s.user_id = ?
            ORDER BY s.last_access DESC
            """,
            (user_id,),
        )

    sessions: list[dict[str, Any]] = []
    for row in rows:
        profile_json = row["profile_json"]
        profile = json.loads(profile_json) if profile_json else StudentProfile(session_id=row["session_id"]).model_dump()
        sessions.append(
            {
                "session_id": row["session_id"],
                "user_id": row["user_id"],
                "created_at": row["created_at"],
                "last_access": row["last_access"],
                "profile": profile,
            }
        )
    return sessions


async def get_profile(session_id: str) -> StudentProfile:
    await touch_session(session_id)
    async with _db() as db:
        cursor = await db.execute(
            "SELECT profile_json FROM profiles WHERE session_id = ?",
            (session_id,),
        )
        row = await cursor.fetchone()

    if row and row[0]:
        try:
            data = json.loads(row[0])
            return StudentProfile.model_validate({**data, "session_id": session_id})
        except (json.JSONDecodeError, TypeError, ValueError):
            pass

    profile = StudentProfile(session_id=session_id)
    await update_profile(profile)
    return profile


async def update_profile(profile: StudentProfile) -> None:
    await touch_session(profile.session_id)
    async with _db() as db:
        await db.execute(
            """
            INSERT INTO profiles(session_id, profile_json)
            VALUES (?, ?)
            ON CONFLICT(session_id) DO UPDATE SET profile_json = excluded.profile_json
            """,
            (profile.session_id, _profile_json(profile)),
        )
        await db.commit()


async def get_history(session_id: str, limit: int = 20) -> list[dict[str, str]]:
    await touch_session(session_id)
    placeholders = ",".join("?" for _ in MAIN_CHAT_ROLES)
    async with _db() as db:
        rows = await db.execute_fetchall(
            f"""
            SELECT role, content
            FROM messages
            WHERE session_id = ? AND role IN ({placeholders})
            ORDER BY timestamp DESC, rowid DESC
            LIMIT ?
            """,
            (session_id, *MAIN_CHAT_ROLES, limit),
        )

    return [
        {"role": role, "content": content}
        for role, content in reversed(rows)
    ]


async def get_messages(session_id: str, limit: int = 100) -> list[dict[str, str]]:
    """读取主学习对话消息，包含 timestamp，供前端恢复会话。"""
    await touch_session(session_id)
    placeholders = ",".join("?" for _ in MAIN_CHAT_ROLES)
    async with _db() as db:
        rows = await db.execute_fetchall(
            f"""
            SELECT role, content, timestamp
            FROM messages
            WHERE session_id = ? AND role IN ({placeholders})
            ORDER BY timestamp DESC, rowid DESC
            LIMIT ?
            """,
            (session_id, *MAIN_CHAT_ROLES, limit),
        )

    return [
        {"role": role, "content": content, "timestamp": timestamp}
        for role, content, timestamp in reversed(rows)
    ]


async def append_history(session_id: str, role: str, content: str) -> None:
    await touch_session(session_id)
    async with _db() as db:
        await db.execute(
            """
            INSERT INTO messages(session_id, role, content, timestamp)
            VALUES (?, ?, ?, ?)
            """,
            (session_id, role, content, _now_iso()),
        )
        await db.commit()


async def set_history(session_id: str, history: list[dict[str, str]]) -> None:
    """直接覆盖学习对话历史，常用于前端恢复已保存会话。"""
    await touch_session(session_id)
    async with _db() as db:
        await db.execute(
            "DELETE FROM messages WHERE session_id = ? AND role IN ('user', 'assistant')",
            (session_id,),
        )
        for msg in history[-20:]:
            role = msg.get("role")
            content = msg.get("content")
            if role not in MAIN_CHAT_ROLES or not content:
                continue
            await db.execute(
                """
                INSERT INTO messages(session_id, role, content, timestamp)
                VALUES (?, ?, ?, ?)
                """,
                (session_id, role, content, _now_iso()),
            )
        await db.commit()


async def get_tutor_history(session_id: str, limit: int = 20) -> list[dict[str, str]]:
    await touch_session(session_id)
    async with _db() as db:
        rows = await db.execute_fetchall(
            """
            SELECT role, content
            FROM messages
            WHERE session_id = ? AND role IN ('tutor:user', 'tutor:assistant')
            ORDER BY timestamp DESC, rowid DESC
            LIMIT ?
            """,
            (session_id, limit),
        )

    return [
        {"role": role.removeprefix(TUTOR_ROLE_PREFIX), "content": content}
        for role, content in reversed(rows)
    ]


async def append_tutor_history(session_id: str, role: str, content: str) -> None:
    await append_history(session_id, f"{TUTOR_ROLE_PREFIX}{role}", content)


async def clear_tutor_history(session_id: str) -> None:
    await touch_session(session_id)
    async with _db() as db:
        await db.execute(
            "DELETE FROM messages WHERE session_id = ? AND role IN ('tutor:user', 'tutor:assistant')",
            (session_id,),
        )
        await db.commit()


async def save_resource(session_id: str, resource_type: str, content: str) -> None:
    await touch_session(session_id)
    content_json = json.dumps({"content": content}, ensure_ascii=False)
    async with _db() as db:
        await db.execute(
            """
            INSERT INTO resources(session_id, resource_type, content_json, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (session_id, resource_type, content_json, _now_iso()),
        )
        await db.commit()


async def list_resources(session_id: str) -> list[dict[str, Any]]:
    await touch_session(session_id)
    async with _db() as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall(
            """
            SELECT resource_type, content_json, created_at
            FROM resources
            WHERE session_id = ?
            ORDER BY created_at DESC, rowid DESC
            """,
            (session_id,),
        )

    resources: list[dict[str, Any]] = []
    for row in rows:
        try:
            content = json.loads(row["content_json"])
        except json.JSONDecodeError:
            content = {"content": row["content_json"]}
        resources.append(
            {
                "resource_type": row["resource_type"],
                "content": content,
                "created_at": row["created_at"],
            }
        )
    return resources


async def clear_session(session_id: str) -> None:
    async with _db() as db:
        await db.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        await db.commit()
