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
import ResourcePanelWorkspace from "./ResourcePanelWorkspace";

const ALL_RESOURCE_TYPES: ResourceType[] = [
  "document",
  "quiz",
  "mindmap",
  "code_example",
  "reading",
];

const SUGGESTED_TOPICS = [
  "R语言入门",
  "机器学习基础",
  "神经网络与深度学习",
  "自然语言处理",
  "卷积神经网络（CNN）",
  "大语言模型与Transformer",
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
  const stopStreamRef = useRef<(() => void) | null>(null);

  const stopGeneration = () => {
    stopStreamRef.current?.();
  };

  const startGeneration = () => {
    if (!sessionId) {
      alert("会话未就绪，请刷新页面后重试。");
      return;
    }

    const trimmedTopic = workspace.topic.trim();
    const selectedTypes = workspace.selectedTypes;

    if (!trimmedTopic) {
      alert("请先填写知识主题");
      return;
    }
    if (selectedTypes.length === 0) {
      alert("请至少选择一种资源类型");
      return;
    }

    const initStatuses: Partial<Record<ResourceType, ResourceTaskStatus>> = {};
    selectedTypes.forEach((t) => (initStatuses[t] = "waiting"));
    onWorkspaceChange((prev) => ({
      ...prev,
      topic: trimmedTopic,
      status: "generating",
      resources: [],
      activeResourceType: undefined,
      taskStatuses: initStatuses,
      lastError: undefined,
    }));

    const stop = streamGenerateResources(
      {
        session_id: sessionId,
        topic: trimmedTopic,
        resource_types: selectedTypes,
      },
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
          status: prev.resources.length > 0 ? "done" : "idle",
          lastError:
            prev.resources.length > 0
              ? undefined
              : prev.lastError || "未生成任何资源，请检查 API 配置或减少同时生成的类型数量。",
        }));
      },
      (errorMessage) => {
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
            lastError: errorMessage,
          };
        });
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

  return (
    <ResourcePanelWorkspace
      profile={profile}
      workspace={workspace}
      onWorkspaceChange={onWorkspaceChange}
      onStartGeneration={startGeneration}
      onStopGeneration={stopGeneration}
      renderEmptyState={() => <EmptyState onGenerate={startGeneration} workspace={workspace} />}
      renderResourceCard={(resource, topic) => (
        <ResourceCard resource={resource} topic={topic} />
      )}
    />
  );
}


function EmptyState({
  onGenerate,
  workspace,
}: {
  onGenerate: () => void;
  workspace: ResourceWorkspace;
}) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center text-4xl shadow-inner">
          ✨
        </div>
        <h3 className="font-bold text-slate-700 text-lg mb-2">多智能体资源生成</h3>
        <p className="text-sm text-slate-500 leading-relaxed mb-3">
          请先在左侧填写<strong>知识主题</strong>，再点生成
        </p>
        {!workspace.topic.trim() && (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-3">
            ⚠️ 未填主题时会弹窗提示
          </p>
        )}
        <button
          type="button"
          onClick={onGenerate}
          className="mb-5 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-sm"
        >
          ✨ 开始生成
        </button>
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
