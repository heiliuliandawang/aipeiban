"use client";

import type { ReactNode } from "react";

interface CollapsibleSectionProps {
  id: string;
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  /** 是否显示拖拽手柄（用于区块排序） */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  isDragOver?: boolean;
  headerExtra?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function CollapsibleSection({
  id,
  title,
  collapsed,
  onToggle,
  draggable = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragOver = false,
  headerExtra,
  children,
  className = "",
}: CollapsibleSectionProps) {
  return (
    <section
      data-section-id={id}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`rounded-xl border bg-white shadow-sm transition-colors ${
        isDragOver ? "border-indigo-400 ring-2 ring-indigo-100" : "border-slate-200"
      } ${className}`}
    >
      <div className="flex items-center gap-1 px-2 py-2 border-b border-slate-100 min-h-[36px]">
        {draggable && (
          <div
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 px-0.5 touch-none select-none"
            title="拖拽调整顺序"
            onClick={(e) => e.stopPropagation()}
          >
            ⋮⋮
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center justify-between gap-2 text-left min-w-0"
        >
          <span className="text-xs font-semibold text-slate-700 truncate">{title}</span>
          <span className="text-slate-400 text-[10px] flex-shrink-0 select-none">
            {collapsed ? "展开 ▼" : "收起 ▲"}
          </span>
        </button>
        {headerExtra}
      </div>
      {!collapsed && <div className="p-3">{children}</div>}
    </section>
  );
}
