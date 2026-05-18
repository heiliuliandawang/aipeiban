const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function createSession(): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/session`, { method: "POST" });
  const data = await res.json();
  return data.session_id;
}

export async function getProfile(sessionId: string) {
  const res = await fetch(`${BASE_URL}/chat/profile/${sessionId}`);
  return res.json();
}

export async function syncSessionState(params: {
  session_id: string;
  profile: object;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const res = await fetch(`${BASE_URL}/chat/session/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function clearChatSession(sessionId: string) {
  const res = await fetch(`${BASE_URL}/chat/session/${sessionId}`, { method: "DELETE" });
  return res.json();
}

/** 流式对话，通过 SSE 逐字返回 */
export function streamChat(
  sessionId: string,
  message: string,
  onDelta: (text: string) => void,
  onProfileUpdate: (profile: object) => void,
  onDone: () => void,
  onError: (message: string) => void
): () => void {
  const url = new URL(`${BASE_URL}/chat/message/stream`);
  url.searchParams.set("session_id", sessionId);
  url.searchParams.set("message", message);

  const es = new EventSource(url.toString());
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    es.close();
    onDone();
  };

  es.addEventListener("delta", (e) => {
    const data = JSON.parse(e.data);
    onDelta(data.text);
  });

  es.addEventListener("profile_update", (e) => {
    onProfileUpdate(JSON.parse(e.data));
  });

  es.addEventListener("done", () => {
    finish();
  });

  es.addEventListener("server_error", (e) => {
    try {
      const data = JSON.parse(e.data);
      onError(data.message || "对话服务暂时不可用，请稍后重试。");
    } catch {
      onError("对话服务暂时不可用，请稍后重试。");
    }
  });

  es.onerror = () => {
    onError("连接中断，请检查后端服务或模型配置。");
    finish();
  };

  return () => finish();
}

/** 流式资源生成；返回的函数为「暂停/取消」：会中断请求并触发 onAbort */
export function streamGenerateResources(
  params: {
    session_id: string;
    topic: string;
    resource_types: string[];
  },
  onProgress: (type: string, label: string, status: string) => void,
  onResource: (type: string, label: string, content: string) => void,
  onDone: () => void,
  onAbort?: () => void
): () => void {
  const ctrl = new AbortController();
  let settled = false;
  const settle = (mode: "done" | "abort") => {
    if (settled) return;
    settled = true;
    if (mode === "abort") onAbort?.();
    else onDone();
  };

  (async () => {
    try {
      const res = await fetch(`${BASE_URL}/resources/generate/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        console.error("[streamGenerateResources] HTTP", res.status, await res.text().catch(() => ""));
        settle("done");
        return;
      }
      if (!res.body) {
        settle("done");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const raw = line.slice(6).trim();
            if (!raw || raw === "") continue;
            try {
              const data = JSON.parse(raw);
              if (currentEvent === "progress") {
                onProgress(data.type, data.label, data.status);
              } else if (currentEvent === "resource") {
                onResource(data.type, data.label, data.content);
              } else if (currentEvent === "server_error") {
                console.error("[streamGenerateResources] server_error", data.message);
              } else if (currentEvent === "done") {
                settle("done");
                break outer;
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }
      settle("done");
    } catch (e) {
      if (ctrl.signal.aborted) settle("abort");
      else {
        console.error("[streamGenerateResources]", e);
        settle("done");
      }
    }
  })();

  return () => ctrl.abort();
}

export async function getLearningPath(sessionId: string, profile: object) {
  const res = await fetch(`${BASE_URL}/resources/learning-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, course: "人工智能导论", profile }),
  });
  return res.json();
}

/** 流式辅导问答，SSE 推送逐字回复 */
export function streamTutorAsk(
  params: { session_id: string; question: string; current_topic: string },
  onDelta: (text: string) => void,
  onDone: () => void
): () => void {
  const ctrl = new AbortController();

  (async () => {
    const res = await fetch(`${BASE_URL}/tutor/ask/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: ctrl.signal,
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let currentEvent = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            if (currentEvent === "delta") {
              const data = JSON.parse(raw);
              onDelta(data.text);
            } else if (currentEvent === "done") {
              onDone();
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }
    onDone();
  })().catch(() => onDone());

  return () => ctrl.abort();
}

/** 获取推荐问题列表 */
export async function getSuggestedQuestions(topic: string): Promise<string[]> {
  const res = await fetch(
    `${BASE_URL}/tutor/suggested-questions?topic=${encodeURIComponent(topic)}`
  );
  const data = await res.json();
  return data.questions || [];
}

// ── 知识库 API ──────────────────────────────────────────

/** 触发知识库向量化初始化 */
export async function initKnowledge() {
  const res = await fetch(`${BASE_URL}/knowledge/init`);
  return res.json();
}

/** 列出所有课程 */
export async function listCourses() {
  const res = await fetch(`${BASE_URL}/knowledge/courses`);
  return res.json();
}

/** 列出某课程的所有章节 */
export async function listChapters(courseName: string) {
  const res = await fetch(
    `${BASE_URL}/knowledge/courses/${encodeURIComponent(courseName)}/chapters`
  );
  return res.json();
}

/** 获取章节完整内容 */
export async function getChapter(courseName: string, chapterId: string) {
  const res = await fetch(
    `${BASE_URL}/knowledge/courses/${encodeURIComponent(courseName)}/chapters/${chapterId}`
  );
  return res.json();
}

/** 语义搜索知识库（仅本地 backend/knowledge_base 下的章节） */
export async function searchKnowledge(query: string, course?: string, topK = 3) {
  const params = new URLSearchParams({ q: query, top_k: String(topK) });
  if (course) params.set("course", course);
  const res = await fetch(`${BASE_URL}/knowledge/search?${params}`);
  return res.json();
}

/** 联网检索学习资料（DuckDuckGo） */
export async function searchKnowledgeWeb(query: string, topK = 8) {
  const params = new URLSearchParams({ q: query, top_k: String(topK) });
  const res = await fetch(`${BASE_URL}/knowledge/web-search?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "联网检索失败");
  }
  return res.json() as Promise<{
    query: string;
    results: Array<{ title: string; url: string; snippet: string }>;
    count: number;
  }>;
}
