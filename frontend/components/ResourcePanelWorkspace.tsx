"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useResourcePanelLayout, type LeftSectionId, type RightSectionId } from "@/hooks/useResourcePanelLayout";
import type {
  GeneratedResource,
  ResourceTaskStatus,
  ResourceType,
  ResourceWorkspace,
  StudentProfile,
} from "@/types";
import { RESOURCE_LABELS, RESOURCE_ICONS } from "@/types";
import AgentFlowChart, { computeActiveAgents } from "./AgentFlowChart";
import CollapsibleSection from "./CollapsibleSection";
import ResourceCardGrid from "./ResourceCardGrid";

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

const RESOURCE_THEME: Record<ResourceType, { color: string; bg: string; border: string; active: string }> = {
  document: { color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200", active: "bg-blue-600" },
  quiz: { color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", active: "bg-emerald-600" },
  mindmap: { color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", active: "bg-amber-500" },
  code_example: { color: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200", active: "bg-violet-600" },
  reading: { color: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200", active: "bg-rose-500" },
};

interface Props {
  profile: StudentProfile;
  workspace: ResourceWorkspace;
  onWorkspaceChange: (updater: (prev: ResourceWorkspace) => ResourceWorkspace) => void;
  onStartGeneration: () => void;
  onStopGeneration: () => void;
  renderResourceCard: (resource: GeneratedResource, topic: string) => ReactNode;
  renderEmptyState: () => ReactNode;
}

export default function ResourcePanelWorkspace({
  profile,
  workspace,
  onWorkspaceChange,
  onStartGeneration,
  onStopGeneration,
  renderResourceCard,
  renderEmptyState,
}: Props) {
  const { topic, selectedTypes, status, taskStatuses, resources, activeResourceType, lastError } =
    workspace;
  const activeResource =
    resources.find((r) => r.type === activeResourceType) || resources[0] || null;

  const [topicHighlight, setTopicHighlight] = useState(false);
  const [viewMode, setViewMode] = useState<"tabs" | "grid">("tabs");

  const handleGenerateClick = () => {
    if (!topic.trim()) {
      setTopicHighlight(true);
      alert("请先在左侧「知识主题」中填写或点选推荐主题");
      return;
    }
    if (selectedTypes.length === 0) {
      alert("请至少选择一种资源类型");
      return;
    }
    setTopicHighlight(false);
    onStartGeneration();
  };

  const doneCount = Object.values(taskStatuses).filter((s) => s === "done").length;
  const totalCount = selectedTypes.length;
  const activeAgents = computeActiveAgents(taskStatuses);
  const showWorkspace =
    resources.length > 0 || status === "generating" || Boolean(lastError);
  const hasProfileHint = profile.knowledge_mastery !== undefined || profile.knowledge_level;

  const {
    layout,
    setLeftWidth,
    toggleLeftCollapsed,
    toggleSection,
    isCollapsed,
    sectionDragProps,
  } = useResourcePanelLayout();

  const visibleLeftOrder = layout.leftOrder.filter(
    (id) => id !== "progress" || (status === "generating" && totalCount > 0)
  );
  const visibleRightOrder = layout.rightOrder.filter((id) => {
    if (id === "flowchart") return status === "generating" || status === "done";
    return showWorkspace;
  });

  const resizeState = useRef({ active: false, startX: 0, startWidth: layout.leftWidth });

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeState.current = { active: true, startX: e.clientX, startWidth: layout.leftWidth };
    },
    [layout.leftWidth]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeState.current.active) return;
      setLeftWidth(resizeState.current.startWidth + (e.clientX - resizeState.current.startX));
    };
    const onUp = () => {
      resizeState.current.active = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setLeftWidth]);

  const toggleType = (type: ResourceType) => {
    onWorkspaceChange((prev) => ({
      ...prev,
      selectedTypes: prev.selectedTypes.includes(type)
        ? prev.selectedTypes.filter((t) => t !== type)
        : [...prev.selectedTypes, type],
    }));
  };

  const leftTitles: Record<LeftSectionId, string> = {
    topic: "知识主题",
    progress: "生成进度",
    types: `生成类型 (${selectedTypes.length}/${ALL_RESOURCE_TYPES.length})`,
    profile: "个性化画像",
  };

  const rightTitles: Record<RightSectionId, string> = {
    flowchart: status === "generating" ? "Agent 执行流程" : "Agent 流程（已完成）",
    tabs: "资源标签",
    content: "资源内容",
  };

  const renderLeftSection = (id: LeftSectionId) => {
    const drag = sectionDragProps(id, "left");
    if (id === "topic") {
      return (
        <CollapsibleSection
          key={id}
          id={id}
          title={leftTitles.topic}
          collapsed={isCollapsed(id)}
          onToggle={() => toggleSection(id)}
          {...drag}
        >
          <input
            type="text"
            value={topic}
            onChange={(e) => {
              setTopicHighlight(false);
              onWorkspaceChange((prev) => ({ ...prev, topic: e.target.value }));
            }}
            onKeyDown={(e) => e.key === "Enter" && handleGenerateClick()}
            placeholder="如：R语言入门（必填）"
            className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              topicHighlight
                ? "border-rose-400 ring-rose-100 bg-rose-50"
                : "border-slate-200 focus:border-indigo-400 focus:ring-indigo-100"
            }`}
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {SUGGESTED_TOPICS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onWorkspaceChange((prev) => ({ ...prev, topic: t }))}
                className="text-xs bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 px-2 py-0.5 rounded-lg"
              >
                {t}
              </button>
            ))}
          </div>
        </CollapsibleSection>
      );
    }
    if (id === "progress") {
      return (
        <CollapsibleSection
          key={id}
          id={id}
          title={leftTitles.progress}
          collapsed={isCollapsed(id)}
          onToggle={() => toggleSection(id)}
          headerExtra={
            <span className="text-xs text-indigo-600 font-bold pr-1">
              {doneCount}/{totalCount}
            </span>
          }
          {...drag}
        >
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500"
              style={{ width: `${(doneCount / totalCount) * 100}%` }}
            />
          </div>
        </CollapsibleSection>
      );
    }
    if (id === "types") {
      return (
        <CollapsibleSection
          key={id}
          id={id}
          title={leftTitles.types}
          collapsed={isCollapsed(id)}
          onToggle={() => toggleSection(id)}
          {...drag}
        >
          <div className="space-y-1.5">
            {ALL_RESOURCE_TYPES.map((type) => {
              const isSelected = selectedTypes.includes(type);
              const taskStatus = taskStatuses[type];
              const theme = RESOURCE_THEME[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  disabled={status === "generating"}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-sm ${
                    isSelected
                      ? `${theme.border} ${theme.bg} ${theme.color}`
                      : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-base">{RESOURCE_ICONS[type]}</span>
                  <span className="flex-1 text-left text-xs font-medium">{RESOURCE_LABELS[type]}</span>
                  {taskStatus === "generating" && (
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {taskStatus === "done" && <span className="text-emerald-500 font-bold text-sm">✓</span>}
                </button>
              );
            })}
          </div>
        </CollapsibleSection>
      );
    }
    if (id === "profile" && hasProfileHint) {
      return (
        <CollapsibleSection
          key={id}
          id={id}
          title={leftTitles.profile}
          collapsed={isCollapsed(id)}
          onToggle={() => toggleSection(id)}
          {...drag}
        >
          <div className="text-xs space-y-1 text-indigo-700">
            <p>
              {profile.knowledge_mastery !== undefined
                ? `掌握度 ${Math.round(profile.knowledge_mastery * 100)}%`
                : profile.knowledge_level}{" "}
              · {profile.learning_preference ?? profile.cognitive_style ?? "通用"}偏好
            </p>
            {profile.programming_experience && <p>编程经验：{profile.programming_experience}</p>}
            {profile.weak_points.length > 0 && (
              <p className="text-amber-600">⚠️ {profile.weak_points.slice(0, 2).join("、")}</p>
            )}
          </div>
        </CollapsibleSection>
      );
    }
    return null;
  };

  const renderRightSection = (id: RightSectionId) => {
    const drag = sectionDragProps(id, "right");
    if (id === "flowchart") {
      return (
        <CollapsibleSection
          key={id}
          id={id}
          title={rightTitles.flowchart}
          collapsed={isCollapsed(id)}
          onToggle={() => toggleSection(id)}
          className="flex-shrink-0 mx-2 mt-2"
          {...drag}
        >
          <AgentFlowChart
            activeAgents={activeAgents}
            taskStatuses={taskStatuses}
            isGenerating={status === "generating"}
            isComplete={status === "done"}
            selectedTypes={selectedTypes}
          />
        </CollapsibleSection>
      );
    }
    if (id === "tabs") {
      return (
        <CollapsibleSection
          key={id}
          id={id}
          title={rightTitles.tabs}
          collapsed={isCollapsed(id)}
          onToggle={() => toggleSection(id)}
          className="flex-shrink-0 mx-2 mt-2"
          {...drag}
        >
          <div className="flex gap-2 overflow-x-auto pb-1">
            {selectedTypes.map((type) => {
              const resource = resources.find((r) => r.type === type);
              const taskStatus = taskStatuses[type];
              const theme = RESOURCE_THEME[type];
              const isActive = activeResource?.type === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() =>
                    resource &&
                    onWorkspaceChange((prev) => ({ ...prev, activeResourceType: resource.type }))
                  }
                  disabled={!resource}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium flex-shrink-0 border ${
                    isActive
                      ? `${theme.active} text-white border-transparent`
                      : resource
                      ? `${theme.bg} ${theme.color} ${theme.border}`
                      : "bg-slate-100 text-slate-400 border-slate-200"
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
                </button>
              );
            })}
          </div>
        </CollapsibleSection>
      );
    }
    if (id === "content") {
      return (
        <CollapsibleSection
          key={id}
          id={id}
          title={rightTitles.content}
          collapsed={isCollapsed(id)}
          onToggle={() => toggleSection(id)}
          className="flex-1 min-h-0 mx-2 mt-2 mb-2 flex flex-col overflow-hidden"
          {...drag}
        >
          <div className="flex-1 overflow-y-auto min-h-[160px]">
            {activeResource ? (
              renderResourceCard(activeResource, topic)
            ) : (
              <div className="flex items-center justify-center py-16 text-slate-400 text-center text-sm">
                <div>
                  <p className="text-3xl mb-2">⚡</p>
                  <p>Agent 生成中，请稍候…</p>
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
      );
    }
    return null;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {status === "generating" && (
        <div className="shrink-0 bg-indigo-600 text-white text-center text-xs py-2.5 px-4 z-10 shadow-sm">
          正在生成资源（每种约 30–90 秒，请耐心等待）· 已完成 {doneCount}/{totalCount}
        </div>
      )}
      <div className="flex-1 flex overflow-hidden min-h-0">
      {layout.leftCollapsed ? (
        <div className="flex-shrink-0 flex flex-col border-r border-slate-200 bg-white w-10">
          <button
            type="button"
            onClick={toggleLeftCollapsed}
            className="flex-1 hover:bg-indigo-50 text-indigo-600 text-xs flex items-center justify-center"
            title="展开配置"
          >
            <span className="[writing-mode:vertical-rl] tracking-widest">配置</span>
          </button>
          <button
            type="button"
            onClick={() => {
              toggleLeftCollapsed();
              handleGenerateClick();
            }}
            disabled={status === "generating"}
            className="py-3 text-[10px] text-indigo-600 disabled:text-slate-300 border-t border-slate-100"
            title="展开并开始生成"
          >
            ✨
          </button>
        </div>
      ) : (
        <>
          <div
            style={{ width: layout.leftWidth }}
            className="flex-shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col min-w-[200px] max-w-[480px]"
          >
            <div className="p-3 border-b border-slate-200 bg-white flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-bold text-slate-800 text-sm">资源生成配置</h2>
                <p className="text-[10px] text-slate-400">⋮⋮ 拖拽排序 · 点击标题收起</p>
              </div>
              <button
                type="button"
                onClick={toggleLeftCollapsed}
                className="text-[10px] text-slate-500 hover:text-indigo-600 px-2 py-1 rounded hover:bg-slate-100"
              >
                收起 ◀
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {visibleLeftOrder.map((id) => renderLeftSection(id))}
            </div>
            <div className="p-3 border-t border-slate-200 bg-white space-y-2">
              {lastError && (
                <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-2 leading-relaxed">
                  {lastError}
                </p>
              )}
              <div className="flex gap-2">
              {status === "generating" && (
                <button
                  type="button"
                  onClick={onStopGeneration}
                  className="flex-1 py-2 border border-amber-300 bg-amber-50 text-amber-800 rounded-xl text-xs font-semibold"
                >
                  暂停
                </button>
              )}
              <button
                type="button"
                onClick={handleGenerateClick}
                disabled={status === "generating"}
                className={`py-2 bg-gradient-to-r from-indigo-600 to-violet-600 disabled:from-slate-300 text-white rounded-xl text-xs font-semibold cursor-pointer ${
                  status === "generating" ? "flex-1" : "w-full"
                }`}
              >
                {status === "generating" ? "生成中…" : "✨ 开始生成"}
              </button>
              </div>
            </div>
          </div>
          <div
            role="separator"
            onMouseDown={onResizeStart}
            className="w-1.5 flex-shrink-0 cursor-col-resize bg-slate-200 hover:bg-indigo-400 active:bg-indigo-500"
            title="拖拽调整左右宽度"
          />
        </>
      )}

      <div className="flex-1 flex flex-col overflow-hidden bg-slate-100 min-w-0">
        {!showWorkspace && !lastError && renderEmptyState()}
        {!showWorkspace && lastError && (
          <div className="flex-1 flex items-center justify-center p-6">
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 max-w-md text-center">
              {lastError}
            </p>
          </div>
        )}
        {showWorkspace && (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex-shrink-0 flex items-center justify-end gap-1.5 px-3 pt-2 pb-1">
              <span className="text-xs text-slate-400 mr-1">视图</span>
              <button type="button" onClick={() => setViewMode("tabs")} className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${viewMode === "tabs" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-200 hover:border-indigo-300"}`}>标签</button>
              <button type="button" onClick={() => setViewMode("grid")} className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${viewMode === "grid" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-200 hover:border-indigo-300"}`}>卡片网格</button>
            </div>
            {viewMode === "grid" ? (
              <div className="flex-1 overflow-y-auto">
                {resources.length > 0 ? (
                  <ResourceCardGrid resources={resources} topic={topic} />
                ) : (
                  <div className="flex items-center justify-center py-16 text-slate-400 text-center text-sm">
                    <div><p className="text-3xl mb-2">⚡</p><p>Agent 生成中，请稍候…</p></div>
                  </div>
                )}
              </div>
            ) : (
              visibleRightOrder.map((id) => renderRightSection(id))
            )}
        )}
      </div>
      </div>
    </div>
  );
}
