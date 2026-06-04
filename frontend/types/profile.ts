// ── 枚举联合类型 ─────────────────────────────────────────────────────────────

/** 知识掌握度分档（由 knowledge_mastery 推算，向后兼容旧字段） */
export type KnowledgeLevel = "入门" | "初级" | "中级" | "高级";

/** 学习偏好（重构后替代 cognitive_style，后端同步写入两个字段） */
export type LearningPreference = "视觉型" | "逻辑型" | "实操型";

/** 认知风格（旧名，保留向后兼容） */
export type CognitiveStyle = LearningPreference;

/** 学习目标 */
export type LearningGoal = "考研" | "竞赛" | "就业" | "兴趣";

/** 学习节奏 */
export type LearningPace = "快速" | "深度";

/** 编程经验 */
export type ProgrammingExperience = "无" | "初级" | "中级" | "高级";

// ── 六维画像 interface ────────────────────────────────────────────────────────

/**
 * 六维学生画像（与后端 StudentProfile 对齐）
 *
 * 六维：知识掌握度、学习偏好、学习目标、薄弱知识点、编程经验、学习节奏
 */
export interface StudentProfile {
  session_id: string;
  name?: string;
  /** 专业方向 */
  major?: string;

  // ── 新六维核心字段 ──────────────────────────────────
  /** 知识掌握度 0.0–1.0 */
  knowledge_mastery?: number;
  /** 学习偏好 */
  learning_preference?: LearningPreference;
  /** 学习目标 */
  learning_goal?: LearningGoal;
  /** 薄弱知识点 */
  weak_points: string[];
  /** 编程经验 */
  programming_experience?: ProgrammingExperience;
  /** 学习节奏 */
  learning_pace?: LearningPace;

  // ── 向后兼容旧字段（由后端同步写入）──────────────────
  /** 知识基础标签，由 knowledge_mastery 推算 */
  knowledge_level?: KnowledgeLevel;
  /** 认知风格（同 learning_preference） */
  cognitive_style?: CognitiveStyle;
  /** 每日可用时间 */
  available_time?: string;

  /** 画像是否构建完整 */
  completed_at: boolean;
}

// ── 维度元信息 ────────────────────────────────────────────────────────────────

/** 六维画像维度 key */
export type ProfileDimensionKey =
  | "knowledge_mastery"
  | "learning_preference"
  | "learning_goal"
  | "weak_points"
  | "programming_experience"
  | "learning_pace";

/** 附加可选维度（侧栏展示用） */
export type ProfileExtraKey = "major" | "available_time";

export const PROFILE_DIMENSION_LABELS: Record<ProfileDimensionKey, string> = {
  knowledge_mastery: "知识掌握度",
  learning_preference: "学习偏好",
  learning_goal: "学习目标",
  weak_points: "薄弱知识点",
  programming_experience: "编程经验",
  learning_pace: "学习节奏",
};

/** 知识掌握度 → 颜色 token（用于进度条渐变） */
export function masteryToGradient(mastery: number): string {
  if (mastery < 0.25) return "from-green-400 to-emerald-400";
  if (mastery < 0.5) return "from-blue-400 to-indigo-400";
  if (mastery < 0.75) return "from-violet-400 to-purple-500";
  return "from-orange-400 to-red-400";
}

/** 知识掌握度 → 文字标签 */
export function masteryToLabel(mastery: number): string {
  if (mastery < 0.25) return "入门";
  if (mastery < 0.5) return "初级";
  if (mastery < 0.75) return "中级";
  return "高级";
}

// ── 工厂与工具函数 ────────────────────────────────────────────────────────────

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
  if (key === "knowledge_mastery")
    return profile.knowledge_mastery !== undefined && profile.knowledge_mastery !== null;
  const value = profile[key as keyof StudentProfile];
  return value !== undefined && value !== null && value !== "";
}

/** 统计已填写的六维数量 */
export function countFilledDimensions(profile: StudentProfile): number {
  return (Object.keys(PROFILE_DIMENSION_LABELS) as ProfileDimensionKey[]).filter(
    (key) => isProfileDimensionFilled(profile, key)
  ).length;
}
