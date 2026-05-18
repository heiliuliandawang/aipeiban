"""
知识库服务
支持两种检索模式（自动选择）：
  1. 语义检索：ChromaDB + sentence-transformers（需要下载模型，设置 HF_MIRROR 加速）
  2. 关键词检索：纯 Python TF-IDF（无需任何网络，自动回退）
"""
import json
import math
import re
import logging
import os
from pathlib import Path
from collections import Counter
from typing import Optional

logger = logging.getLogger(__name__)

# 知识库根目录
_KB_ROOT = Path(__file__).parent.parent.parent / "knowledge_base"
# ChromaDB 持久化路径
_CHROMA_PATH = Path(__file__).parent.parent.parent / ".chroma_db"

# 可选：配置 HuggingFace 国内镜像（在 .env 中设置 HF_ENDPOINT=https://hf-mirror.com）
_HF_MIRROR = os.getenv("HF_ENDPOINT", "")
if _HF_MIRROR:
    os.environ["HF_ENDPOINT"] = _HF_MIRROR


# ─────────────────────────────────────────────
# 回退方案：纯 Python TF-IDF 关键词检索
# ─────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    """中英文分词：英文按词，中文按单字 + bigram，提升短语匹配效果"""
    text = text.lower()
    en_words = re.findall(r'[a-z0-9]+', text)
    zh_chars = re.findall(r'[\u4e00-\u9fff]', text)
    # bigram：两个相邻汉字组合，提升"神经网络"等词组的匹配精度
    zh_bigrams = [zh_chars[i] + zh_chars[i+1] for i in range(len(zh_chars) - 1)]
    return en_words + zh_chars + zh_bigrams


def _tfidf_score(query_tokens: list[str], doc_tokens: list[str], idf: dict[str, float]) -> float:
    """计算 query 与 doc 之间的 TF-IDF 余弦相似度"""
    doc_tf = Counter(doc_tokens)
    doc_len = max(len(doc_tokens), 1)

    score = 0.0
    for tok in set(query_tokens):
        tf = doc_tf.get(tok, 0) / doc_len
        idf_val = idf.get(tok, 0.0)
        score += tf * idf_val
    return score


class KeywordIndex:
    """内存 TF-IDF 索引，不依赖任何外部库"""

    def __init__(self):
        self._docs: list[dict] = []  # {id, tokens, metadata, text}
        self._idf: dict[str, float] = {}

    def add_documents(self, documents: list[str], metadatas: list[dict], ids: list[str]):
        tokenized = [_tokenize(doc) for doc in documents]

        # 计算 IDF
        df: Counter = Counter()
        for toks in tokenized:
            df.update(set(toks))
        n = len(tokenized)
        self._idf = {tok: math.log((n + 1) / (cnt + 1)) + 1 for tok, cnt in df.items()}

        self._docs = [
            {"id": ids[i], "tokens": tokenized[i], "metadata": metadatas[i], "text": documents[i]}
            for i in range(len(documents))
        ]

    def search(self, query: str, n_results: int = 3) -> list[dict]:
        q_tokens = _tokenize(query)
        scored = []
        for doc in self._docs:
            score = _tfidf_score(q_tokens, doc["tokens"], self._idf)
            if score > 0:
                scored.append((score, doc))

        scored.sort(key=lambda x: x[0], reverse=True)
        results = []
        for score, doc in scored[:n_results]:
            results.append({
                "document": doc["text"],
                "metadata": doc["metadata"],
                "distance": max(0.0, 1 - score),
            })
        return results


# ─────────────────────────────────────────────
# 主知识库服务
# ─────────────────────────────────────────────

