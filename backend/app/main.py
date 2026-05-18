from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv(override=True)

from app.api import chat, resources, tutor, knowledge
from app.services import session_store

app = FastAPI(
    title="智学引擎 EduMind API",
    description="高等教育个性化学习资源智能体系统",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(resources.router)
app.include_router(tutor.router)
app.include_router(knowledge.router)


@app.on_event("startup")
async def startup():
    await session_store.init_db()


@app.get("/")
async def root():
    return {"message": "智学引擎 EduMind API 运行中", "docs": "/docs"}


@app.get("/health")
async def health():
    return {"status": "ok"}
