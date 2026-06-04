"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { getProfile, streamChat, streamAdjustPath } from "@/lib/api";
import { unwrapAgentContent } from "@/lib/agentResponse";
import { useChatAutoScroll } from "@/hooks/useChatAutoScroll";
import type { ChatMessage, StudentProfile } from "@/types";

const WELCOME_CONTENT =
  "你好！我是你的智能学习顾问 🎓\n\n我会通过对话了解你的学习情况，为你构建个性化学习画像，并推荐最适合你的学习资源。\n\n请先告诉我，你目前在学什么专业，或者对哪个方向最感兴趣？";

export function createWelcomeMessage(): ChatMessage {
  return {
    role: "assistant",
    content: WELCOME_CONTENT,
    timestamp: new Date(),
  };
}

const QUICK_STARTS = [
  "我是计算机专业大二学生，在学人工智能",
  "我是电子信息专业，准备考研",
  "我对机器学习很感兴趣但基础比较薄弱",
  "我在准备算法竞赛，想系统学习深度学习",
];

/** 快速反馈预设文本 */
const FEEDBACK_PRESETS = [
  "内容太难了，跟不上",
  "进度太快，想打好基础",
  "想多做几道练习题",
  "内容太简单，想快点进入正题",
  "某个知识点没听懂",
];

interface Props {
  sessionId: string;
  messages: ChatMessage[];
  onMessagesChange: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  onProfileUpdate: (profile: StudentProfile) => void;
  /** 当前学习路径正文（Markdown）；有值时显示"调整路径"按钮 */
  currentLearningPath?: string;
  /** 调整完成后通知父组件更新路径 */
  onPathAdjusted?: (newPath: string) => void;
}

