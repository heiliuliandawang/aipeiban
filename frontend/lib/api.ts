import { unwrapAgentContent } from "@/lib/agentResponse";
import type {
  AdjustPathRequest,
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
  MarkChapterRequest,
  ProgressSummary,
  RecordQuizScoreRequest,
  SessionSyncRequest,
  SessionStateResponse,
  SessionSyncResponse,
  StreamCancelFn,
  StudentProfile,
  SuggestedQuestionsResponse,
  TutorAskRequest,
  TutorDeltaEvent,
  TutorHistoryResponse,
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

export async function getSessionState(sessionId: string): Promise<SessionStateResponse> {
  const res = await fetch(`${BASE_URL}/chat/session/${sessionId}`);
  return parseJsonResponse<SessionStateResponse>(res);
}

export async function getProfile(sessionId: string): Promise<StudentProfile> {
  const res = await fetch(`${BASE_URL}/chat/profile/${sessionId}`);
  return parseJsonResponse<StudentProfile>(res);
}

export async function syncSessionState(params: SessionSyncRequest): Promise<SessionSyncResponse> {
  const res = await fetch(`${BASE_URL}/chat/session/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJsonResponse<SessionSyncResponse>(res);
}

export async function clearChatSession(sessionId: string): Promise<ClearSessionResponse> {
  const res = await fetch(`${BASE_URL}/chat/session/${sessionId}`, { method: "DELETE" });
  return parseJsonResponse<ClearSessionResponse>(res);
}

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
    onDelta(unwrapAgentContent(data.text));
  });

  es.addEventListener("profile_update", (e: Event) => {
    onProfileUpdate(parseSseJson<StudentProfile>((e as MessageEvent<string>).data));
  });

  es.addEventListener("done", () => finish());

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
  return ["document", "quiz", "mindmap", "code_example", "reading"].includes(value);
}

type SseEventName =
  | ResourceStreamEventName
  | "delta"
  | "done"
  | "profile_update"
  | "server_error";

async function consumeFetchSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEventName, data: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  const dispatchLine = (line: string) => {
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (normalized.startsWith("event: ")) {
      currentEvent = normalized.slice(7).trim();
    } else if (normalized.startsWith("data:")) {
      const raw = normalized.slice(5).trimStart();
      if (!raw) {
        if (currentEvent === "done") onEvent("done", "");
        return;
      }
      onEvent((currentEvent || "message") as SseEventName, raw);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) dispatchLine(line);
  }

  if (buffer.trim()) dispatchLine(buffer);
}
export function streamGenerateResources(
  params: GenerateResourcesRequest,
  onProgress: (type: ResourceType, label: string, status: string) => void,
  onResource: (type: ResourceType, label: string, content: string) => void,
  onDone: () => void,
  onError: (message: string) => void,
  onAbort?: () => void
): StreamCancelFn {
  const ctrl = new AbortController();
  let settled = false;
  let errored = false;
  const settle = (mode: "done" | "abort") => {
    if (settled) return;
    settled = true;
    if (mode === "abort") onAbort?.();
    else if (!errored) onDone();
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
        const detail = await res.text().catch(() => "");
        console.error("[streamGenerateResources] HTTP", res.status, detail);
        errored = true;
        onError(
          res.status === 0
            ? "无法连接后端，请确认 http://localhost:8000 已启动。"
            : `资源生成请求失败（HTTP ${res.status}）${detail ? `：${detail.slice(0, 120)}` : ""}`
        );
        return;
      }
      if (!res.body) {
        errored = true;
        onError("资源生成流为空，请稍后重试。");
        return;
      }

      let shouldStop = false;
      let receivedResource = false;
      await consumeFetchSse(res.body, (currentEvent, raw) => {
        if (shouldStop) return;
        try {
          if (currentEvent === "progress") {
            const data = parseSseJson<ResourceProgressEvent>(raw);
            if (isResourceType(data.type)) onProgress(data.type, data.label, data.status);
          } else if (currentEvent === "resource") {
            const data = parseSseJson<ResourceContentEvent>(raw);
            if (isResourceType(data.type)) {
              receivedResource = true;
              onResource(data.type, data.label, unwrapAgentContent(data.content));
            }
          } else if (currentEvent === "server_error") {
            const data = parseSseJson<ResourceServerErrorEvent>(raw);
            console.error("[streamGenerateResources] server_error", data.message);
            errored = true;
            onError(data.message || "资源生成失败，请检查模型 API 配置。");
          } else if (currentEvent === "done") {
            shouldStop = true;
            if (!errored && !receivedResource) {
              errored = true;
              onError("未收到任何资源内容，请检查 backend/.env 中的星火 API 配置，或先只选 1 种类型重试。");
            } else {
              settle("done");
            }
          }
        } catch (err) {
          console.error("[streamGenerateResources] parse event", currentEvent, err);
        }
      });
      if (!errored) {
        if (!receivedResource) {
          errored = true;
          onError("未收到任何资源内容，请检查后端日志或 API 配置。");
        } else {
          settle("done");
        }
      }
    } catch (e) {
      if (ctrl.signal.aborted) settle("abort");
      else {
        console.error("[streamGenerateResources]", e);
        errored = true;
        onError("无法连接后端，请确认服务已启动且浏览器未拦截跨域请求。");
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
  const body: LearningPathRequest = { session_id: sessionId, course, profile };
  const res = await fetch(`${BASE_URL}/resources/learning-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonResponse<LearningPathResponse>(res);
  return { path: unwrapAgentContent(data.path || "") };
}

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
          // ignore
        }
      });
      onDone();
    } catch {
      onDone();
    }
  })();

  return () => ctrl.abort();
}

