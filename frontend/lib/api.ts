import type {
  ChatDeltaEvent,
  ChatServerErrorEvent,
  ClearSessionResponse,
  CoursesListResponse,
  ChaptersListResponse,
  CreateSessionResponse,
  InitKnowledgeResponse,
  KnowledgeChapterDetail,
  KnowledgeSearchResponse,
  ListSessionsResponse,
  SessionSyncRequest,
  SessionStateResponse,
  SessionSyncResponse,
  StreamCancelFn,
  StudentProfile,
  SuggestedQuestionsResponse,
  TutorAskRequest,
  TutorDeltaEvent,
  WebSearchResponse,
} from "@/types";
import type {
  GenerateResourcesRequest,
  LearningPathRequest,
  LearningPathResponse,
  ResourceContentEvent,
  ResourceProgressEvent,
  ResourceServerErrorEvent,
  ResourceStreamEventName,
  ResourceType,
} from "@/types/resource";
import { parseSseJson } from "@/types/chat";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function parseJsonResponse<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

export async function createSession(): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/session`, { method: "POST" });
  const data = await parseJsonResponse<CreateSessionResponse>(res);
  return data.session_id;
}

export async function listSessions(): Promise<ListSessionsResponse> {
  const res = await fetch(`${BASE_URL}/chat/sessions`);
  return parseJsonResponse<ListSessionsResponse>(res);
}

export async function getSessionState(
  sessionId: string
): Promise<SessionStateResponse> {
  const res = await fetch(`${BASE_URL}/chat/session/${sessionId}`);
  return parseJsonResponse<SessionStateResponse>(res);
}

export async function getProfile(sessionId: string): Promise<StudentProfile> {
  const res = await fetch(`${BASE_URL}/chat/profile/${sessionId}`);
  return parseJsonResponse<StudentProfile>(res);
}

export async function syncSessionState(
  params: SessionSyncRequest
): Promise<SessionSyncResponse> {
  const res = await fetch(`${BASE_URL}/chat/session/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJsonResponse<SessionSyncResponse>(res);
}

export async function clearChatSession(
  sessionId: string
): Promise<ClearSessionResponse> {
  const res = await fetch(`${BASE_URL}/chat/session/${sessionId}`, {
    method: "DELETE",
  });
  return parseJsonResponse<ClearSessionResponse>(res);
}

/** 流式对话，通过 EventSource SSE 逐字返回 */
export function streamChat(
  sessionId: string,
  message: string,
  onDelta: (text: string) => void,
  onProfileUpdate: (profile: StudentProfile) => void,
  onDone: () => void,
  onError: (message: string) => void
): StreamCancelFn {
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

  es.addEventListener("delta", (e: Event) => {
    const data = parseSseJson<ChatDeltaEvent>((e as MessageEvent<string>).data);
    onDelta(data.text);
  });

  es.addEventListener("profile_update", (e: Event) => {
    onProfileUpdate(parseSseJson<StudentProfile>((e as MessageEvent<string>).data));
  });

  es.addEventListener("done", () => {
    finish();
  });

  es.addEventListener("server_error", (e: Event) => {
    try {
      const data = parseSseJson<ChatServerErrorEvent>((e as MessageEvent<string>).data);
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

function isResourceType(value: string): value is ResourceType {
  return (
    value === "document" ||
    value === "quiz" ||
    value === "mindmap" ||
    value === "code_example" ||
    value === "reading"
  );
}

/** 解析 fetch ReadableStream 上的 SSE 行 */
async function consumeFetchSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ResourceStreamEventName | "delta" | "done", data: string) => void
): Promise<void> {
  const reader = body.getReader();
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
        onEvent(currentEvent as ResourceStreamEventName | "delta" | "done", raw);
      }
    }
  }
}

