"""
知识库接口
提供课程文档浏览、章节查看、语义搜索功能
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks
from app.services.knowledge_service import knowledge_service
from app.services import web_search_service

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.get("/init")
async def init_knowledge_base(background_tasks: BackgroundTasks):
    """触发知识库初始化（向量化入库），后台执行"""
    background_tasks.add_task(knowledge_service.initialize)
    return {"message": "知识库初始化已启动，首次运行需要下载嵌入模型（约300MB），请稍候"}


@router.get("/courses")
async def list_courses():
    """列出所有可用课程"""
    courses = knowledge_service.list_courses()
    return {"courses": courses}


@router.get("/courses/{course_name}/chapters")
async def list_chapters(course_name: str):
    """列出某课程的所有章节"""
    chapters = knowledge_service.list_chapters(course_name)
    if not chapters:
        raise HTTPException(status_code=404, detail=f"课程 '{course_name}' 不存在或暂无章节")
    return {"course": course_name, "chapters": chapters}


@router.get("/courses/{course_name}/chapters/{chapter_id}")
async def get_chapter(course_name: str, chapter_id: str):
    """获取某章节的完整内容"""
    chapter = knowledge_service.get_chapter(course_name, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail=f"章节 '{chapter_id}' 不存在")
    return chapter


@router.get("/web-search")
async def search_web(q: str, top_k: int = 8):
    """联网检索学习资料（DuckDuckGo），不依赖本地 knowledge_base 目录。"""
    if not q.strip():
        raise HTTPException(status_code=400, detail="搜索词不能为空")
    top_k = min(max(top_k, 1), 12)
    try:
        results = await web_search_service.search_web_async(q, top_k)
    except ImportError as e:
        raise HTTPException(
            status_code=503,
            detail="未安装 ddgs，请在 backend 目录执行: pip install ddgs",
        ) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"联网检索失败: {e}") from e
    source = "web" if results and results[0].get("url") else "llm_fallback"
    return {
        "query": q,
        "results": results,
        "count": len(results),
        "source": source,
    }


@router.get("/search")
async def search_knowledge(q: str, course: str | None = None, top_k: int = 3):
    """
    语义搜索知识库
    - q: 搜索关键词或问题
    - course: 限定搜索的课程名（可选）
    - top_k: 返回结果数量（最多5）
    """
    if not q.strip():
        raise HTTPException(status_code=400, detail="搜索词不能为空")
    top_k = min(max(top_k, 1), 5)
    results = knowledge_service.search(q, course, top_k)
    return {"query": q, "results": results, "count": len(results)}


@router.get("/context")
async def get_rag_context(topic: str, course: str | None = None):
    """
    为 Agent 提供 RAG 上下文（供内部调用）
    返回与主题最相关的知识库片段
    """
    context = knowledge_service.get_context_for_topic(topic, course)
    return {"topic": topic, "context": context}