class KnowledgeService:
    def __init__(self):
        self._chroma_client = None
        self._embed_fn = None
        self._use_vector: bool = False   # 是否成功启用向量检索
        self._kw_indexes: dict[str, KeywordIndex] = {}   # 关键词索引（每课程一个）
        self._courses: dict[str, dict] = {}
        self._initialized = False

    # ── ChromaDB 初始化（可选）──────────────────

    def _try_init_vector(self) -> bool:
        """尝试初始化向量检索，失败则返回 False"""
        try:
            import chromadb
            from chromadb.utils import embedding_functions

            _CHROMA_PATH.mkdir(exist_ok=True)
            self._chroma_client = chromadb.PersistentClient(path=str(_CHROMA_PATH))

            # 尝试加载 sentence-transformers（带超时保护）
            import signal

            def _timeout_handler(signum, frame):
                raise TimeoutError("模型加载超时")

            # Windows 不支持 signal.alarm，用 threading 超时
            import threading
            result = [None]
            error = [None]

            def _load_model():
                try:
                    result[0] = embedding_functions.SentenceTransformerEmbeddingFunction(
                        model_name="paraphrase-multilingual-MiniLM-L12-v2"
                    )
                except Exception as e:
                    error[0] = e

            t = threading.Thread(target=_load_model, daemon=True)
            t.start()
            t.join(timeout=15)  # 最多等 15 秒

            if result[0] is not None:
                self._embed_fn = result[0]
                logger.info("语义嵌入模型加载成功，使用向量检索")
                return True
            else:
                logger.warning(f"模型加载失败或超时（{error[0]}），回退到关键词检索")
                return False

        except Exception as e:
            logger.warning(f"向量检索初始化失败: {e}，回退到关键词检索")
            return False

    # ── Markdown 解析 ───────────────────────────

    def _parse_markdown(self, file_path: Path) -> dict:
        text = file_path.read_text(encoding="utf-8")
        title_match = re.search(r"^# (.+)$", text, re.MULTILINE)
        title = title_match.group(1).strip() if title_match else file_path.stem
        lines = [l for l in text.split("\n") if l.strip() and not l.startswith("#")]
        summary = " ".join(lines[:3])[:300]
        sections = re.split(r"^## ", text, flags=re.MULTILINE)
        chunks = [s.strip()[:800] for s in sections if s.strip()]
        return {"title": title, "summary": summary, "content": text, "chunks": chunks}

    def _load_course_meta(self, course_dir: Path) -> dict:
        meta_file = course_dir / "meta.json"
        if meta_file.exists():
            return json.loads(meta_file.read_text(encoding="utf-8"))
        return {"title": course_dir.name, "chapters": []}

    # ── 核心初始化 ──────────────────────────────

    def initialize(self):
        if self._initialized:
            return

        if not _KB_ROOT.exists():
            logger.warning(f"知识库目录不存在: {_KB_ROOT}")
            self._initialized = True
            return

        # 尝试启用向量检索
        self._use_vector = self._try_init_vector()
        mode_label = "向量语义检索" if self._use_vector else "关键词TF-IDF检索"
        logger.info(f"知识库检索模式: {mode_label}")

        for course_dir in _KB_ROOT.iterdir():
            if not course_dir.is_dir():
                continue

            course_name = course_dir.name
            meta = self._load_course_meta(course_dir)
            self._courses[course_name] = meta

            md_files = sorted(course_dir.glob("ch*.md"))
            all_docs, all_metas, all_ids = [], [], []

            for md_file in md_files:
                doc = self._parse_markdown(md_file)
                for ci, chunk in enumerate(doc["chunks"]):
                    all_ids.append(f"{md_file.stem}_chunk{ci}")
                    all_docs.append(chunk)
                    all_metas.append({
                        "course": course_name,
                        "file": md_file.name,
                        "chapter_id": md_file.stem,
                        "title": doc["title"],
                        "chunk_idx": ci,
                    })

            if not all_ids:
                continue

            if self._use_vector:
                self._build_vector_index(course_name, all_ids, all_docs, all_metas)
            else:
                idx = KeywordIndex()
                idx.add_documents(all_docs, all_metas, all_ids)
                self._kw_indexes[course_name] = idx

            logger.info(f"课程 '{course_name}' 索引完成，{len(all_ids)} 个块")

        self._initialized = True
        logger.info("知识库初始化完成")

    def _build_vector_index(self, course_name: str, ids, docs, metas):
        """向量模式下构建 ChromaDB 集合"""
        try:
            import chromadb
            cname = f"course_{re.sub(r'[^a-zA-Z0-9_]', '_', course_name)}"
            try:
                existing = self._chroma_client.get_collection(
                    name=cname, embedding_function=self._embed_fn
                )
                if existing.count() >= len(ids):
                    logger.info(f"'{course_name}' 向量集合已存在，跳过重建")
                    return
                self._chroma_client.delete_collection(cname)
            except Exception:
                pass

            col = self._chroma_client.create_collection(
                name=cname, embedding_function=self._embed_fn,
                metadata={"course": course_name}
            )
            for i in range(0, len(ids), 100):
                col.add(ids=ids[i:i+100], documents=docs[i:i+100], metadatas=metas[i:i+100])
        except Exception as e:
            logger.error(f"向量索引构建失败: {e}，降级为关键词检索")
            self._use_vector = False
            idx = KeywordIndex()
            idx.add_documents(docs, metas, ids)
            self._kw_indexes[course_name] = idx

    # ── 公开 API ────────────────────────────────

    def list_courses(self) -> list[dict]:
        self.initialize()
        return [
            {
                "name": name,
                "title": meta.get("title", name),
                "description": meta.get("description", ""),
                "chapter_count": len(meta.get("chapters", [])),
                "search_mode": "向量语义" if self._use_vector else "关键词",
            }
            for name, meta in self._courses.items()
        ]

    def list_chapters(self, course_name: str) -> list[dict]:
        self.initialize()
        meta = self._courses.get(course_name, {})
        return [
            {
                "id": ch["id"],
                "title": ch["title"],
                "keywords": ch.get("keywords", []),
                "file": ch["file"],
                "exists": (_KB_ROOT / course_name / ch["file"]).exists(),
            }
            for ch in meta.get("chapters", [])
        ]

    def get_chapter(self, course_name: str, chapter_id: str) -> dict | None:
        self.initialize()
        meta = self._courses.get(course_name, {})
        chapter_meta = next((c for c in meta.get("chapters", []) if c["id"] == chapter_id), None)
        if not chapter_meta:
            return None
        md_path = _KB_ROOT / course_name / chapter_meta["file"]
        if not md_path.exists():
            return None
        doc = self._parse_markdown(md_path)
        return {
            "id": chapter_id,
            "title": doc["title"],
            "content": doc["content"],
            "summary": doc["summary"],
            "keywords": chapter_meta.get("keywords", []),
        }

    def search(self, query: str, course_name: str | None = None, top_k: int = 3) -> list[dict]:
        """统一搜索入口，自动选择向量或关键词检索"""
        self.initialize()
        results = []
        search_courses = [course_name] if course_name else list(self._courses.keys())

        for cname in search_courses:
            if self._use_vector:
                results.extend(self._vector_search(query, cname, top_k))
            else:
                results.extend(self._keyword_search(query, cname, top_k))

        results.sort(key=lambda x: x["relevance_score"], reverse=True)
        return results[:top_k]

    def _vector_search(self, query: str, course_name: str, top_k: int) -> list[dict]:
        try:
            cname = f"course_{re.sub(r'[^a-zA-Z0-9_]', '_', course_name)}"
            col = self._chroma_client.get_collection(
                name=cname, embedding_function=self._embed_fn
            )
            qr = col.query(query_texts=[query], n_results=min(top_k, col.count()))
            results = []
            for i, doc in enumerate(qr["documents"][0]):
                meta = qr["metadatas"][0][i]
                dist = qr["distances"][0][i] if "distances" in qr else 0.5
                results.append({
                    "title": meta.get("title", ""),
                    "content_preview": doc[:400],
                    "course": course_name,
                    "chapter_id": meta.get("chapter_id", ""),
                    "relevance_score": round(max(0.0, 1 - dist / 2), 3),
                })
            return results
        except Exception as e:
            logger.warning(f"向量搜索失败: {e}，回退关键词")
            return self._keyword_search(query, course_name, top_k)

    def _keyword_search(self, query: str, course_name: str, top_k: int) -> list[dict]:
        idx = self._kw_indexes.get(course_name)
        if not idx:
            return []
        hits = idx.search(query, n_results=top_k)
        return [
            {
                "title": h["metadata"].get("title", ""),
                "content_preview": h["document"][:400],
                "course": course_name,
                "chapter_id": h["metadata"].get("chapter_id", ""),
                "relevance_score": round(max(0.0, 1 - h["distance"]), 3),
            }
            for h in hits
        ]

    def get_context_for_topic(self, topic: str, course_name: str | None = None) -> str:
        """为 Agent 提供 RAG 上下文片段"""
        results = self.search(topic, course_name, top_k=2)
        if not results:
            return ""
        return "\n\n".join(
            f"【知识库：{r['title']}】\n{r['content_preview']}" for r in results
        )


knowledge_service = KnowledgeService()
