/** 知识基础等级 */
export type KnowledgeLevel = "入门" | "初级" | "中级" | "高级";

/** 认知风格 */
export type CognitiveStyle = "视觉型" | "逻辑型" | "实操型";

/** 学习目标 */
export type LearningGoal = "考研" | "竞赛" | "就业" | "兴趣";

/** 学习节奏 */
export type LearningPace = "快速" | "深度";

/** 六维学生画像（与后端 StudentProfile 对齐） */
export interface StudentProfile {
  session_id: string;
  name?: string;
  /** 专业方向 */
  major?: string;
  /** 知识基础 */
  knowledge_level?: KnowledgeLevel;
  /** 认知风格 */
  cognitive_style?: CognitiveStyle;
  /** 学习目标 */
  learning_goal?: LearningGoal;
  /** 薄弱知识点 */
  weak_points: string[];
  /** 学习节奏 */
  learning_pace?: LearningPace;
  /** 每日可用时间 */
  available_time?: string;
  /** 画像是否构建完整 */
  completed_at: boolean;
}

/** 画像六维字段（用于完成度统计与侧栏展示） */
export type ProfileDimensionKey =
  | "major"
  | "knowledge_level"
  | "cognitive_style"
  | "learning_goal"
  | "weak_points"
  | "learning_pace"
  | "available_time";

export const PROFILE_DIMENSION_LABELS: Record<ProfileDimensionKey, string> = {
  major: "专业方向",
  knowledge_level: "知识基础",
  cognitive_style: "认知风格",
  learning_goal: "学习目标",
  weak_points: "薄弱知识点",
  learning_pace: "学习节奏",
  available_time: "每日时间",
};

export function createEmptyProfile(sessionId: string): StudentProfile {
  return {
    session_id: sessionId,
    weak_points: [],
    completed_at: false,
  };
}

export function isProfileDimensionFilled(
  profile: StudentProfile,
  key: ProfileDimensionKey
): boolean {
  if (key === "weak_points") return profile.weak_points.length > 0;
  const value = profile[key];
  return value !== undefined && value !== null && value !== "";
}