/** 流式资源生成；返回的函数为「暂停/取消」 */
export function streamGenerateResources(
  params: GenerateResourcesRequest,
  onProgress: (type: ResourceType, label: string, status: string) => void,
  onResource: (type: ResourceType, label: string, content: string) => void,
  onDone: () => void,
  onAbort?: () => void
): StreamCancelFn {
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
        console.error(
          "[streamGenerateResources] HTTP",
          res.status,
          await res.text().catch(() => "")
        );
        settle("done");
        return;
      }
      if (!res.body) {
        settle("done");
        return;
      }

      let shouldStop = false;
      await consumeFetchSse(res.body, (currentEvent, raw) => {
        if (shouldStop) return;
        try {
          if (currentEvent === "progress") {
            const data = parseSseJson<ResourceProgressEvent>(raw);
            if (isResourceType(data.type)) {
              onProgress(data.type, data.label, data.status);
            }
          } else if (currentEvent === "resource") {
            const data = parseSseJson<ResourceContentEvent>(raw);
            if (isResourceType(data.type)) {
              onResource(data.type, data.label, data.content);
            }
          } else if (currentEvent === "server_error") {
            const data = parseSseJson<ResourceServerErrorEvent>(raw);
            console.error("[streamGenerateResources] server_error", data.message);
          } else if (currentEvent === "done") {
            shouldStop = true;
            settle("done");
          }
        } catch {
          // ignore parse errors
        }
      });
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

export async function getLearningPath(
  sessionId: string,
  profile: StudentProfile,
  course = "人工智能导论"
): Promise<LearningPathResponse> {
  const body: LearningPathRequest = {
    session_id: sessionId,
    course,
    profile,
  };
  const res = await fetch(`${BASE_URL}/resources/learning-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonResponse<LearningPathResponse>(res);
}

/** 流式辅导问答，fetch + SSE 逐字回复 */
export function streamTutorAsk(
  params: TutorAskRequest,
  onDelta: (text: string) => void,
  onDone: () => void
): StreamCancelFn {
  const ctrl = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE_URL}/tutor/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        onDone();
        return;
      }

      let shouldStop = false;
      await consumeFetchSse(res.body, (currentEvent, raw) => {
        if (shouldStop) return;
        try {
          if (currentEvent === "delta") {
            const data = parseSseJson<TutorDeltaEvent>(raw);
            onDelta(data.text);
          } else if (currentEvent === "done") {
            shouldStop = true;
            onDone();
          }
        } catch {
          // ignore parse errors
        }
      });
      onDone();
    } catch {
      onDone();
    }
  })();

  return () => ctrl.abort();
}

/** 获取推荐问题列表 */
export async function getSuggestedQuestions(topic: string): Promise<string[]> {
  const res = await fetch(
    `${BASE_URL}/tutor/suggested-questions?topic=${encodeURIComponent(topic)}`
  );
  const data = await parseJsonResponse<SuggestedQuestionsResponse>(res);
  return data.questions || [];
}

// ── 知识库 API ──────────────────────────────────────────

export async function initKnowledge(): Promise<InitKnowledgeResponse> {
  const res = await fetch(`${BASE_URL}/knowledge/init`);
  return parseJsonResponse<InitKnowledgeResponse>(res);
}

export async function listCourses(): Promise<CoursesListResponse> {
  const res = await fetch(`${BASE_URL}/knowledge/courses`);
  return parseJsonResponse<CoursesListResponse>(res);
}

export async function listChapters(courseName: string): Promise<ChaptersListResponse> {
  const res = await fetch(
    `${BASE_URL}/knowledge/courses/${encodeURIComponent(courseName)}/chapters`
  );
  return parseJsonResponse<ChaptersListResponse>(res);
}

export async function getChapter(
  courseName: string,
  chapterId: string
): Promise<KnowledgeChapterDetail> {
  const res = await fetch(
    `${BASE_URL}/knowledge/courses/${encodeURIComponent(courseName)}/chapters/${chapterId}`
  );
  return parseJsonResponse<KnowledgeChapterDetail>(res);
}

export async function searchKnowledge(
  query: string,
  course?: string,
  topK = 3
): Promise<KnowledgeSearchResponse> {
  const params = new URLSearchParams({ q: query, top_k: String(topK) });
  if (course) params.set("course", course);
  const res = await fetch(`${BASE_URL}/knowledge/search?${params}`);
  return parseJsonResponse<KnowledgeSearchResponse>(res);
}

export async function searchKnowledgeWeb(
  query: string,
  topK = 8
): Promise<WebSearchResponse> {
  const params = new URLSearchParams({ q: query, top_k: String(topK) });
  const res = await fetch(`${BASE_URL}/knowledge/web-search?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail =
      typeof err === "object" && err !== null && "detail" in err
        ? String((err as { detail: unknown }).detail)
        : "联网检索失败";
    throw new Error(detail);
  }
  return parseJsonResponse<WebSearchResponse>(res);
}
