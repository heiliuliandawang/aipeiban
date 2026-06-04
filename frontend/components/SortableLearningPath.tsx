"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface PathItem {
  id: string;
  content: string;
  order: number;
}

interface Props {
  markdown: string;
  onReorder: (newMarkdown: string) => void;
}

export default function SortableLearningPath({ markdown, onReorder }: Props) {
  const [items, setItems] = useState<PathItem[]>(() => parseMarkdownToItems(markdown));
  const [isEdited, setIsEdited] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        const newItems = arrayMove(items, oldIndex, newIndex);
        setIsEdited(true);
        return newItems;
      });
    }
  };

  const handleSave = () => {
    const newMarkdown = itemsToMarkdown(items);
    onReorder(newMarkdown);
    setIsEdited(false);
  };

  const handleReset = () => {
    setItems(parseMarkdownToItems(markdown));
    setIsEdited(false);
  };

  return (
    <div className="space-y-3">
      {isEdited && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
          <span className="text-xs text-amber-700">已调整顺序，点击保存应用更改</span>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="text-xs px-3 py-1 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              重置
            </button>
            <button
              onClick={handleSave}
              className="text-xs px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              保存顺序
            </button>
          </div>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {items.map((item) => (
              <SortableItem key={item.id} item={item} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableItem({ item }: { item: PathItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 hover:border-indigo-300 transition-colors"
    >
      <button
        {...attributes}
        {...listeners}
        className="text-slate-400 hover:text-indigo-600 cursor-grab active:cursor-grabbing"
        title="拖拽调整顺序"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
        </svg>
      </button>
      <div className="flex-1 text-sm text-slate-700" dangerouslySetInnerHTML={{ __html: item.content }} />
    </div>
  );
}

function parseMarkdownToItems(markdown: string): PathItem[] {
  const lines = markdown.split("\n").filter((line) => line.trim());
  const items: PathItem[] = [];
  let order = 0;

  for (const line of lines) {
    if (line.match(/^#+\s+/) || line.match(/^\d+\.\s+/) || line.match(/^-\s+/)) {
      items.push({
        id: `item-${order}`,
        content: line.replace(/^#+\s+/, "<strong>").replace(/$/, "</strong>"),
        order: order++,
      });
    }
  }

  return items;
}

function itemsToMarkdown(items: PathItem[]): string {
  return items.map((item, idx) => {
    const cleaned = item.content.replace(/<\/?strong>/g, "");
    if (cleaned.match(/^\d+\.\s+/)) {
      return `${idx + 1}. ${cleaned.replace(/^\d+\.\s+/, "")}`;
    }
    return cleaned;
  }).join("\n\n");
}