export default function ChatPanel({
  sessionId,
  messages,
  onMessagesChange,
  onProfileUpdate,
  currentLearningPath,
  onPathAdjusted,
}: Props) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const composerOuterRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const manuallyStoppedRef = useRef(false);
  const showQuickStarts = messages.length === 1;

  // ── 路径调整面板状态 ──────────────────────────────────────────────────────
  const [showAdjustPanel, setShowAdjustPanel] = useState(false);
  const [adjustFeedback, setAdjustFeedback] = useState("");
  const [isAdjusting, setIsAdjusting] = useState(false);
  const adjustCleanupRef = useRef<(() => void) | null>(null);

  const lastMessage = messages[messages.length - 1];
  const { containerRef, endRef, handleScroll } = useChatAutoScroll({
    hasMessages: messages.length > 0,
    isStreaming: Boolean(isLoading && lastMessage?.role === "assistant"),
    composerHeight,
    messageCount: messages.length,
    lastMessageContent: lastMessage?.content,
  });

  useEffect(() => {
    const el = composerOuterRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setComposerHeight(Math.round(el.getBoundingClientRect().height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (cleanupRef.current) {
      manuallyStoppedRef.current = true;
      cleanupRef.current();
      cleanupRef.current = null;
    }
    adjustCleanupRef.current?.();
    adjustCleanupRef.current = null;
    setIsLoading(false);
    setIsAdjusting(false);
    setShowAdjustPanel(false);
    setAdjustFeedback("");
    setInput("");
  }, [sessionId]);

  // ── 路径调整提交 ──────────────────────────────────────────────────────────
  const submitAdjustPath = useCallback(() => {
    const feedback = adjustFeedback.trim();
    if (!feedback || isAdjusting || !sessionId) return;

    setIsAdjusting(true);
    setShowAdjustPanel(false);

    // 在对话中显示用户反馈消息和占位回复
    const userMsg: ChatMessage = {
      role: "user",
      content: `🗺️ 路径调整请求：${feedback}`,
      timestamp: new Date(),
    };
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };
    onMessagesChange((prev) => [...prev, userMsg, assistantMsg]);

    let accumulated = "";
    adjustCleanupRef.current = streamAdjustPath(
      {
        session_id: sessionId,
        feedback_text: feedback,
        current_path: currentLearningPath || "",
      },
      (chunk) => {
        accumulated += chunk;
        onMessagesChange((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: accumulated,
          };
          return updated;
        });
      },
      () => {
        adjustCleanupRef.current = null;
        setIsAdjusting(false);
        setAdjustFeedback("");
        onPathAdjusted?.(unwrapAgentContent(accumulated));
      },
      (errorMessage) => {
        onMessagesChange((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (!last || last.role !== "assistant") return prev;
          updated[updated.length - 1] = {
            ...last,
            content: last.content || `抱歉，路径调整失败。\n\n${errorMessage}`,
          };
          return updated;
        });
        adjustCleanupRef.current = null;
        setIsAdjusting(false);
      }
    );
  }, [
    adjustFeedback,
    isAdjusting,
    sessionId,
    currentLearningPath,
    onMessagesChange,
    onPathAdjusted,
  ]);

  const stopStreaming = useCallback(() => {
    if (!isLoading) return;

    manuallyStoppedRef.current = true;
    cleanupRef.current?.();
    cleanupRef.current = null;

    onMessagesChange((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (!last || last.role !== "assistant") return prev;

      const pauseHint = "已暂停当前回复，你可以继续补充或更正刚才的信息。";
      updated[updated.length - 1] = {
        ...last,
        content: last.content ? `${last.content}\n\n${pauseHint}` : pauseHint,
      };
      return updated;
    });

    setIsLoading(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isLoading, onMessagesChange]);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading || !sessionId) return;

    manuallyStoppedRef.current = false;
    setInput("");
    setIsLoading(true);

    const userMsg: ChatMessage = { role: "user", content, timestamp: new Date() };
    const assistantMsg: ChatMessage = { role: "assistant", content: "", timestamp: new Date() };
    onMessagesChange((prev) => [...prev, userMsg, assistantMsg]);

    let fullText = "";
    cleanupRef.current = streamChat(
      sessionId,
      content,
      (chunk) => {
        fullText += chunk;
        onMessagesChange((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: fullText };
          return updated;
        });
      },
      (profileData) => {
        onProfileUpdate(profileData);
      },
      async () => {
        try {
          const latestProfile = await getProfile(sessionId);
          onProfileUpdate(latestProfile);
        } catch {
          // ignore profile sync errors and keep the current UI state
        }
        cleanupRef.current = null;
        setIsLoading(false);
      },
      (errorMessage) => {
        if (manuallyStoppedRef.current) return;
        onMessagesChange((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (!last || last.role !== "assistant") return prev;
          updated[updated.length - 1] = {
            ...last,
            content: last.content || `抱歉，当前无法完成回复。\n\n${errorMessage}`,
          };
          return updated;
        });
      }
    );
  }, [input, isLoading, onMessagesChange, onProfileUpdate, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && isLoading) {
      e.preventDefault();
      stopStreaming();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* 消息列表 */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-5 space-y-4 max-w-3xl mx-auto w-full"
      >
        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            isStreaming={isLoading && i === messages.length - 1 && msg.role === "assistant"}
          />
        ))}

        {/* 快捷开始提问 */}
        {showQuickStarts && messages.length === 1 && (
          <div className="animate-fade-in">
            <p className="text-xs text-slate-400 text-center mb-2">试试这些开场白：</p>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_STARTS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  disabled={isLoading || !sessionId}
                  className="text-left text-xs bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 rounded-xl px-3 py-2.5 transition-all leading-relaxed shadow-sm disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* 输入区 */}
      <div
        ref={composerOuterRef}
        className="flex-shrink-0 border-t border-slate-200 bg-white px-4 py-3"
      >
        {/* ── 路径调整内联面板 ── */}
        {showAdjustPanel && (
          <div className="max-w-3xl mx-auto mb-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5">
                🗺️ 路径调整反馈
              </span>
              <button
                onClick={() => { setShowAdjustPanel(false); setAdjustFeedback(""); }}
                className="text-slate-400 hover:text-slate-600 text-xs transition-colors"
              >
                ✕ 取消
              </button>
            </div>

            {/* 快速预设 */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {FEEDBACK_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setAdjustFeedback(preset)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                    adjustFeedback === preset
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-100"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            {/* 自定义输入 */}
            <textarea
              value={adjustFeedback}
              onChange={(e) => setAdjustFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitAdjustPath();
                }
              }}
              placeholder="或输入自定义反馈，如「第二阶段的卷积内容太快了」..."
              rows={2}
              className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-sm text-slate-700 placeholder-slate-400 resize-none outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
            />

            <div className="flex justify-end mt-2">
              <button
                onClick={submitAdjustPath}
                disabled={!adjustFeedback.trim()}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-semibold transition-all"
              >
                提交调整
              </button>
            </div>
          </div>
        )}

        <div className="max-w-3xl mx-auto flex gap-3 items-end">
          {/* "调整路径"入口按钮 */}
          {currentLearningPath && !isLoading && !isAdjusting && !showAdjustPanel && (
            <button
              onClick={() => setShowAdjustPanel(true)}
              title="根据学习情况调整路径"
              className="flex-shrink-0 h-10 px-3 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-xl hover:bg-indigo-100 transition-all flex items-center gap-1.5 whitespace-nowrap"
            >
              🗺️ 调整路径
            </button>
          )}
          {isAdjusting && (
            <div className="flex-shrink-0 h-10 px-3 text-xs font-medium text-indigo-500 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-1.5 whitespace-nowrap">
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              路径调整中…
            </div>
          )}

          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all shadow-sm">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isLoading ? "正在回复中，可点击“暂停”后补充或更正..." : "输入消息，Enter 发送，Shift+Enter 换行..."}
              rows={2}
              disabled={!sessionId || isAdjusting}
              className="w-full bg-transparent px-4 py-3 text-sm text-slate-700 placeholder-slate-400 resize-none outline-none"
            />
          </div>
          <button
            onClick={() => {
              if (isLoading) {
                stopStreaming();
                return;
              }
              sendMessage();
            }}
            disabled={(!isLoading && !input.trim()) || !sessionId || isAdjusting}
            className={`flex-shrink-0 w-10 h-10 text-white rounded-xl flex items-center justify-center transition-all shadow-sm hover:shadow-md disabled:shadow-none ${
              isLoading
                ? "bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
                : "bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:from-slate-300 disabled:to-slate-300"
            }`}
            title={isLoading ? "暂停当前回复" : "发送消息"}
          >
            {isLoading ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
              </svg>
            )}
          </button>
        </div>
        {isLoading && (
          <p className="text-center text-xs text-amber-600 mt-2">
            正在生成回复，可点击右侧按钮或按 `Esc` 暂停，然后继续补充或更正信息
          </p>
        )}
        <p className="text-center text-xs text-slate-400 mt-2">
          由科大讯飞星火大模型驱动 · 多智能体协同 · 内容仅供学习参考
        </p>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  isStreaming,
}: {
  message: ChatMessage;
  isStreaming: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 animate-slide-in ${isUser ? "flex-row-reverse" : ""}`}>
      {/* 头像 */}
      <div
        className={`w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-sm font-bold shadow-sm ${
          isUser
            ? "bg-gradient-to-br from-indigo-500 to-indigo-600 text-white"
            : "bg-gradient-to-br from-violet-500 to-indigo-600 text-white"
        }`}
      >
        {isUser ? "我" : "AI"}
      </div>

      {/* 消息气泡 */}
      <div className={`max-w-[76%] flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
            isUser
              ? "bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-tr-sm"
              : "bg-white border border-slate-200 text-slate-700 rounded-tl-sm"
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div
              className={`markdown-body ${
                isStreaming ? "typing-cursor" : ""
              }`}
            >
              <RichMarkdown content={message.content} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 完整 Markdown 渲染：支持代码块、列表、标题、加粗、行内代码 */
function RichMarkdown({ content }: { content: string }) {
  if (!content) return null;

  // 先按代码块分割
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          return <ChatCodeBlock key={i} raw={part} />;
        }
        return <InlineContent key={i} text={part} />;
      })}
    </>
  );
}

