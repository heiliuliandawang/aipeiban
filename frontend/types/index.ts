export type {
  KnowledgeLevel,
  LearningPreference,
  CognitiveStyle,
  LearningGoal,
  LearningPace,
  ProgrammingExperience,
  StudentProfile,
  ProfileDimensionKey,
  ProfileExtraKey,
} from "./profile";
export {
  PROFILE_DIMENSION_LABELS,
  masteryToGradient,
  masteryToLabel,
  createEmptyProfile,
  isProfileDimensionFilled,
  countFilledDimensions,
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
  AdjustPathRequest,
  PathAdjustStreamEventName,
} from "./chat";
export { parseSseJson } from "./chat";

export type { TutorMessage, TutorWorkspace, TutorHistoryResponse } from "./tutor";
export {
  TUTOR_WELCOME_CONTENT,
  createTutorWelcomeMessage,
  createEmptyTutorWorkspace,
} from "./tutor";

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
  tutorWorkspace: import("./tutor").TutorWorkspace;
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

/** 学习进度管理 */
export interface ChapterProgress {
  course: string;
  chapter_id: string;
  completed_at: string;
}

export interface QuizScore {
  quiz_topic: string;
  score: number;
  total: number;
  percentage: number;
  created_at: string;
}

export interface ComprehensionScore {
  topic: string;
  score: number;
  feedback: string;
  created_at: string;
}

export interface WeakPoint {
  weak_point: string;
  status: string;
}

export interface ProgressSummary {
  session_id: string;
  completed_chapters: ChapterProgress[];
  chapter_count: number;
  quiz_scores: QuizScore[];
  quiz_average: number;
  comprehension_scores: ComprehensionScore[];
  comprehension_average: number;
  weak_points: WeakPoint[];
}

export interface MarkChapterRequest {
  session_id: string;
  course: string;
  chapter_id: string;
}

export interface RecordQuizScoreRequest {
  session_id: string;
  quiz_topic: string;
  score: number;
  total: number;
}
