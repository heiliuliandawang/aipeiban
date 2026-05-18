export interface StudentProfile {
  session_id: string;
  name?: string;
  major?: string;
  knowledge_level?: "入门" | "初级" | "中级" | "高级";
  cognitive_style?: "视觉型" | "逻辑型" | "实操型";
  learning_goal?: "考研" | "竞赛" | "就业" | "兴趣";
  weak_points: string[];
  learning_pace?: "快速" | "深度";
  available_time?: string;
  completed_at: boolean;
}

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

export interface ResourceWorkspace {
  topic: string;
  selectedTypes: ResourceType[];
  status: ResourceGenerationStatus;
  taskStatuses: Partial<Record<ResourceType, ResourceTaskStatus>>;
  resources: GeneratedResource[];
  activeResourceType?: ResourceType;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface PlannerSession {
  id: string;
  title: string;
  isCustomTitle?: boolean;
  customSummary?: string;
  customTags?: string[];
  createdAt: string;
  updatedAt: string;
  profile: StudentProfile;
  messages: ChatMessage[];
  learningPath: string;
  resourceWorkspace: ResourceWorkspace;
}

export interface TutorMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  topic?: string;
}

export interface KnowledgeCourse {
  name: string;
  title: string;
  description: string;
  chapter_count: number;
}

export interface KnowledgeChapter {
  id: string;
  title: string;
  keywords: string[];
  file: string;
  exists: boolean;
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
