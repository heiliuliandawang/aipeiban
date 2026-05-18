import type { StudentProfile } from "./profile";

export type ResourceType =
  | "document"
  | "quiz"
  | "mindmap"
  | "code_example"
  | "reading";

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  document: "课程讲解文档",
  quiz: "练习题库",
  mindmap: "思维导图",
  code_example: "代码实操案例",
  reading: "拓展阅读",
};

export const RESOURCE_ICONS: Record<ResourceType, string> = {
  document: "📄",
  quiz: "✏️",
  mindmap: "🗺️",
  code_example: "💻",
  reading: "📚",
};

export interface GeneratedResource {
  type: ResourceType;
  label: string;
  content: string;
}

export type ResourceGenerationStatus = "idle" | "generating" | "done";

export type ResourceTaskStatus = "waiting" | "generating" | "done";

/** 后端 SSE progress 事件中的 status */
export type ResourceStreamProgressStatus = "generating" | "done";

export interface ResourceWorkspace {
  topic: string;
  selectedTypes: ResourceType[];
  status: ResourceGenerationStatus;
  taskStatuses: Partial<Record<ResourceType, ResourceTaskStatus>>;
  resources: GeneratedResource[];
  activeResourceType?: ResourceType;
}

export interface GenerateResourcesRequest {
  session_id: string;
  topic: string;
  resource_types: ResourceType[];
}

export interface ResourceProgressEvent {
  type: ResourceType;
  label: string;
  status: ResourceStreamProgressStatus;
}

export interface ResourceContentEvent {
  type: ResourceType;
  label: string;
  content: string;
}

export interface ResourceServerErrorEvent {
  message: string;
}

export type ResourceStreamEventName = "progress" | "resource" | "server_error" | "done";

export interface LearningPathRequest {
  session_id: string;
  course: string;
  profile: StudentProfile;
}

export interface LearningPathResponse {
  path: string;
}

export interface RecommendationsResponse {
  recommendation: string;
}
