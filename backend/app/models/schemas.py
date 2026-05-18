from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from enum import Enum


class MessageRole(str, Enum):
    user = "user"
    assistant = "assistant"
    system = "system"


class ChatMessage(BaseModel):
    role: MessageRole
    content: str


class ChatRequest(BaseModel):
    session_id: str
    message: str
    history: List[ChatMessage] = []


class StudentProfile(BaseModel):
    """六维学生画像"""
    session_id: str
    name: Optional[str] = None
    major: Optional[str] = None                    # 专业
    knowledge_level: Optional[str] = None          # 知识基础：入门/初级/中级/高级
    cognitive_style: Optional[str] = None          # 认知风格：视觉型/逻辑型/实操型
    learning_goal: Optional[str] = None            # 学习目标：考研/竞赛/就业/兴趣
    weak_points: List[str] = []                    # 易错点/薄弱知识点
    learning_pace: Optional[str] = None            # 学习节奏：快速/深度
    available_time: Optional[str] = None           # 每日可用时间
    completed_at: bool = False                     # 画像是否构建完整


class SessionSyncRequest(BaseModel):
    session_id: str
    profile: StudentProfile
    history: List[ChatMessage] = []


class ResourceType(str, Enum):
    document = "document"       # 课程讲解文档
    quiz = "quiz"               # 练习题库
    mindmap = "mindmap"         # 思维导图
    code_example = "code_example"  # 代码实操案例
    reading = "reading"         # 拓展阅读


class GenerateResourceRequest(BaseModel):
    session_id: str
    topic: str                          # 要生成的知识点/主题
    resource_types: List[ResourceType]  # 需要哪些类型的资源
    profile: Optional[StudentProfile] = None


class LearningPathRequest(BaseModel):
    session_id: str
    course: str = "人工智能导论"
    profile: StudentProfile


class AgentResponse(BaseModel):
    agent_name: str
    content: str
    metadata: Dict[str, Any] = {}
