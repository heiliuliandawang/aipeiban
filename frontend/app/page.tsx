"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearChatSession,
  createSession,
  getSessionState,
  listSessions as listBackendSessions,
  syncSessionState,
} from "@/lib/api";
import { unwrapAgentContent } from "@/lib/agentResponse";
import ProfileSidebar from "@/components/ProfileSidebar";
import ChatPanel, { createWelcomeMessage } from "@/components/ChatPanel";
import ResourcePanel from "@/components/ResourcePanel";
import TutorPanel from "@/components/TutorPanel";
import KnowledgePanel from "@/components/KnowledgePanel";
import ProgressPanel from "@/components/ProgressPanel";
import SortableLearningPath from "@/components/SortableLearningPath";
import type {
  ApiChatMessage,
  ChatMessage,
  PlannerSession,
  ResourceWorkspace,
  StudentProfile,
  TutorWorkspace,
} from "@/types";
import {
  createEmptyProfile,
  createEmptyTutorWorkspace,
  createTutorWelcomeMessage,
} from "@/types";

type ActiveTab = "chat" | "resources" | "path" | "tutor" | "knowledge" | "progress";

const STORAGE_KEY = "edumind-planner-sessions-v1";
const SESSION_ID_KEY = "edumind-session-id";

const TABS: { id: ActiveTab; label: string; icon: string; desc: string }[] = [
  { id: "chat", label: "学习对话", icon: "💬", desc: "构建个性化画像" },
  { id: "resources", label: "资源生成", icon: "✨", desc: "多智能体协同" },
  { id: "path", label: "学习路径", icon: "🗺️", desc: "智能规划顺序" },
  { id: "tutor", label: "智能辅导", icon: "🧑‍🏫", desc: "即时答疑解惑" },
  { id: "knowledge", label: "学习检索", icon: "📚", desc: "本地章节与联网搜索" },
  { id: "progress", label: "学习进度", icon: "📊", desc: "追踪章节、测试、理解度" },
];
const DEFAULT_RESOURCE_TYPES = ["document", "quiz", "mindmap", "code_example", "reading"] as const;

function trimTitle(text: string, max = 18) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function createEmptyResourceWorkspace(): ResourceWorkspace {
  return {
    topic: "",
    selectedTypes: [...DEFAULT_RESOURCE_TYPES],
    status: "idle",
    taskStatuses: {},
    resources: [],
  };
}

function buildSessionTitle(messages: ChatMessage[], fallbackIndex: number) {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim());
  if (firstUserMessage) return trimTitle(firstUserMessage.content.trim());
  return `学习计划 ${fallbackIndex}`;
}

function createPlannerSessionSnapshot(sessionId: string, fallbackIndex: number): PlannerSession {
  const now = new Date().toISOString();
  return {
    id: sessionId,
    title: `学习计划 ${fallbackIndex}`,
    isCustomTitle: false,
    customSummary: undefined,
    customTags: undefined,
    createdAt: now,
    updatedAt: now,
    profile: createEmptyProfile(sessionId),
    messages: [createWelcomeMessage()],
    learningPath: "",
    resourceWorkspace: createEmptyResourceWorkspace(),
    tutorWorkspace: createEmptyTutorWorkspace(),
  };
}

function createPlannerSessionFromBackend(
  state: Awaited<ReturnType<typeof getSessionState>>,
  fallbackIndex: number
): PlannerSession {
  const now = new Date().toISOString();
  const messages = state.messages.length
    ? state.messages.map((message) => ({
        role: message.role,
        content:
          message.role === "assistant"
            ? unwrapAgentContent(message.content)
            : message.content,
        timestamp: new Date(message.timestamp),
      }))
    : [createWelcomeMessage()];

  return {
    ...createPlannerSessionSnapshot(state.session_id, fallbackIndex),
    createdAt: now,
    updatedAt: now,
    profile: { ...createEmptyProfile(state.session_id), ...state.profile, session_id: state.session_id },
    messages,
  };
}

