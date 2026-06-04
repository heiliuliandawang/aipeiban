"use client";

import { useCallback, useEffect, useState } from "react";

export type LeftSectionId = "topic" | "progress" | "types" | "profile";
export type RightSectionId = "flowchart" | "tabs" | "content";

export interface ResourcePanelLayout {
  leftWidth: number;
  leftCollapsed: boolean;
  leftOrder: LeftSectionId[];
  rightOrder: RightSectionId[];
  collapsed: Record<string, boolean>;
}

const STORAGE_KEY = "edumind-resource-panel-layout";

const DEFAULT_LAYOUT: ResourcePanelLayout = {
  leftWidth: 288,
  leftCollapsed: false,
  leftOrder: ["topic", "progress", "types", "profile"],
  rightOrder: ["flowchart", "tabs", "content"],
  collapsed: {
    topic: false,
    progress: false,
    types: false,
    profile: false,
    flowchart: false,
    tabs: false,
    content: false,
  },
};

function loadLayout(): ResourcePanelLayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<ResourcePanelLayout>;
    return {
      ...DEFAULT_LAYOUT,
      ...parsed,
      leftOrder: parsed.leftOrder?.length ? parsed.leftOrder : DEFAULT_LAYOUT.leftOrder,
      rightOrder: parsed.rightOrder?.length ? parsed.rightOrder : DEFAULT_LAYOUT.rightOrder,
      collapsed: { ...DEFAULT_LAYOUT.collapsed, ...parsed.collapsed },
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function reorderList<T>(list: T[], fromId: T, toId: T): T[] {
  if (fromId === toId) return list;
  const from = list.indexOf(fromId);
  const to = list.indexOf(toId);
  if (from < 0 || to < 0) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function useResourcePanelLayout() {
  const [layout, setLayout] = useState<ResourcePanelLayout>(DEFAULT_LAYOUT);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    setLayout(loadLayout());
  }, []);

  const persist = useCallback((next: ResourcePanelLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  }, []);

  const setLeftWidth = useCallback(
    (width: number) => {
      const clamped = Math.min(480, Math.max(200, width));
      persist({ ...layout, leftWidth: clamped });
    },
    [layout, persist]
  );

  const toggleLeftCollapsed = useCallback(() => {
    persist({ ...layout, leftCollapsed: !layout.leftCollapsed });
  }, [layout, persist]);

  const toggleSection = useCallback(
    (id: string) => {
      persist({
        ...layout,
        collapsed: { ...layout.collapsed, [id]: !layout.collapsed[id] },
      });
    },
    [layout, persist]
  );

  const isCollapsed = useCallback(
    (id: string) => layout.collapsed[id] ?? false,
    [layout.collapsed]
  );

  const handleDragStart = useCallback((id: string) => {
    setDraggingId(id);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (draggingId && draggingId !== targetId) {
      setDragOverId(targetId);
    }
  }, [draggingId]);

  const handleDropLeft = useCallback(
    (targetId: LeftSectionId) => {
      if (!draggingId) return;
      const from = draggingId as LeftSectionId;
      persist({
        ...layout,
        leftOrder: reorderList(layout.leftOrder, from, targetId),
      });
      handleDragEnd();
    },
    [draggingId, layout, persist, handleDragEnd]
  );

  const handleDropRight = useCallback(
    (targetId: RightSectionId) => {
      if (!draggingId) return;
      const from = draggingId as RightSectionId;
      persist({
        ...layout,
        rightOrder: reorderList(layout.rightOrder, from, targetId),
      });
      handleDragEnd();
    },
    [draggingId, layout, persist, handleDragEnd]
  );

  const sectionDragProps = useCallback(
    (id: string, side: "left" | "right") => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        handleDragStart(id);
      },
      onDragEnd: () => handleDragEnd(),
      onDragOver: (e: React.DragEvent) => handleDragOver(e, id),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (side === "left") handleDropLeft(id as LeftSectionId);
        else handleDropRight(id as RightSectionId);
      },
      isDragOver: dragOverId === id,
    }),
    [handleDragStart, handleDragEnd, handleDragOver, handleDropLeft, handleDropRight, dragOverId]
  );

  return {
    layout,
    setLeftWidth,
    toggleLeftCollapsed,
    toggleSection,
    isCollapsed,
    sectionDragProps,
    draggingId,
  };
}
