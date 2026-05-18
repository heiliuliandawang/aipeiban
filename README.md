# 智学引擎 EduMind

> 高等教育个性化学习资源智能体系统 · 软件杯参赛作品

## 系统架构

```
EduMind
├── frontend/          # Next.js 前端
│   ├── app/           # 页面（App Router）
│   ├── components/    # UI 组件
│   │   ├── ChatPanel.tsx       # 对话面板（画像构建）
│   │   ├── ProfileSidebar.tsx  # 六维学生画像展示
│   │   └── ResourcePanel.tsx   # 多智能体资源生成
│   └── lib/api.ts     # 后端 API 调用封装
│
└── backend/           # FastAPI 后端
    └── app/
        ├── agents/
        │   ├── profile_agent.py   # 学生画像构建 Agent
        │   ├── resource_agent.py  # 资源生成协调 Agent（5个子Agent）
        │   └── path_agent.py      # 学习路径规划 Agent
        ├── api/
        │   ├── chat.py            # 对话 SSE 接口
        │   └── resources.py       # 资源生成 SSE 接口
        ├── models/schemas.py      # 数据模型
        └── services/
            ├── llm_service.py     # 讯飞星火 LLM 封装
            └── session_store.py   # 会话状态管理
```

## 多智能体架构

| Agent | 职责 |
|-------|------|
| 画像构建 Agent | 对话式收集学生信息，构建六维画像 |
| 文档生成 Agent | 生成个性化课程讲解文档 |
| 题库生成 Agent | 生成针对薄弱点的练习题 |
| 思维导图 Agent | 生成知识结构大纲 |
| 代码案例 Agent | 生成可运行代码实操案例 |
| 拓展阅读 Agent | 推荐匹配学习目标的资料 |
| 路径规划 Agent | 生成个性化学习路径 |

## 快速启动

### 1. 后端

```bash
cd backend
py -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
# 编辑 .env，填入讯飞星火 API Key
uvicorn app.main:app --reload --port 8000
```

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:3000

## 技术栈

- **前端**：Next.js 14 + TypeScript + Tailwind CSS
- **后端**：Python FastAPI + 流式 SSE
- **大模型**：科大讯飞星火（OpenAI 兼容接口）
- **多智能体**：自定义 Agent 协调框架

## 开源说明

- Next.js：MIT License
- FastAPI：MIT License
- 科大讯飞星火大模型：依据讯飞开放平台服务协议使用
