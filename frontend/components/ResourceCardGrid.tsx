"use client";

import { useState } from "react";
import type { GeneratedResource, ResourceType } from "@/types";
import { RESOURCE_LABELS, RESOURCE_ICONS } from "@/types";

const RESOURCE_THEME: Record<ResourceType, { color: string; bg: string; border: string }> = {
  document: { color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" },
  quiz: { color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  mindmap: { color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  code_example: { color: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200" },
  reading: { color: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200" },
};

interface Props {
  resources: GeneratedResource[];
  topic: string;
}

export default function ResourceCardGrid({ resources, topic }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4">
      {resources.map((resource) => (
        <ResourceCard key={resource.type} resource={resource} topic={topic} />
      ))}
    </div>
  );
}

function ResourceCard({ resource, topic }: { resource: GeneratedResource; topic: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const theme = RESOURCE_THEME[resource.type];

  const preview = resource.content.slice(0, 200);
  const hasMore = resource.content.length > 200;

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
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
      <div className={`flex items-center justify-between px-4 py-3 border-b ${theme.border} ${theme.bg} rounded-t-2xl`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl flex-shrink-0">{RESOURCE_ICONS[resource.type]}</span>
          <span className={`font-semibold text-sm ${theme.color} truncate`}>
            {RESOURCE_LABELS[resource.type]}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={copy}
            className="text-xs text-slate-500 hover:text-slate-700 p-1.5 rounded-lg hover:bg-white/60"
            title="复制内容"
          >
            {copied ? "✓" : "📋"}
          </button>
          <button
            onClick={download}
            className="text-xs text-slate-500 hover:text-slate-700 p-1.5 rounded-lg hover:bg-white/60"
            title="下载 Markdown"
          >
            ⬇️
          </button>
        </div>
      </div>

      <div className={`flex-1 p-4 overflow-hidden ${expanded ? "" : "max-h-64"}`}>
        <div className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
          {expanded ? resource.content : preview}
          {!expanded && hasMore && "..."}
        </div>
      </div>

      {hasMore && (
        <div className="px-4 pb-3 pt-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className={`w-full py-1.5 text-xs font-medium rounded-lg transition-colors ${theme.color} ${theme.bg} hover:opacity-80`}
          >
            {expanded ? "收起" : "展开全部"}
          </button>
        </div>
      )}
    </div>
  );
}