function ChatCodeBlock({ raw }: { raw: string }) {
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
    <div className="my-2 rounded-xl overflow-hidden border border-slate-700 text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800">
        <span className="font-mono text-slate-400">{lang || "code"}</span>
        <button onClick={copy} className="text-slate-500 hover:text-slate-300 transition-colors">
          {copied ? "✅ 已复制" : "📋 复制"}
        </button>
      </div>
      <pre className="bg-slate-900 text-slate-200 p-3 overflow-x-auto font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function InlineContent({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} className="font-semibold text-slate-800 mt-3 mb-1 text-sm">
          {renderInline(line.slice(4))}
        </h3>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} className="font-bold text-slate-800 mt-4 mb-1.5">
          {renderInline(line.slice(3))}
        </h2>
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h1 key={i} className="font-bold text-indigo-700 mt-4 mb-2">
          {renderInline(line.slice(2))}
        </h1>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <li key={i} className="ml-4 list-disc my-0.5">
          {renderInline(line.slice(2))}
        </li>
      );
    } else if (/^\d+\. /.test(line)) {
      const m = line.match(/^(\d+)\. (.+)/);
      if (m) {
        elements.push(
          <li key={i} className="ml-4 list-decimal my-0.5">
            {renderInline(m[2])}
          </li>
        );
      }
    } else if (line === "---") {
      elements.push(<hr key={i} className="border-slate-200 my-2" />);
    } else if (line === "") {
      elements.push(<br key={i} />);
    } else {
      elements.push(
        <p key={i} className="leading-relaxed my-0.5">
          {renderInline(line)}
        </p>
      );
    }
  });

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={i} className="bg-slate-100 px-1 py-0.5 rounded text-xs font-mono text-violet-700 border border-slate-200">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
