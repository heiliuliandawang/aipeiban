export type {
  KnowledgeLevel,
  CognitiveStyle,
  LearningGoal,
  LearningPace,
  StudentProfile,
  ProfileDimensionKey,
} from "./profile";
export {
  PROFILE_DIMENSION_LABELS,
  createEmptyProfile,
  isProfileDimensionFilled,
} from "./profile";

export type {
  ResourceType,
  GeneratedResource,
  ResourceGenerationStatus,
  ResourceTaskStatus,
  ResourceStreamProgressStatus,
  ResourceWorkspace,
  GenerateResourcesRequest,
  ResourceProgressEvent,
  ResourceContentEvent,
  ResourceServerErrorEvent,
  ResourceStreamEventName,
  LearningPathRequest,
  LearningPathResponse,
  RecommendationsResponse,
} from "./resource";
export { RESOURCE_LABELS, RESOURCE_ICONS } from "./resource";

export type {
  MessageRole,
  ChatMessage,
  ApiChatMessage,
  CreateSessionResponse,
  BackendSessionSummary,
  ListSessionsResponse,
  SessionStateResponse,
  SessionSyncRequest,
  SessionSyncResponse,
  ClearSessionResponse,
  SendMessageRequest,
  SendMessageResponse,
  ChatStreamEventName,
  ChatDeltaEvent,
  ChatServerErrorEvent,
  TutorStreamEventName,
  TutorDeltaEvent,
  TutorAskRequest,
  SuggestedQuestionsResponse,
  StreamCancelFn,
  ChatStreamCallbacks,
  TutorStreamCallbacks,
} from "./chat";
export { parseSseJson } from "./chat";

/** 辅导面板消息 */
export interface TutorMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  topic?: string;
}

/** 本地持久化的学习计划会话 */
export interface PlannerSession {
  id: string;
  title: string;
  isCustomTitle?: boolean;
  customSummary?: string;
  customTags?: string[];
  createdAt: string;
  updatedAt: string;
  profile: import("./profile").StudentProfile;
  messages: import("./chat").ChatMessage[];
  learningPath: string;
  resourceWorkspace: import("./resource").ResourceWorkspace;
}

/** 知识库 API 类型 */
export interface KnowledgeCourse {
  name: string;
  title: string;
  description: string;
  chapter_count: number;
  search_mode?: string;
}

export interface KnowledgeChapter {
  id: string;
  title: string;
  keywords: string[];
  file: string;
  exists: boolean;
}

export interface KnowledgeChapterDetail {
  id: string;
  title: string;
  content: string;
  summary?: string;
  keywords: string[];
}

export interface KnowledgeSearchResult {
  title: string;
  content_preview: string;
  course: string;
  chapter_id: string;
  relevance_score: number;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface CoursesListResponse {
  courses: KnowledgeCourse[];
}

export interface ChaptersListResponse {
  course: string;
  chapters: KnowledgeChapter[];
}

export interface KnowledgeSearchResponse {
  query: string;
  results: KnowledgeSearchResult[];
  count: number;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  count: number;
  source?: string;
}

export interface InitKnowledgeResponse {
  message: string;
}
