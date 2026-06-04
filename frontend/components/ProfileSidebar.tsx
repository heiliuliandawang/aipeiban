"use client";

import type {
  LearningGoal,
  LearningPace,
  LearningPreference,
  ProgrammingExperience,
  ProfileDimensionKey,
  StudentProfile,
} from "@/types";
import {
  countFilledDimensions,
  isProfileDimensionFilled,
  masteryToGradient,
  masteryToLabel,
  PROFILE_DIMENSION_LABELS,
} from "@/types";

// ── 静态映射表 ──────────────────────────────────────────────────────────────

const PREFERENCE_ICONS: Record<LearningPreference, string> = {
  视觉型: "👁️",
  逻辑型: "🧠",
  实操型: "🔧",
};

const GOAL_ICONS: Record<LearningGoal, string> = {
  考研: "📖",
  竞赛: "🏆",
  就业: "💼",
  兴趣: "❤️",
};

const PACE_ICONS: Record<LearningPace, string> = {
  快速: "⚡",
  深度: "🔍",
};

const PROG_EXP_ICONS: Record<ProgrammingExperience, string> = {
  无: "🚫",
  初级: "🌱",
  中级: "⚙️",
  高级: "🚀",
};

const PROG_EXP_BADGE: Record<ProgrammingExperience, string> = {
  无: "bg-slate-100 text-slate-500 border-slate-200",
  初级: "bg-green-100 text-green-700 border-green-200",
  中级: "bg-blue-100 text-blue-700 border-blue-200",
  高级: "bg-violet-100 text-violet-700 border-violet-200",
};

const TOTAL_DIMENSIONS = 6;

interface Props {
  profile: StudentProfile;
  onReset?: () => void;
}

