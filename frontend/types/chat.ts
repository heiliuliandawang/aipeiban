import type { StudentProfile } from "./profile";

export type MessageRole = "user" | "assistant";

/** 前端 UI 消息（含时间戳） */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  timestamp: Date;
}

/** 与后端同步的历史消息 */
export interface ApiChatMessage {
  role: MessageRole;
  content: string;
}

export interface CreateSessionResponse {
  session_id: string;
}

export interface BackendSessionSummary {
  session_id: string;
  user_id: string;
  created_at: string;
  last_access: string;
  profile: StudentProfile;
}

export interface ListSessionsResponse {
  sessions: BackendSessionSummary[];
}

export interface SessionStateResponse {
  session_id: string;
  profile: StudentProfile;
  messages: Array<ApiChatMessage & { timestamp: string }>;
}

export interface SessionSyncRequest {
  session_id: string;
  profile: StudentProfile;
  history: ApiChatMessage[];
}

export interface SessionSyncResponse {
  message: string;
}

export interface ClearSessionResponse {
  message: string;
}

export interface SendMessageRequest {
  session_id: string;
  message: string;
  history?: ApiChatMessage[];
}

export interface SendMessageResponse {
  reply: string;
  profile: StudentProfile;
}

/** EventSource `/chat/message/stream` 事件名 */
export type ChatStreamEventName = "delta" | "profile_update" | "done" | "server_error";

export interface ChatDeltaEvent {
  text: string;
}

export interface ChatServerErrorEvent {
  message: string;
  detail?: string;
}

/** fetch SSE `/tutor/ask/stream` 事件名 */
export type TutorStreamEventName = "delta" | "done";

export interface TutorDeltaEvent {
  text: string;
}

export interface TutorAskRequest {
  session_id: string;
  question: string;
  current_topic: string;
}

export interface SuggestedQuestionsResponse {
  topic: string;
  questions: string[];
}

/** 流式请求取消函数 */
export type StreamCancelFn = () => void;

export interface ChatStreamCallbacks {
  onDelta: (text: string) => void;
  onProfileUpdate: (profile: StudentProfile) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export interface TutorStreamCallbacks {
  onDelta: (text: string) => void;
  onDone: () => void;
}

/** 从 SSE MessageEvent.data 解析 JSON */
export function parseSseJson<T>(data: string): T {
  return JSON.parse(data) as T;
}
