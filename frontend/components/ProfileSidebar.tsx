"use client";

import type {
  CognitiveStyle,
  KnowledgeLevel,
  LearningGoal,
  LearningPace,
  ProfileDimensionKey,
  StudentProfile,
} from "@/types";
import { isProfileDimensionFilled } from "@/types";

const LEVEL_THEME: Record<KnowledgeLevel, { badge: string; bar: string }> = {
  入门: { badge: "bg-green-100 text-green-700 border-green-200", bar: "from-green-400 to-emerald-400" },
  初级: { badge: "bg-blue-100 text-blue-700 border-blue-200",  bar: "from-blue-400 to-indigo-400" },
  中级: { badge: "bg-violet-100 text-violet-700 border-violet-200", bar: "from-violet-400 to-purple-500" },
  高级: { badge: "bg-orange-100 text-orange-700 border-orange-200", bar: "from-orange-400 to-red-400" },
};

const STYLE_ICONS: Record<CognitiveStyle, string> = {
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

const PROFILE_DIMENSIONS: ProfileDimensionKey[] = [
  "major",
  "knowledge_level",
  "cognitive_style",
  "learning_goal",
  "weak_points",
  "learning_pace",
  "available_time",
];

interface Props {
  profile: StudentProfile;
  onReset?: () => void;
}

export default function ProfileSidebar({ profile, onReset }: Props) {
  const filledCount = PROFILE_DIMENSIONS.filter((key) =>
    isProfileDimensionFilled(profile, key)
  ).length;
  const total = PROFILE_DIMENSIONS.length;
  const percentage = Math.round((filledCount / total) * 100);

  const isComplete = profile.completed_at;

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="p-4 space-y-3 flex-1">

        {/* 画像完成度 */}
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
                isComplete
                  ? "from-green-400 to-emerald-500"
                  : "from-indigo-500 to-violet-500"
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
              {filledCount}/{total} 个维度已收集
            </p>
          )}
        </div>

        {/* 六维画像 */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-0.5">
            学习画像
          </h3>

          <ProfileItem icon="🎓" label="专业方向" value={profile.major} placeholder="待收集" />

          {/* 知识基础特殊处理：带颜色 badge */}
          <div className="flex items-center gap-2 bg-white rounded-xl p-2.5 border border-slate-100 shadow-sm">
            <span className="text-base w-6 text-center flex-shrink-0">📊</span>
            <div className="flex-1 min-w-0">
              <span className="text-xs text-slate-400 block leading-tight">知识基础</span>
              {profile.knowledge_level ? (
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-lg mt-0.5 inline-block border ${
                    LEVEL_THEME[profile.knowledge_level].badge
                  }`}
                >
                  {profile.knowledge_level}
                </span>
              ) : (
                <span className="text-xs text-slate-300">待评估</span>
              )}
            </div>
          </div>

          <ProfileItem
            icon={profile.cognitive_style ? STYLE_ICONS[profile.cognitive_style] || "🎨" : "🎨"}
            label="认知风格"
            value={profile.cognitive_style}
            placeholder="待识别"
          />
          <ProfileItem
            icon={profile.learning_goal ? GOAL_ICONS[profile.learning_goal] || "🎯" : "🎯"}
            label="学习目标"
            value={profile.learning_goal}
            placeholder="待确认"
          />
          <ProfileItem
            icon={profile.learning_pace ? PACE_ICONS[profile.learning_pace] || "⏱️" : "⏱️"}
            label="学习节奏"
            value={profile.learning_pace}
            placeholder="待了解"
          />
          <ProfileItem icon="🕐" label="每日时间" value={profile.available_time} placeholder="待填写" />

          {/* 薄弱知识点 */}
          <div className="bg-white rounded-xl p-2.5 border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">⚠️</span>
              <span className="text-xs font-medium text-slate-600">薄弱知识点</span>
            </div>
            {profile.weak_points.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {profile.weak_points.map((point, i) => (
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
      {value && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
      )}
    </div>
  );
}
