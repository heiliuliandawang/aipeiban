"use client";

/**
 * AgentFlowChart — 纯 SVG 实现的 Agent 执行流程图
 *
 * 无外部依赖，使用 SVG SMIL 动画实现节点闪烁，
 * SVG filter 实现发光效果。
 *
 * 布局（横向 left-to-right）：
 *   [画像Agent] → [协调器] → [文档/题库/导图/代码/阅读 × 5] → [路径规划]
 */

import type { ResourceTaskStatus, ResourceType } from "@/types";
import { RESOURCE_LABELS } from "@/types";

// ── 公共类型 ──────────────────────────────────────────────────────────────────

export type AgentNodeStatus = "idle" | "waiting" | "active" | "done";

export interface AgentFlowChartProps {
  /**
   * 当前正在生成的 Agent 名称列表（来自 taskStatuses 的 "generating" 状态），
   * 例如 ["课程文档", "练习题库"]。用于高亮对应节点。
   */
  activeAgents: string[];
  /** 各资源任务状态，直接来自 ResourceWorkspace.taskStatuses */
  taskStatuses: Partial<Record<ResourceType, ResourceTaskStatus>>;
  /** 整体是否正在生成 */
  isGenerating: boolean;
  /** 整体是否已全部生成完成 */
  isComplete: boolean;
  /** 用户选中的资源类型（未选中的子 Agent 显示为 idle/透明） */
  selectedTypes: ResourceType[];
}

// ── SVG 几何常量 ──────────────────────────────────────────────────────────────

/** SVG 视口 */
const VW = 570;
const VH = 190;

/** 节点中心 x */
const CX = { profile: 58, coord: 190, sub: 338, path: 492 } as const;
/** 主节点 (Profile/Coord/Path) 尺寸 */
const MN = { w: 104, h: 44, r: 10 } as const;
/** 子节点 (5 个资源 Agent) 尺寸 */
const SN = { w: 96, h: 26, r: 7 } as const;
/** 主节点垂直中心（所有主节点同高） */
const MY = 95;
/** 五个子节点的垂直中心位置 */
const SUB_CYS = [20, 55, 95, 135, 170] as const;

const RESOURCE_ORDER: ResourceType[] = [
  "document",
  "quiz",
  "mindmap",
  "code_example",
  "reading",
];

/** 各资源子 Agent 的简短标签（SVG 内空间有限） */
const SUB_LABELS: Record<ResourceType, string> = {
  document: "文档",
  quiz: "题库",
  mindmap: "导图",
  code_example: "代码",
  reading: "阅读",
};

// ── 样式主题 ──────────────────────────────────────────────────────────────────

interface NodeTheme {
  fill: string;
  stroke: string;
  textFill: string;
  strokeWidth: number;
  opacity: number;
}

const THEMES: Record<AgentNodeStatus, NodeTheme> = {
  idle:    { fill: "#f8fafc", stroke: "#e2e8f0", textFill: "#cbd5e1", strokeWidth: 1,   opacity: 0.5 },
  waiting: { fill: "#f1f5f9", stroke: "#94a3b8", textFill: "#64748b", strokeWidth: 1,   opacity: 1   },
  active:  { fill: "#6366f1", stroke: "#4f46e5", textFill: "#ffffff", strokeWidth: 1.5, opacity: 1   },
  done:    { fill: "#10b981", stroke: "#059669", textFill: "#ffffff", strokeWidth: 1.5, opacity: 1   },
};

const EDGE_COLORS: Record<AgentNodeStatus, string> = {
  idle:    "#e2e8f0",
  waiting: "#cbd5e1",
  active:  "#818cf8",
  done:    "#34d399",
};

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function subStatus(
  type: ResourceType,
  taskStatuses: Partial<Record<ResourceType, ResourceTaskStatus>>,
  selectedTypes: ResourceType[]
): AgentNodeStatus {
  const ts = taskStatuses[type];
  if (ts === "generating") return "active";
  if (ts === "done") return "done";
  if (selectedTypes.includes(type)) return "waiting";
  return "idle";
}

