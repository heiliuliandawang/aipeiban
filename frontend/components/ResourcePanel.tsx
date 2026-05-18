"use client";

import { useRef, useState } from "react";
import { streamGenerateResources } from "@/lib/api";
import type {
  GeneratedResource,
  ResourceTaskStatus,
  ResourceType,
  ResourceWorkspace,
  StudentProfile,
} from "@/types";
import { RESOURCE_LABELS, RESOURCE_ICONS } from "@/types";

const ALL_RESOURCE_TYPES: ResourceType[] = [
  "document",
  "quiz",
  "mindmap",
  "code_example",
  "reading",
];

const SUGGESTED_TOPICS = [
  "机器学习基础",
  "神经网络与深度学习",
  "自然语言处理",
  "卷积神经网络（CNN）",
  "大语言模型与Transformer",
  "强化学习基础",
];

// 每种资源类型的主题色
const RESOURCE_THEME: Record<ResourceType, { color: string; bg: string; border: string; active: string }> = {
  document:     { color: "text-blue-700",   bg: "bg-blue-50",   border: "border-blue-200",  active: "bg-blue-600" },
  quiz:         { color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", active: "bg-emerald-600" },
  mindmap:      { color: "text-amber-700",  bg: "bg-amber-50",  border: "border-amber-200", active: "bg-amber-500" },
  code_example: { color: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200", active: "bg-violet-600" },
  reading:      { color: "text-rose-700",   bg: "bg-rose-50",   border: "border-rose-200",  active: "bg-rose-500" },
};

interface Props {
  sessionId: string;
  profile: StudentProfile;
  workspace: ResourceWorkspace;
  onWorkspaceChange: (updater: (prev: ResourceWorkspace) => ResourceWorkspace) => void;
}

export default function ResourcePanel({ sessionId, profile, workspace, onWorkspaceChange }: Props) {
  const { topic, selectedTypes, status, taskStatuses, resources, activeResourceType } = workspace;
  const activeResource = resources.find((resource) => resource.type === activeResourceType) || resources[0] || null;
  const stopStreamRef = useRef<(() => void) | null>(null);

  const stopGeneration = () => {
    stopStreamRef.current?.();
  };

  const toggleType = (type: ResourceType) => {
    onWorkspaceChange((prev) => ({
      ...prev,
      selectedTypes: prev.selectedTypes.includes(type)
        ? prev.selectedTypes.filter((t) => t !== type)
        : [...prev.selectedTypes, type],
    }));
  };

  const startGeneration = () => {
    if (!topic.trim() || selectedTypes.length === 0) return;
    const initStatuses: Partial<Record<ResourceType, ResourceTaskStatus>> = {};
    selectedTypes.forEach((t) => (initStatuses[t] = "waiting"));
    onWorkspaceChange((prev) => ({
      ...prev,
      topic: topic.trim(),
      status: "generating",
      resources: [],
      activeResourceType: undefined,
      taskStatuses: initStatuses,
    }));

    const stop = streamGenerateResources(
      { session_id: sessionId, topic: topic.trim(), resource_types: selectedTypes },
      (type, _label, taskStatus) => {
        onWorkspaceChange((prev) => ({
          ...prev,
          taskStatuses: {
            ...prev.taskStatuses,
            [type]: taskStatus === "generating" ? "generating" : "done",
          },
        }));
      },
      (type, label, content) => {
        const resource: GeneratedResource = { type, label, content };
        onWorkspaceChange((prev) => {
          const updatedResources = [...prev.resources.filter((item) => item.type !== resource.type), resource];
          return {
            ...prev,
            resources: updatedResources,
            activeResourceType: prev.activeResourceType || resource.type,
            taskStatuses: {
              ...prev.taskStatuses,
              [resource.type]: "done",
            },
          };
        });
      },
      () => {
        stopStreamRef.current = null;
        onWorkspaceChange((prev) => ({
          ...prev,
          status: "done",
        }));
      },
      () => {
        stopStreamRef.current = null;
        onWorkspaceChange((prev) => {
          const nextStatuses: Partial<Record<ResourceType, ResourceTaskStatus>> = {};
          for (const t of prev.selectedTypes) {
            if (prev.taskStatuses[t] === "done") nextStatuses[t] = "done";
          }
          return {
            ...prev,
            status: "idle",
            taskStatuses: nextStatuses,
          };
        });
      }
    );
    stopStreamRef.current = stop;
  };

  // 已完成数量
  const doneCount = Object.values(taskStatuses).filter((s) => s === "done").length;
  const totalCount = selectedTypes.length;

  return (
    <div className="h-full flex overflow-hidden">
      {/* ── 左侧配置面板 ── */}
      <div className="w-72 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-y-auto">
        <div className="p-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-800 text-base">资源生成配置</h2>
          <p className="text-xs text-slate-500 mt-0.5">5 个专属 Agent 并发生成</p>
        </div>

        <div className="p-4 space-y-5 flex-1">
          {/* 主题输入 */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">
              知识主题
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) =>
                onWorkspaceChange((prev) => ({
                  ...prev,
                  topic: e.target.value,
                }))
              }
              onKeyDown={(e) => e.key === "Enter" && startGeneration()}
              placeholder="如：机器学习基础"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {SUGGESTED_TOPICS.map((t) => (
                <button
                  key={t}
                  onClick={() =>
                    onWorkspaceChange((prev) => ({
                      ...prev,
                      topic: t,
                    }))
                  }
                  className="text-xs bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 px-2 py-0.5 rounded-lg transition-colors"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* 生成进度（生成中显示） */}
          {status === "generating" && totalCount > 0 && (
            <div className="animate-fade-in">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-600">生成进度</span>
                <span className="text-xs text-indigo-600 font-bold">{doneCount}/{totalCount}</span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500"
                  style={{ width: `${(doneCount / totalCount) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* 资源类型选择 */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">
              生成类型 ({selectedTypes.length}/{ALL_RESOURCE_TYPES.length})
            </label>
            <div className="space-y-1.5">
              {ALL_RESOURCE_TYPES.map((type) => {
                const isSelected = selectedTypes.includes(type);
                const taskStatus = taskStatuses[type];
                const theme = RESOURCE_THEME[type];
                return (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    disabled={status === "generating"}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-sm transition-all ${
                      isSelected
                        ? `${theme.border} ${theme.bg} ${theme.color}`
                        : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50"
                    }`}
                  >
                    <span className="text-base">{RESOURCE_ICONS[type]}</span>
                    <span className="flex-1 text-left text-xs font-medium">
                      {RESOURCE_LABELS[type]}
                    </span>
                    {taskStatus === "generating" && (
                      <svg className="w-3.5 h-3.5 animate-spin text-current opacity-70" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {taskStatus === "done" && (
                      <span className="text-emerald-500 font-bold text-sm">✓</span>
                    )}
                    {!taskStatus && isSelected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 画像提示 */}
          {profile.knowledge_level && (
            <div className="bg-gradient-to-br from-indigo-50 to-violet-50 rounded-xl p-3 border border-indigo-100 text-xs">
              <p className="font-semibold text-indigo-700 mb-1">🎯 个性化生成已启用</p>
              <p className="text-indigo-600">
                {profile.knowledge_level} 水平 · {profile.cognitive_style || "通用"}风格
              </p>
              {profile.weak_points.length > 0 && (
                <p className="text-amber-600 mt-1">
                  ⚠️ 重点强化：{profile.weak_points.slice(0, 2).join("、")}
                </p>
              )}
            </div>
          )}
        </div>

        {/* 生成按钮 */}
        <div className="p-4 border-t border-slate-100 flex gap-2">
          {status === "generating" && (
            <button
              type="button"
              onClick={stopGeneration}
              className="flex-1 py-2.5 border border-amber-300 bg-amber-50 text-amber-800 rounded-xl text-sm font-semibold hover:bg-amber-100 transition-all"
            >
              暂停生成
            </button>
          )}
          <button
            onClick={startGeneration}
            disabled={!topic.trim() || selectedTypes.length === 0 || status === "generating"}
            className={`py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:from-slate-300 disabled:to-slate-300 text-white rounded-xl text-sm font-semibold transition-all shadow-sm hover:shadow-md ${
              status === "generating" ? "flex-1" : "w-full"
            }`}
          >
            {status === "generating" ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                多智能体生成中...
              </span>
            ) : (
              "✨ 开始生成资源"
            )}
          </button>
        </div>
      </div>

      {/* ── 右侧结果展示 ── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
        {resources.length === 0 && status === "idle" && <EmptyState />}

        {(resources.length > 0 || status === "generating") && (
          <>
            {/* 资源 Tab 栏 */}
            <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-2.5 flex gap-2 overflow-x-auto">
              {selectedTypes.map((type) => {
                const resource = resources.find((r) => r.type === type);
                const taskStatus = taskStatuses[type];
                const theme = RESOURCE_THEME[type];
                const isActive = activeResource?.type === type;

                return (
                  <button
                    key={type}
                    onClick={() =>
                      resource &&
                      onWorkspaceChange((prev) => ({
                        ...prev,
                        activeResourceType: resource.type,
                      }))
                    }
                    disabled={!resource}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex-shrink-0 border ${
                      isActive
                        ? `${theme.active} text-white border-transparent shadow-sm`
                        : resource
                        ? `${theme.bg} ${theme.color} ${theme.border} hover:opacity-80`
                        : "bg-slate-100 text-slate-400 border-slate-200 cursor-wait"
                    }`}
                  >
                    <span>{RESOURCE_ICONS[type]}</span>
                    <span>{RESOURCE_LABELS[type]}</span>
                    {taskStatus === "generating" && (
                      <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {taskStatus === "done" && resource && !isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-5">
              {activeResource ? (
                <ResourceCard resource={activeResource} topic={topic} />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-slate-400">
                    <div className="text-4xl mb-3 animate-pulse-soft">⚡</div>
                    <p className="text-sm font-medium">Agent 生成中，请稍候...</p>
                    <p className="text-xs mt-1">完成后点击上方标签查看内容</p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center text-4xl shadow-inner">
          ✨
        </div>
        <h3 className="font-bold text-slate-700 text-lg mb-2">多智能体资源生成</h3>
        <p className="text-sm text-slate-500 leading-relaxed mb-5">
          输入知识主题，5 个专属 Agent 将并发为您生成
          <br />课程文档、题库、思维导图、代码案例、拓展阅读
        </p>
        <div className="flex justify-center gap-3">
          {(["document", "quiz", "mindmap", "code_example", "reading"] as ResourceType[]).map((type) => {
            const theme = RESOURCE_THEME[type];
            return (
              <div
                key={type}
                className={`w-10 h-10 rounded-xl ${theme.bg} ${theme.border} border flex items-center justify-center text-xl`}
                title={RESOURCE_LABELS[type]}
              >
                {RESOURCE_ICONS[type]}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ResourceCard({ resource, topic }: { resource: GeneratedResource; topic: string }) {
  const [copied, setCopied] = useState(false);
  const theme = RESOURCE_THEME[resource.type];

  const copy = async () => {
    await navigator.clipboard.writeText(resource.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const blob = new Blob([resource.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${topic}-${resource.label}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm animate-scale-in overflow-hidden">
      {/* 卡片头 */}
      <div className={`flex items-center justify-between px-5 py-3 border-b ${theme.border} ${theme.bg}`}>
        <div className="flex items-center gap-2">
          <span className="text-xl">{RESOURCE_ICONS[resource.type]}</span>
          <span className={`font-semibold text-sm ${theme.color}`}>{resource.label}</span>
          {topic && (
            <span className="text-xs text-slate-400">· {topic}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={copy}
            className="text-xs text-slate-500 hover:text-slate-700 transition-colors px-2 py-1 rounded-lg hover:bg-white/60"
          >
            {copied ? "✅ 已复制" : "📋 复制"}
          </button>
          <button
            onClick={download}
            className="text-xs text-slate-500 hover:text-slate-700 transition-colors px-2 py-1 rounded-lg hover:bg-white/60"
            title="下载为 .md 文件"
          >
            ⬇️ 下载
          </button>
        </div>
      </div>

      {/* 内容 */}
      <div className="p-5 overflow-y-auto max-h-[calc(100vh-230px)]">
        <div className="markdown-body text-sm text-slate-700">
          <RichContent content={resource.content} />
        </div>
      </div>
    </div>
  );
}

/** 完整 Markdown 渲染（支持代码块 + 行内格式） */
function RichContent({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          return <EnhancedCodeBlock key={i} raw={part} />;
        }
        return <TextContent key={i} text={part} />;
      })}
    </>
  );
}

function EnhancedCodeBlock({ raw }: { raw: string }) {
  const [copied, setCopied] = useState(false);
  const inner = raw.slice(3, -3);
  const newline = inner.indexOf("\n");
  const lang = newline > 0 ? inner.slice(0, newline).trim() : "";
  const code = newline > 0 ? inner.slice(newline + 1) : inner;

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-slate-700 shadow-sm">
      <div className="code-block-header">
        <span className="code-block-lang">{lang || "code"}</span>
        <button onClick={copy} className="code-copy-btn">
          {copied ? "✅ 已复制" : "📋 复制代码"}
        </button>
      </div>
      <pre className="bg-slate-900 text-slate-100 p-4 overflow-x-auto text-xs font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function TextContent({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div>
      {lines.map((line, j) => {
        if (line.startsWith("# "))
          return <h1 key={j} className="text-xl font-bold text-indigo-700 mt-4 mb-2">{renderBold(line.slice(2))}</h1>;
        if (line.startsWith("## "))
          return <h2 key={j} className="text-lg font-bold text-slate-800 mt-4 mb-2">{renderBold(line.slice(3))}</h2>;
        if (line.startsWith("### "))
          return <h3 key={j} className="text-base font-semibold text-slate-700 mt-3 mb-1.5">{renderBold(line.slice(4))}</h3>;
        if (line.startsWith("- ") || line.startsWith("* "))
          return <li key={j} className="ml-5 list-disc text-slate-700 my-0.5">{renderBold(line.slice(2))}</li>;
        if (/^\d+\. /.test(line)) {
          const m = line.match(/^(\d+)\. (.+)/);
          if (m) return <li key={j} className="ml-5 list-decimal text-slate-700 my-0.5">{renderBold(m[2])}</li>;
        }
        if (line === "---") return <hr key={j} className="border-slate-200 my-3" />;
        if (line === "") return <br key={j} />;
        return (
          <p key={j} className="my-1 leading-relaxed">
            {renderBold(line)}
          </p>
        );
      })}
    </div>
  );
}

function renderBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={i} className="font-semibold text-slate-800">{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`"))
          return <code key={i} className="bg-slate-100 px-1 py-0.5 rounded text-xs font-mono text-violet-700 border border-slate-200">{part.slice(1, -1)}</code>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