export async function getTutorHistory(sessionId: string): Promise<TutorHistoryResponse> {
  const res = await fetch(`${BASE_URL}/tutor/history/${sessionId}`);
  return parseJsonResponse<TutorHistoryResponse>(res);
}

export async function clearTutorHistory(sessionId: string): Promise<{ message: string }> {
  const res = await fetch(`${BASE_URL}/tutor/history/${sessionId}`, { method: "DELETE" });
  return parseJsonResponse<{ message: string }>(res);
}

export async function getSuggestedQuestions(topic: string): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/tutor/suggested-questions?topic=${encodeURIComponent(topic)}`);
  const data = await parseJsonResponse<SuggestedQuestionsResponse>(res);
  return data.questions || [];
}

export async function initKnowledge(): Promise<InitKnowledgeResponse> {
  const res = await fetch(`${BASE_URL}/knowledge/init`);
  return parseJsonResponse<InitKnowledgeResponse>(res);
}

export async function listCourses(): Promise<CoursesListResponse> {
  const res = await fetch(`${BASE_URL}/knowledge/courses`);
  return parseJsonResponse<CoursesListResponse>(res);
}

export async function listChapters(courseName: string): Promise<ChaptersListResponse> {
  const res = await fetch(`${BASE_URL}/knowledge/courses/${encodeURIComponent(courseName)}/chapters`);
  return parseJsonResponse<ChaptersListResponse>(res);
}

export async function getChapter(courseName: string, chapterId: string): Promise<KnowledgeChapterDetail> {
  const res = await fetch(`${BASE_URL}/knowledge/courses/${encodeURIComponent(courseName)}/chapters/${chapterId}`);
  return parseJsonResponse<KnowledgeChapterDetail>(res);
}

export async function searchKnowledge(query: string, course?: string, topK = 3, signal?: AbortSignal): Promise<KnowledgeSearchResponse> {
  const params = new URLSearchParams({ q: query, top_k: String(topK) });
  if (course) params.set("course", course);
  const res = await fetch(`${BASE_URL}/knowledge/search?${params}`, { signal });
  return parseJsonResponse<KnowledgeSearchResponse>(res);
}

export function streamAdjustPath(params: AdjustPathRequest, onDelta: (text: string) => void, onDone: () => void, onError: (message: string) => void): StreamCancelFn {
  const ctrl = new AbortController();
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    onDone();
  };

  (async () => {
    try {
      const res = await fetch(`${BASE_URL}/chat/path/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        onError("路径调整服务暂时不可用，请稍后重试。");
        settle();
        return;
      }

      let shouldStop = false;
      await consumeFetchSse(res.body, (event, raw) => {
        if (shouldStop) return;
        try {
          if (event === "delta") {
            const data = parseSseJson<ChatDeltaEvent>(raw);
            onDelta(unwrapAgentContent(data.text));
          } else if (event === "done") {
            shouldStop = true;
            settle();
          } else if (event === "server_error") {
            const data = parseSseJson<{ message: string }>(raw);
            onError(data.message || "路径调整失败，请重试。");
          }
        } catch {
          // ignore
        }
      });
      settle();
    } catch (e) {
      if (!ctrl.signal.aborted) onError("连接中断，请检查后端服务。");
      settle();
    }
  })();

  return () => ctrl.abort();
}

export async function searchKnowledgeWeb(query: string, topK = 8, signal?: AbortSignal): Promise<WebSearchResponse> {
  const params = new URLSearchParams({ q: query, top_k: String(topK) });
  const res = await fetch(`${BASE_URL}/knowledge/web-search?${params}`, { signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = typeof err === "object" && err !== null && "detail" in err ? String((err as { detail: unknown }).detail) : "联网检索失败";
    throw new Error(detail);
  }
  return parseJsonResponse<WebSearchResponse>(res);
}

export async function markChapterComplete(sessionId: string, course: string, chapterId: string): Promise<{ message: string; chapter_id: string }> {
  const body: MarkChapterRequest = { session_id: sessionId, course, chapter_id: chapterId };
  const res = await fetch(`${BASE_URL}/progress/chapter/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonResponse<{ message: string; chapter_id: string }>(res);
}

export async function recordQuizScore(sessionId: string, quizTopic: string, score: number, total: number): Promise<{ message: string; percentage: number }> {
  const body: RecordQuizScoreRequest = { session_id: sessionId, quiz_topic: quizTopic, score, total };
  const res = await fetch(`${BASE_URL}/progress/quiz/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonResponse<{ message: string; percentage: number }>(res);
}

export async function getProgressSummary(sessionId: string): Promise<ProgressSummary> {
  const res = await fetch(`${BASE_URL}/progress/summary/${sessionId}`);
  return parseJsonResponse<ProgressSummary>(res);
}