export default function ProfileSidebar({ profile, onReset }: Props) {
  const filledCount = countFilledDimensions(profile);
  const percentage = Math.round((filledCount / TOTAL_DIMENSIONS) * 100);
  const isComplete = profile.completed_at;

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="p-4 space-y-3 flex-1">

        {/* ── 画像完成度 ─────────────────────────────────── */}
        <div className={`rounded-xl p-3 border transition-all ${
          isComplete
            ? "bg-gradient-to-br from-green-50 to-emerald-50 border-green-200"
            : "bg-slate-50 border-slate-100"
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-600">画像完成度</span>
            <span className={`text-xs font-bold ${isComplete ? "text-green-600" : "text-indigo-600"}`}>
              {percentage}%
            </span>
          </div>
          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ${
                isComplete ? "from-green-400 to-emerald-500" : "from-indigo-500 to-violet-500"
              }`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          {isComplete ? (
            <p className="text-xs text-green-600 mt-2 font-medium flex items-center gap-1">
              <span>🎉</span> 画像构建完成！资源已个性化
            </p>
          ) : (
            <p className="text-xs text-slate-400 mt-1.5">
              {filledCount}/{TOTAL_DIMENSIONS} 个维度已收集
            </p>
          )}
        </div>

        {/* ── 六维画像 ───────────────────────────────────── */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-0.5">
            {Object.values(PROFILE_DIMENSION_LABELS).slice(0, 1)[0].slice(-2)}学习画像
          </h3>

          {/* 1. 知识掌握度 — 带渐变进度条 */}
          <MasteryCard mastery={profile.knowledge_mastery} />

          {/* 2. 学习偏好 */}
          <ProfileItem
            icon={profile.learning_preference ? PREFERENCE_ICONS[profile.learning_preference] : "🎨"}
            label="学习偏好"
            value={profile.learning_preference}
            placeholder="待识别"
          />

          {/* 3. 学习目标 */}
          <ProfileItem
            icon={profile.learning_goal ? GOAL_ICONS[profile.learning_goal] : "🎯"}
            label="学习目标"
            value={profile.learning_goal}
            placeholder="待确认"
          />

          {/* 4. 编程经验 */}
          <ProgrammingExpCard experience={profile.programming_experience} />

          {/* 5. 学习节奏 */}
          <ProfileItem
            icon={profile.learning_pace ? PACE_ICONS[profile.learning_pace] : "⏱️"}
            label="学习节奏"
            value={profile.learning_pace}
            placeholder="待了解"
          />

          {/* 6. 薄弱知识点 */}
          <WeakPointsCard weakPoints={profile.weak_points} />

          {/* 附加：专业方向 & 每日时间 */}
          <div className="pt-1 border-t border-slate-100 space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-0.5">
              其他信息
            </h3>
            <ProfileItem icon="🎓" label="专业方向" value={profile.major} placeholder="待收集" />
            <ProfileItem icon="🕐" label="每日时间" value={profile.available_time} placeholder="待填写" />
          </div>
        </div>

        {/* 引导提示 */}
        {!isComplete && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
            <p className="text-xs text-indigo-600 leading-relaxed">
              💡 在「学习对话」中与 AI 自然交流，画像会随对话自动更新
            </p>
          </div>
        )}
      </div>

      {/* 底部重置按钮 */}
      {onReset && (
        <div className="p-4 border-t border-slate-100 bg-white">
          <button
            onClick={() => {
              if (confirm("确认重置当前会话？画像数据将清空")) {
                onReset();
              }
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-colors border border-transparent hover:border-slate-200"
          >
            🔄 重置会话
          </button>
        </div>
      )}
    </div>
  );
}

// ── 子组件 ───────────────────────────────────────────────────────────────────

function ProfileItem({
  icon,
  label,
  value,
  placeholder,
}: {
  icon: string;
  label: string;
  value?: string | null;
  placeholder: string;
}) {
  return (
    <div className={`flex items-center gap-2 bg-white rounded-xl p-2.5 border shadow-sm transition-all ${
      value ? "border-slate-100" : "border-slate-100 opacity-70"
    }`}>
      <span className="text-base w-6 text-center flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-xs text-slate-400 block leading-tight">{label}</span>
        {value ? (
          <span className="text-xs font-medium text-slate-700 block truncate">{value}</span>
        ) : (
          <span className="text-xs text-slate-300">{placeholder}</span>
        )}
      </div>
      {value && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
    </div>
  );
}

/** 知识掌握度卡片：渐变进度条 + 数字 + 标签 */
function MasteryCard({ mastery }: { mastery?: number | null }) {
  const filled = mastery !== undefined && mastery !== null;
  const pct = filled ? Math.round(mastery! * 100) : 0;
  const label = filled ? masteryToLabel(mastery!) : null;
  const gradient = filled ? masteryToGradient(mastery!) : "from-slate-200 to-slate-300";

  return (
    <div className={`bg-white rounded-xl p-2.5 border shadow-sm transition-all ${
      filled ? "border-slate-100" : "border-slate-100 opacity-70"
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base w-6 text-center flex-shrink-0">📊</span>
        <span className="text-xs text-slate-400 flex-1">知识掌握度</span>
        {filled ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-700">{pct}%</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border bg-gradient-to-r ${gradient} text-white border-transparent`}>
              {label}
            </span>
          </div>
        ) : (
          <span className="text-xs text-slate-300">待评估</span>
        )}
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ${gradient}`}
          style={{ width: filled ? `${pct}%` : "0%" }}
        />
      </div>
    </div>
  );
}

/** 编程经验卡片：彩色 badge */
function ProgrammingExpCard({
  experience,
}: {
  experience?: ProgrammingExperience | null;
}) {
  return (
    <div className={`flex items-center gap-2 bg-white rounded-xl p-2.5 border shadow-sm transition-all ${
      experience ? "border-slate-100" : "border-slate-100 opacity-70"
    }`}>
      <span className="text-base w-6 text-center flex-shrink-0">
        {experience ? PROG_EXP_ICONS[experience] : "💻"}
      </span>
      <div className="flex-1 min-w-0">
        <span className="text-xs text-slate-400 block leading-tight">编程经验</span>
        {experience ? (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg mt-0.5 inline-block border ${
            PROG_EXP_BADGE[experience]
          }`}>
            {experience}
          </span>
        ) : (
          <span className="text-xs text-slate-300">待了解</span>
        )}
      </div>
      {experience && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
    </div>
  );
}

/** 薄弱知识点卡片：彩色 tag 列表 */
function WeakPointsCard({ weakPoints }: { weakPoints: string[] }) {
  const hasPoints = weakPoints.length > 0;
  return (
    <div className="bg-white rounded-xl p-2.5 border border-slate-100 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">⚠️</span>
        <span className="text-xs font-medium text-slate-600">薄弱知识点</span>
        {hasPoints && (
          <span className="ml-auto text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
            {weakPoints.length} 项
          </span>
        )}
      </div>
      {hasPoints ? (
        <div className="flex flex-wrap gap-1.5">
          {weakPoints.map((point, i) => (
            <span
              key={i}
              className="inline-block bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2 py-0.5 rounded-full"
            >
              {point}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-xs text-slate-300">待识别</span>
      )}
    </div>
  );
}