function sortSessions(sessions: PlannerSession[]) {
  return [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

function normalizeSessions(sessions: PlannerSession[]) {
  return sortSessions(
    sessions.map((session, index) => ({
      ...session,
      profile: { ...createEmptyProfile(session.id), ...session.profile, session_id: session.id },
      messages: session.messages.length
        ? session.messages
        : [createWelcomeMessage()],
      title: session.isCustomTitle
        ? session.title || `学习计划 ${index + 1}`
        : buildSessionTitle(session.messages, index + 1),
      customSummary: session.customSummary?.trim() || undefined,
      customTags: session.customTags?.map((tag) => tag.trim()).filter(Boolean).slice(0, 6),
      resourceWorkspace: {
        ...createEmptyResourceWorkspace(),
        ...session.resourceWorkspace,
        selectedTypes:
          session.resourceWorkspace?.selectedTypes?.length
            ? session.resourceWorkspace.selectedTypes
            : [...DEFAULT_RESOURCE_TYPES],
        taskStatuses: session.resourceWorkspace?.taskStatuses || {},
        resources: session.resourceWorkspace?.resources || [],
      },
      tutorWorkspace: session.tutorWorkspace
        ? restoreTutorWorkspace(session.tutorWorkspace)
        : createEmptyTutorWorkspace(),
    }))
  );
}

function restoreSessions(raw: unknown): PlannerSession[] {
  if (!Array.isArray(raw)) return [];

  return normalizeSessions(
    raw.map((session, index) => {
      const value = session as Partial<PlannerSession> & {
        messages?: Array<Partial<ChatMessage> & { timestamp?: string | Date }>;
      };
      return {
        id: value.id || `restored-${index}`,
        title: value.title || `学习计划 ${index + 1}`,
        isCustomTitle: value.isCustomTitle || false,
        customSummary: value.customSummary?.trim() || undefined,
        customTags: value.customTags?.map((tag) => tag.trim()).filter(Boolean).slice(0, 6),
        createdAt: value.createdAt || new Date().toISOString(),
        updatedAt: value.updatedAt || value.createdAt || new Date().toISOString(),
        profile: { ...createEmptyProfile(value.id || `restored-${index}`), ...value.profile },
        messages:
          value.messages?.map((message) => {
            const role = message.role === "user" ? "user" : "assistant";
            const raw = message.content || "";
            return {
              role,
              content: role === "assistant" ? unwrapAgentContent(raw) : raw,
              timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
            };
          }) || [createWelcomeMessage()],
        learningPath: value.learningPath || "",
        resourceWorkspace: {
          ...createEmptyResourceWorkspace(),
          ...(value.resourceWorkspace || {}),
        },
        tutorWorkspace: restoreTutorWorkspace(value.tutorWorkspace),
      };
    })
  );
}

function restoreTutorWorkspace(raw: unknown): TutorWorkspace {
  const empty = createEmptyTutorWorkspace();
  if (!raw || typeof raw !== "object") return empty;

  const value = raw as Partial<TutorWorkspace> & {
    messages?: Array<{ role?: string; content?: string; timestamp?: string; topic?: string }>;
  };

  const messages =
    value.messages?.map((msg) => ({
      role: msg.role === "user" ? ("user" as const) : ("assistant" as const),
      content: msg.content || "",
      timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
      topic: msg.topic,
    })) || empty.messages;

  return {
    messages: messages.length > 0 ? messages : [createTutorWelcomeMessage()],
    currentTopic: value.currentTopic || "",
  };
}

function buildBackendHistory(messages: ChatMessage[]): ApiChatMessage[] {
  return messages
    .slice(1)
    .filter((message) => message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function formatSessionTime(time: string) {
  return new Date(time).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildAutoSessionTags(session: PlannerSession) {
  const tags: string[] = [];

  if (session.profile.major) tags.push(session.profile.major);
  if (session.profile.learning_goal) tags.push(session.profile.learning_goal);
  if (session.profile.knowledge_level) tags.push(session.profile.knowledge_level);
  if (session.resourceWorkspace.topic) tags.push(session.resourceWorkspace.topic);
  if (session.profile.weak_points[0]) tags.push(session.profile.weak_points[0]);

  return Array.from(new Set(tags)).slice(0, 4);
}

function buildSessionTags(session: PlannerSession) {
  if (session.customTags?.length) {
    return Array.from(new Set(session.customTags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 6);
  }

  return buildAutoSessionTags(session);
}

function getSessionTagClasses(tag: string, isActive: boolean) {
  const colorPresets = {
    blue: isActive
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : "bg-blue-50 text-blue-600 border-blue-100",
    emerald: isActive
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-emerald-50 text-emerald-600 border-emerald-100",
    amber: isActive
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-amber-50 text-amber-600 border-amber-100",
    rose: isActive
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : "bg-rose-50 text-rose-600 border-rose-100",
    violet: isActive
      ? "bg-violet-50 text-violet-700 border-violet-200"
      : "bg-violet-50 text-violet-600 border-violet-100",
    slate: isActive
      ? "bg-slate-100 text-slate-700 border-slate-200"
      : "bg-slate-50 text-slate-500 border-slate-200",
    indigo: isActive
      ? "bg-indigo-50 text-indigo-700 border-indigo-200"
      : "bg-indigo-50 text-indigo-600 border-indigo-100",
  } as const;

  if (tag === "考研") return colorPresets.blue;
  if (tag === "就业") return colorPresets.emerald;
  if (tag === "竞赛") return colorPresets.amber;
  if (tag === "兴趣") return colorPresets.rose;

  if (tag === "入门") return colorPresets.emerald;
  if (tag === "初级") return colorPresets.blue;
  if (tag === "中级") return colorPresets.violet;
  if (tag === "高级") return colorPresets.amber;

  if (
    tag.includes("反爬") ||
    tag.includes("逆向") ||
    tag.includes("验证码") ||
    tag.includes("代理")
  ) {
    return colorPresets.rose;
  }

  if (
    tag.includes("机器学习") ||
    tag.includes("深度学习") ||
    tag.includes("爬虫") ||
    tag.includes("人工智能")
  ) {
    return colorPresets.indigo;
  }

  if (tag.includes("专业") || tag.includes("数据") || tag.includes("计算机")) {
    return colorPresets.violet;
  }

  return colorPresets.slate;
}

function buildAutoSessionSummary(session: PlannerSession) {
  const summaryParts: string[] = [];

  if (session.profile.major) {
    summaryParts.push(`${session.profile.major}方向`);
  }
  if (session.profile.learning_goal) {
    summaryParts.push(`目标偏向${session.profile.learning_goal}`);
  }
  if (session.resourceWorkspace.topic) {
    summaryParts.push(`正在规划「${session.resourceWorkspace.topic}」`);
  } else if (session.learningPath) {
    summaryParts.push("已生成学习路径");
  }
  if (session.resourceWorkspace.resources.length > 0) {
    summaryParts.push(`已保存${session.resourceWorkspace.resources.length}份资源`);
  }

  if (summaryParts.length > 0) {
    return summaryParts.slice(0, 3).join("，");
  }

  const firstUserMessage = session.messages.find((message) => message.role === "user" && message.content.trim());
  if (firstUserMessage) {
    return trimTitle(firstUserMessage.content.trim(), 36);
  }

  return "从这里开始新的学习规划，保存对话、资源和学习路径。";
}

function buildSessionSummary(session: PlannerSession) {
  return session.customSummary?.trim() || buildAutoSessionSummary(session);
}

function parseMetadataTags(tagsInput: string) {
  return Array.from(
    new Set(
      tagsInput
        .split(/[，,]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ).slice(0, 6);
}

export default function Home() {
  const [sessions, setSessions] = useState<PlannerSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [connected, setConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("chat");
  const [pathLoadingSessionId, setPathLoadingSessionId] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [metadataEditor, setMetadataEditor] = useState<{
    sessionId: string;
    summary: string;
    tagsInput: string;
  } | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );
  const editingSession = useMemo(
    () => (metadataEditor ? sessions.find((session) => session.id === metadataEditor.sessionId) || null : null),
    [metadataEditor, sessions]
  );
  const editingTags = useMemo(
    () => (metadataEditor ? parseMetadataTags(metadataEditor.tagsInput) : []),
    [metadataEditor]
  );

  const updateSession = useCallback(
    (sessionId: string, updater: (session: PlannerSession) => PlannerSession) => {
      setSessions((prev) =>
        normalizeSessions(
          prev.map((session) =>
            session.id === sessionId
              ? {
                  ...updater(session),
                  id: sessionId,
                  updatedAt: new Date().toISOString(),
                }
              : session
          )
        )
      );
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const storedSessionId = localStorage.getItem(SESSION_ID_KEY);
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            sessions?: unknown;
            activeSessionId?: string;
            activeTab?: ActiveTab;
          };
          const restoredSessions = restoreSessions(parsed.sessions);
          if (restoredSessions.length > 0) {
            const preferredSessionId =
              storedSessionId && restoredSessions.some((session) => session.id === storedSessionId)
                ? storedSessionId
                : parsed.activeSessionId;
            if (cancelled) return;
            setSessions(restoredSessions);
            setActiveSessionId(
              restoredSessions.some((session) => session.id === preferredSessionId)
                ? preferredSessionId || restoredSessions[0].id
                : restoredSessions[0].id
            );
            setActiveTab(parsed.activeTab || "chat");
            setConnected(true);
            return;
          }
        }

        const backendSessions = await listBackendSessions().catch(() => ({ sessions: [] }));
        if (backendSessions.sessions.length > 0) {
          const activeBackendSession =
            backendSessions.sessions.find((session) => session.session_id === storedSessionId) ||
            backendSessions.sessions[0];
          const activeState = await getSessionState(activeBackendSession.session_id);
          if (cancelled) return;

          const restoredFromBackend = normalizeSessions(
            backendSessions.sessions.map((session, index) => {
              const base = createPlannerSessionSnapshot(session.session_id, index + 1);
              const isActive = session.session_id === activeState.session_id;
              return {
                ...base,
                createdAt: session.created_at,
                updatedAt: session.last_access,
                profile: {
                  ...createEmptyProfile(session.session_id),
                  ...session.profile,
                  session_id: session.session_id,
                },
                messages: isActive
                  ? createPlannerSessionFromBackend(activeState, index + 1).messages
                  : base.messages,
              };
            })
          );

          setSessions(restoredFromBackend);
          setActiveSessionId(activeState.session_id);
          setActiveTab("chat");
          setConnected(true);
          return;
        }

        if (storedSessionId) {
          const state = await getSessionState(storedSessionId);
          if (cancelled) return;
          const restoredSession = createPlannerSessionFromBackend(state, 1);
          setSessions([restoredSession]);
          setActiveSessionId(state.session_id);
          setConnected(true);
          return;
        }

        const sessionId = await createSession();
        if (cancelled) return;
        const initialSession = createPlannerSessionSnapshot(sessionId, 1);
        setSessions([initialSession]);
        setActiveSessionId(sessionId);
        setConnected(true);
      } catch {
        if (!cancelled) setConnected(false);
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    };

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isBootstrapping) return;
    if (activeSessionId) {
      localStorage.setItem(SESSION_ID_KEY, activeSessionId);
    } else {
      localStorage.removeItem(SESSION_ID_KEY);
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessions,
        activeSessionId,
        activeTab,
      })
    );
  }, [activeSessionId, activeTab, isBootstrapping, sessions]);

  useEffect(() => {
    if (!activeSession && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSession, sessions]);

  useEffect(() => {
    if (metadataEditor && metadataEditor.sessionId !== activeSessionId) {
      setMetadataEditor(null);
    }
  }, [activeSessionId, metadataEditor]);

  useEffect(() => {
    if (isBootstrapping || !activeSession) return;

    syncSessionState({
      session_id: activeSession.id,
      profile: activeSession.profile,
      history: buildBackendHistory(activeSession.messages),
    })
      .then(() => setConnected(true))
      .catch(() => setConnected(false));
  }, [activeSessionId, isBootstrapping]);

  const createNewSession = useCallback(async () => {
    setIsCreatingSession(true);
    try {
      const sessionId = await createSession();
      const nextSession = createPlannerSessionSnapshot(sessionId, sessions.length + 1);
      setSessions((prev) => normalizeSessions([nextSession, ...prev]));
      setActiveSessionId(sessionId);
      setActiveTab("chat");
      setConnected(true);
    } catch {
      setConnected(false);
    } finally {
      setIsCreatingSession(false);
    }
  }, [sessions.length]);

  const handleResetCurrentSession = useCallback(async () => {
    if (!activeSession) return;

    try {
      await clearChatSession(activeSession.id);
    } catch {
      // ignore backend cleanup failures and still reset local snapshot
    }

    setPathLoadingSessionId((prev) => (prev === activeSession.id ? null : prev));
    setMetadataEditor((prev) => (prev?.sessionId === activeSession.id ? null : prev));
    updateSession(activeSession.id, (session) => {
      const resetSession = createPlannerSessionSnapshot(
        activeSession.id,
        sessions.findIndex((item) => item.id === activeSession.id) + 1
      );
      return {
        ...resetSession,
        title: session.title,
        isCustomTitle: session.isCustomTitle,
        customSummary: session.customSummary,
        customTags: session.customTags,
      };
    });
    setActiveTab("chat");
  }, [activeSession, sessions, updateSession]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      const target = sessions.find((session) => session.id === sessionId);
      if (!target) return;

      if (!confirm(`确认删除「${target.title}」吗？已保存的对话、画像、资源结果和学习路径都会移除。`)) {
        return;
      }

      try {
        await clearChatSession(sessionId);
      } catch {
        // ignore backend cleanup failures and still remove local snapshot
      }

      const remainingSessions = sessions.filter((session) => session.id !== sessionId);
      setPathLoadingSessionId((prev) => (prev === sessionId ? null : prev));
      setMetadataEditor((prev) => (prev?.sessionId === sessionId ? null : prev));

      if (remainingSessions.length === 0) {
        setSessions([]);
        setActiveSessionId("");
        await createNewSession();
        return;
      }

      setSessions(normalizeSessions(remainingSessions));
      if (activeSessionId === sessionId) {
        setActiveSessionId(remainingSessions[0].id);
      }
    },
    [activeSessionId, createNewSession, sessions]
  );

  const updateActiveMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      if (!activeSessionId) return;
      updateSession(activeSessionId, (session) => ({
        ...session,
        messages: updater(session.messages),
      }));
    },
    [activeSessionId, updateSession]
  );

  const updateActiveProfile = useCallback(
    (profile: StudentProfile) => {
      if (!activeSessionId) return;
      updateSession(activeSessionId, (session) => ({
        ...session,
        profile: {
          ...session.profile,
          ...profile,
          session_id: session.id,
          weak_points: profile.weak_points ?? session.profile.weak_points,
        },
      }));
    },
    [activeSessionId, updateSession]
  );

  const updateActivePath = useCallback(
    (path: string) => {
      if (!activeSessionId) return;
      const clean = unwrapAgentContent(path);
      updateSession(activeSessionId, (session) => ({
        ...session,
        learningPath: clean,
      }));
    },
    [activeSessionId, updateSession]
  );

  const updateActiveResourceWorkspace = useCallback(
    (updater: (prev: ResourceWorkspace) => ResourceWorkspace) => {
      if (!activeSessionId) return;
      updateSession(activeSessionId, (session) => ({
        ...session,
        resourceWorkspace: updater(session.resourceWorkspace),
      }));
    },
    [activeSessionId, updateSession]
  );

  const openMetadataEditor = useCallback(
    (sessionId: string) => {
      const target = sessions.find((session) => session.id === sessionId);
      if (!target) return;

      setActiveSessionId(sessionId);
      setMetadataEditor({
        sessionId,
        summary: target.customSummary ?? "",
        tagsInput: target.customTags?.join("，") ?? "",
      });
    },
    [sessions]
  );

  const handleRenameSession = useCallback(
    (sessionId: string) => {
      const target = sessions.find((session) => session.id === sessionId);
      if (!target) return;

      const renamed = prompt("请输入新的计划名称", target.title);
      if (renamed === null) return;

      const trimmed = renamed.trim();
      if (!trimmed) {
        alert("计划名称不能为空");
        return;
      }

      updateSession(sessionId, (session) => ({
        ...session,
        title: trimmed,
        isCustomTitle: true,
      }));
    },
    [sessions, updateSession]
  );

  const handleEditSessionMetadata = useCallback(
    (sessionId: string) => {
      openMetadataEditor(sessionId);
    },
    [openMetadataEditor]
  );

  const handleSaveMetadataEditor = useCallback(() => {
    if (!metadataEditor) return;

    const cleanedSummary = metadataEditor.summary.trim();
    const cleanedTags = parseMetadataTags(metadataEditor.tagsInput);

    updateSession(metadataEditor.sessionId, (session) => ({
      ...session,
      customSummary: cleanedSummary || undefined,
      customTags: cleanedTags.length > 0 ? cleanedTags : undefined,
    }));

    setMetadataEditor(null);
  }, [metadataEditor, updateSession]);

  if (isBootstrapping || !activeSession) {
    return (
      <div className="h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center text-2xl animate-pulse">
            🎓
          </div>
          <p className="text-sm text-slate-500">正在恢复你的学习计划...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <aside
        className="w-68 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden shadow-sm"
        style={{ width: "17rem" }}
      >
        <div className="relative p-4 pb-5 bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-700 overflow-hidden">
          <div className="absolute -right-4 -top-4 w-20 h-20 rounded-full bg-white/10" />
          <div className="absolute -right-1 top-6 w-10 h-10 rounded-full bg-white/10" />

          <div className="relative flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center text-xl shadow-inner">
              🎓
            </div>
            <div>
              <h1 className="text-white font-bold text-base tracking-tight leading-tight">智学引擎</h1>
              <p className="text-indigo-200 text-xs">EduMind · 个性化学习</p>
            </div>

            <div className="ml-auto flex items-center gap-1">
              <span
                className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-amber-400 animate-pulse"}`}
              />
              <span className="text-indigo-200 text-xs">{connected ? "已连接" : "连接中"}</span>
            </div>
          </div>
        </div>

        <div className="border-b border-slate-100 bg-slate-50/80">
          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500">计划会话</p>
              <p className="text-[11px] text-slate-400">保存多个学习规划，随时切换</p>
            </div>
            <button
              onClick={createNewSession}
              disabled={isCreatingSession}
              className="px-2.5 py-1 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {isCreatingSession ? "创建中..." : "+ 新建"}
            </button>
          </div>
          <div className="px-2 pb-3 max-h-52 overflow-y-auto space-y-1.5">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const summary = buildSessionSummary(session);
              const tags = buildSessionTags(session);

              return (
                <div
                  key={session.id}
                  className={`w-full text-left rounded-xl px-3 py-2 border transition-all ${
                    isActive
                      ? "bg-white border-indigo-200 shadow-sm ring-2 ring-indigo-100"
                      : "bg-white/80 border-transparent hover:border-slate-200 hover:bg-white"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => setActiveSessionId(session.id)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-medium truncate ${isActive ? "text-indigo-700" : "text-slate-700"}`}>
                          {session.title}
                        </span>
                        <span className="text-[11px] text-slate-400 flex-shrink-0">
                          {formatSessionTime(session.updatedAt)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed mt-1 line-clamp-2">
                        {summary}
                      </p>
                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className={`text-[10px] px-1.5 py-0.5 rounded-md border ${getSessionTagClasses(tag, isActive)}`}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                    <button
                      onClick={() => handleRenameSession(session.id)}
                      className="text-slate-300 hover:text-indigo-500 transition-colors px-1 py-0.5 rounded"
                      title="重命名计划"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleEditSessionMetadata(session.id)}
                      className="text-slate-300 hover:text-amber-500 transition-colors px-1 py-0.5 rounded"
                      title="编辑摘要和标签"
                    >
                      🏷
                    </button>
                    <button
                      onClick={() => {
                        void handleDeleteSession(session.id);
                      }}
                      className="text-slate-300 hover:text-rose-500 transition-colors px-1 py-0.5 rounded"
                      title="删除当前计划"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {metadataEditor && editingSession && (
            <div className="mx-2 mb-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-amber-700">编辑计划封面</p>
                  <p className="text-[11px] text-amber-600">可手动覆盖摘要和标签，留空则恢复自动生成</p>
                </div>
                <button
                  onClick={() => setMetadataEditor(null)}
                  className="text-xs text-amber-500 hover:text-amber-700 transition-colors"
                >
                  关闭
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">计划摘要</label>
                <textarea
                  value={metadataEditor.summary}
                  onChange={(event) =>
                    setMetadataEditor((prev) =>
                      prev ? { ...prev, summary: event.target.value } : prev
                    )
                  }
                  placeholder={buildAutoSessionSummary(editingSession)}
                  rows={3}
                  className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-slate-700 placeholder-slate-400 resize-none outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">计划标签</label>
                {editingTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {editingTags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[11px] text-amber-700"
                      >
                        <span>{tag}</span>
                        <button
                          onClick={() =>
                            setMetadataEditor((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    tagsInput: parseMetadataTags(prev.tagsInput)
                                      .filter((item) => item !== tag)
                                      .join("，"),
                                  }
                                : prev
                            )
                          }
                          className="text-amber-400 hover:text-rose-500 transition-colors"
                          title={`删除标签 ${tag}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  value={metadataEditor.tagsInput}
                  onChange={(event) =>
                    setMetadataEditor((prev) =>
                      prev ? { ...prev, tagsInput: event.target.value } : prev
                    )
                  }
                  placeholder={buildAutoSessionTags(editingSession).join("，")}
                  className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-slate-700 placeholder-slate-400 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                />
                <p className="text-[11px] text-slate-400 mt-1">多个标签可用中文逗号或英文逗号分隔，最多保留 6 个</p>
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() =>
                    setMetadataEditor((prev) =>
                      prev ? { ...prev, summary: "", tagsInput: "" } : prev
                    )
                  }
                  className="text-xs text-slate-500 hover:text-amber-700 transition-colors"
                >
                  恢复自动
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMetadataEditor(null)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-white transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveMetadataEditor}
                    className="px-3 py-1.5 text-xs rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          <ProfileSidebar profile={activeSession.profile} onReset={handleResetCurrentSession} />
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <nav className="bg-white border-b border-slate-200 px-2 flex items-stretch h-12 flex-shrink-0 shadow-sm">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-2 px-4 text-sm font-medium transition-all group ${
                  isActive ? "text-indigo-700" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <span className="text-base">{tab.icon}</span>
                <span>{tab.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-indigo-500 to-violet-500 rounded-t-full" />
                )}
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 bg-slate-800 text-white text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                  {tab.desc}
                </span>
              </button>
            );
          })}

          <div className="ml-auto flex items-center gap-2 pr-4">
            <div className="text-right max-w-xs">
              <div className="flex items-center justify-end gap-2">
                <span className="text-xs text-slate-500">{activeSession.title}</span>
                <button
                  onClick={() => handleRenameSession(activeSession.id)}
                  className="text-slate-400 hover:text-indigo-600 transition-colors text-xs"
                  title="重命名当前计划"
                >
                  ✎
                </button>
                <button
                  onClick={() => handleEditSessionMetadata(activeSession.id)}
                  className="text-slate-400 hover:text-amber-600 transition-colors text-xs"
                  title="编辑摘要和标签"
                >
                  🏷
                </button>
              </div>
              <p className="text-[11px] text-slate-400 truncate">{buildSessionSummary(activeSession)}</p>
            </div>
            <span className="text-xs text-slate-400 font-mono">#{activeSession.id.slice(0, 8)}</span>
          </div>
        </nav>

        <div className="flex-1 overflow-hidden bg-slate-50">
          {activeTab === "chat" && (
            <ChatPanel
              sessionId={activeSession.id}
              messages={activeSession.messages}
              onMessagesChange={updateActiveMessages}
              onProfileUpdate={updateActiveProfile}
              currentLearningPath={activeSession.learningPath}
              onPathAdjusted={updateActivePath}
            />
          )}
          {activeTab === "resources" && (
            <ResourcePanel
              sessionId={activeSession.id}
              profile={activeSession.profile}
              workspace={activeSession.resourceWorkspace}
              onWorkspaceChange={(updater) =>
                updateSession(activeSession.id, (session) => ({
                  ...session,
                  resourceWorkspace: updater(session.resourceWorkspace),
                }))
              }
            />
          )}
          {activeTab === "path" && (
            <LearningPathPanel
              sessionId={activeSession.id}
              profile={activeSession.profile}
              path={activeSession.learningPath}
              loading={pathLoadingSessionId === activeSession.id}
              onPathChange={updateActivePath}
              onLoadingChange={(loading) => setPathLoadingSessionId(loading ? activeSession.id : null)}
            />
          )}
          {activeTab === "tutor" && (
            <TutorPanel
              sessionId={activeSession.id}
              profile={activeSession.profile}
              workspace={activeSession.tutorWorkspace}
              onWorkspaceChange={(updater) =>
                updateSession(activeSession.id, (session) => ({
                  ...session,
                  tutorWorkspace: updater(session.tutorWorkspace),
                }))
              }
            />
          )}
          {activeTab === "knowledge" && <KnowledgePanel />}
          {activeTab === "progress" && (
            <ProgressPanel
              sessionId={activeSession.id}
              profile={activeSession.profile}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function LearningPathPanel({
  sessionId,
  profile,
  path,
  loading,
  onPathChange,
  onLoadingChange,
}: {
  sessionId: string;
  profile: StudentProfile;
  path: string;
  loading: boolean;
  onPathChange: (path: string) => void;
  onLoadingChange: (loading: boolean) => void;
}) {
  const cleanPath = useMemo(() => unwrapAgentContent(path), [path]);

  const generate = async () => {
    if (!profile.knowledge_level) {
      alert("请先在「学习对话」中完成画像构建");
      return;
    }
    onLoadingChange(true);
    const { getLearningPath } = await import("@/lib/api");
    try {
      const data = await getLearningPath(sessionId, profile);
      onPathChange(data.path || "");
    } finally {
      onLoadingChange(false);
    }
  };

  const exportPath = () => {
    if (!cleanPath) return;

    const blob = new Blob([cleanPath], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `learning-path-${sessionId.slice(0, 8) || "session"}-${date}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-800">个性化学习路径</h2>
          <p className="text-sm text-slate-500 mt-1">基于您的学习画像，智能规划《人工智能导论》学习顺序</p>
        </div>
        <div className="flex items-center gap-2">
          {cleanPath && (
            <>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(cleanPath);
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-500 hover:text-indigo-600 bg-white border border-slate-200 rounded-xl transition-colors shadow-sm"
              >
                📋 复制
              </button>
              <button
                onClick={exportPath}
                className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-500 hover:text-indigo-600 bg-white border border-slate-200 rounded-xl transition-colors shadow-sm"
              >
                ⬇️ 导出
              </button>
            </>
          )}
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl text-sm font-semibold hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 transition-all shadow-sm hover:shadow-md"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                规划中...
              </>
            ) : path ? (
              <>🔄 重新生成</>
            ) : (
              <>🗺️ 生成学习路径</>
            )}
          </button>
        </div>
      </div>

      {!path && !loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-xs">
            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center text-4xl shadow-inner">
              🗺️
            </div>
            <h3 className="font-semibold text-slate-700 mb-1">智能路径规划</h3>
            <p className="text-sm text-slate-400">点击按钮，路径规划 Agent 将根据您的画像生成专属学习顺序</p>
            {!profile.knowledge_level && (
              <p className="text-xs text-amber-500 mt-3 bg-amber-50 rounded-lg px-3 py-2">
                ⚠️ 建议先在「学习对话」完成画像构建，路径会更精准
              </p>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center text-3xl animate-pulse">
              🤔
            </div>
            <p className="text-sm text-slate-600 font-medium">路径规划 Agent 正在分析您的画像...</p>
            <p className="text-xs text-slate-400 mt-1">通常需要 5-10 秒</p>
          </div>
        </div>
      )}

      {cleanPath && (
        <div className="flex-1 overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-sm animate-scale-in">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-2xl">
            <div className="flex items-center gap-2">
              <span className="text-lg">🗺️</span>
              <span className="font-semibold text-slate-700">人工智能导论 · 个性化学习路径</span>
            </div>
            <span className="text-xs text-slate-400">可拖拽调整章节顺序</span>
          </div>
          <div className="p-6">
            <SortableLearningPath
              markdown={cleanPath}
              onReorder={(newMarkdown) => onPathChange(newMarkdown)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MarkdownRenderer({ content }: { content: string }) {
  const html = content
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-slate-800 mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-indigo-700 mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-slate-900 mt-4 mb-3">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-indigo-700">$1</strong>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-slate-700 my-0.5">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-slate-700 my-0.5"><span class="font-medium">$2</span></li>')
    .replace(/\n\n/g, '</p><p class="my-2">')
    .replace(/\n/g, "<br/>");

  return (
    <div
      className="markdown-body text-sm text-slate-700 leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