function mainStatus(isGenerating: boolean, isComplete: boolean): AgentNodeStatus {
  if (isComplete) return "done";
  if (isGenerating) return "active";
  return "idle";
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function AgentFlowChart({
  taskStatuses,
  isGenerating,
  isComplete,
  selectedTypes,
}: AgentFlowChartProps) {
  const mStatus = mainStatus(isGenerating, isComplete);

  const subInfos = RESOURCE_ORDER.map((type, i) => ({
    type,
    cy: SUB_CYS[i],
    status: subStatus(type, taskStatuses, selectedTypes),
    label: SUB_LABELS[type],
  }));

  // 各条 coord→sub 边及 sub→path 边的颜色
  const edgeColor = (s: AgentNodeStatus) => EDGE_COLORS[s];

  // 各主边颜色（profile→coord）
  const mainEdgeColor = edgeColor(mStatus);

  // 边端点坐标（精确到节点矩形边缘）
  const pRight = CX.profile + MN.w / 2;   // 110
  const cLeft  = CX.coord   - MN.w / 2;   // 138  gap=28
  const cRight = CX.coord   + MN.w / 2;   // 242
  const sLeft  = CX.sub     - SN.w / 2;   // 290  gap=48 (for bezier)
  const sRight = CX.sub     + SN.w / 2;   // 386
  const pLeft  = CX.path    - MN.w / 2;   // 440  gap=54

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      className="w-full"
      style={{ height: "auto" }}
      aria-label="Agent 执行流程图"
    >
      <defs>
        {/* ── 发光滤镜 (active / done) ── */}
        <filter id="afc-glow-active" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feFlood floodColor="#6366f1" floodOpacity="0.55" result="c" />
          <feComposite in="c" in2="blur" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="afc-glow-done" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feFlood floodColor="#10b981" floodOpacity="0.45" result="c" />
          <feComposite in="c" in2="blur" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── 连接线 (edges) ───────────────────────────────────────────── */}

      {/* Profile → Coordinator */}
      <line
        x1={pRight} y1={MY} x2={cLeft} y2={MY}
        stroke={mainEdgeColor} strokeWidth={1.5} strokeLinecap="round"
      />

      {/* Coordinator → each sub-agent */}
      {subInfos.map(({ type, cy, status }) => (
        <path
          key={`e-cs-${type}`}
          d={`M ${cRight} ${MY} C ${cRight + 24} ${MY} ${sLeft - 24} ${cy} ${sLeft} ${cy}`}
          fill="none"
          stroke={edgeColor(status)}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}

      {/* Sub-agent → Path Agent */}
      {subInfos.map(({ type, cy, status }) => (
        <path
          key={`e-sp-${type}`}
          d={`M ${sRight} ${cy} C ${sRight + 24} ${cy} ${pLeft - 24} ${MY} ${pLeft} ${MY}`}
          fill="none"
          stroke={edgeColor(status)}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}

      {/* ── 节点 ────────────────────────────────────────────────────────── */}

      {/* Profile Agent */}
      <FlowNode
        cx={CX.profile} cy={MY} w={MN.w} h={MN.h} r={MN.r}
        label="画像Agent" status={mStatus}
      />

      {/* Coordinator */}
      <FlowNode
        cx={CX.coord} cy={MY} w={MN.w} h={MN.h} r={MN.r}
        label="协调器" status={mStatus}
      />

      {/* 五个子 Agent */}
      {subInfos.map(({ type, cy, status, label }) => (
        <FlowNode
          key={type}
          cx={CX.sub} cy={cy} w={SN.w} h={SN.h} r={SN.r}
          label={label} status={status} small
        />
      ))}

      {/* Path Planning Agent */}
      <FlowNode
        cx={CX.path} cy={MY} w={MN.w} h={MN.h} r={MN.r}
        label="路径规划" status={isComplete ? "done" : isGenerating ? "waiting" : "idle"}
      />

      {/* ── 图例 ────────────────────────────────────────────────────────── */}
      <Legend x={VW - 130} y={VH - 12} />
    </svg>
  );
}

// ── 子组件：单个节点 ──────────────────────────────────────────────────────────

interface FlowNodeProps {
  cx: number;
  cy: number;
  w: number;
  h: number;
  r: number;
  label: string;
  status: AgentNodeStatus;
  small?: boolean;
}

function FlowNode({ cx, cy, w, h, r, label, status, small = false }: FlowNodeProps) {
  const t = THEMES[status];
  const x = cx - w / 2;
  const y = cy - h / 2;
  const fontSize = small ? 9.5 : 11;
  const fontWeight = status === "idle" ? "400" : "600";
  const filter =
    status === "active" ? "url(#afc-glow-active)"
    : status === "done"   ? "url(#afc-glow-done)"
    : undefined;

  return (
    <g opacity={t.opacity} filter={filter}>
      {/* 矩形背景 */}
      <rect
        x={x} y={y} width={w} height={h}
        rx={r} ry={r}
        fill={t.fill} stroke={t.stroke} strokeWidth={t.strokeWidth}
      >
        {/* 闪烁动画（仅 active 状态） */}
        {status === "active" && (
          <animate
            attributeName="opacity"
            values="1;0.55;1"
            dur="1.3s"
            repeatCount="indefinite"
          />
        )}
      </rect>

      {/* 节点标签 */}
      <text
        x={cx} y={cy}
        textAnchor="middle" dominantBaseline="middle"
        fill={t.textFill}
        fontSize={fontSize}
        fontWeight={fontWeight}
        fontFamily="system-ui, -apple-system, sans-serif"
        style={{ userSelect: "none", pointerEvents: "none" }}
      >
        {label}
      </text>

      {/* 完成勾 */}
      {status === "done" && (
        <text
          x={x + w - 5} y={y + 5}
          textAnchor="middle" dominantBaseline="middle"
          fill="#fff" fontSize={8}
          fontFamily="system-ui, sans-serif"
          style={{ pointerEvents: "none" }}
        >
          ✓
        </text>
      )}

      {/* 生成中呼吸光圈 */}
      {status === "active" && (
        <rect
          x={x - 2} y={y - 2} width={w + 4} height={h + 4}
          rx={r + 2} ry={r + 2}
          fill="none" stroke="#818cf8" strokeWidth={1.5}
          opacity={0}
        >
          <animate
            attributeName="opacity"
            values="0;0.7;0"
            dur="1.3s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="x"
            values={`${x - 2};${x - 5};${x - 2}`}
            dur="1.3s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="y"
            values={`${y - 2};${y - 5};${y - 2}`}
            dur="1.3s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="width"
            values={`${w + 4};${w + 10};${w + 4}`}
            dur="1.3s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="height"
            values={`${h + 4};${h + 10};${h + 4}`}
            dur="1.3s"
            repeatCount="indefinite"
          />
        </rect>
      )}
    </g>
  );
}

// ── 子组件：图例 ──────────────────────────────────────────────────────────────

function Legend({ x, y }: { x: number; y: number }) {
  const items: [string, string][] = [
    ["#e2e8f0", "空闲"],
    ["#94a3b8", "等待"],
    ["#6366f1", "生成中"],
    ["#10b981", "完成"],
  ];
  return (
    <g>
      {items.map(([color, label], i) => (
        <g key={label} transform={`translate(${x + i * 34}, ${y})`}>
          <circle cx={4} cy={0} r={3.5} fill={color} />
          <text
            x={10} y={1}
            dominantBaseline="middle"
            fill="#94a3b8" fontSize={7.5}
            fontFamily="system-ui, sans-serif"
          >
            {label}
          </text>
        </g>
      ))}
    </g>
  );
}

// ── 工具函数（供 ResourcePanel 调用） ─────────────────────────────────────────

/**
 * 从 taskStatuses 计算当前 activeAgents 数组（"generating" 状态的标签列表），
 * 直接传给 AgentFlowChart 的 activeAgents prop。
 */
export function computeActiveAgents(
  taskStatuses: Partial<Record<ResourceType, ResourceTaskStatus>>
): string[] {
  return (Object.entries(taskStatuses) as [ResourceType, ResourceTaskStatus][])
    .filter(([, s]) => s === "generating")
    .map(([type]) => RESOURCE_LABELS[type]);
}
