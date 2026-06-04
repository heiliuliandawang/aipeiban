"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useChatAutoScroll } from "@/hooks/useChatAutoScroll";
import {
  streamTutorAsk,
  getSuggestedQuestions,
  getTutorHistory,
  clearTutorHistory,
} from "@/lib/api";
import { downloadTutorTranscript } from "@/lib/tutorExport";
import type {
  TutorMessage,
  StudentProfile,
  TutorWorkspace,
} from "@/types";
import {
  createTutorWelcomeMessage,
  createEmptyTutorWorkspace,
} from "@/types";

const TOPICS = [
  "AI概述与发展历史",
  "机器学习基础",
  "神经网络与深度学习",
  "卷积神经网络（CNN）",
  "自然语言处理",
  "大语言模型与Transformer",
  "强化学习基础",
];

interface Props {
  sessionId: string;
  profile: StudentProfile;
  workspace: TutorWorkspace;
  onWorkspaceChange: (updater: (prev: TutorWorkspace) => TutorWorkspace) => void;
}

export default function TutorPanel({
  sessionId,
  profile,
  workspace,
  onWorkspaceChange,
}: Props) {
  const { messages, currentTopic } = workspace;
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [showTopicPicker, setShowTopicPicker] = useState(false);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const composerOuterRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);
  const loadedBackendRef = useRef<string | null>(null);

  const userMessageCount = messages.filter((m) => m.role === "user").length;

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
    stopRef.current?.();
    stopRef.current = null;
    setIsLoading(false);
    loadedBackendRef.current = null;
  }, [sessionId]);

  // 本地无用户消息时，尝试从后端恢复辅导历史
  useEffect(() => {
    if (!sessionId || userMessageCount > 0) return;
    if (loadedBackendRef.current === sessionId) return;

    let cancelled = false;
    loadedBackendRef.current = sessionId;

    getTutorHistory(sessionId)
      .then((data) => {
        if (cancelled || !data.messages?.length) return;
        onWorkspaceChange((prev) => {
          if (prev.messages.some((m) => m.role === "user")) return prev;
          return {
            ...prev,
            messages: [
              createTutorWelcomeMessage(),
              ...data.messages.map(
                (m): TutorMessage => ({
                  role: m.role,
                  content: m.content,
                  timestamp: new Date(),
                  topic: m.topic,
                })
              ),
            ],
          };
        });
      })
      .catch(() => {
        loadedBackendRef.current = null;
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, userMessageCount, onWorkspaceChange]);

  const selectTopic = useCallback(
    async (topic: string) => {
      onWorkspaceChange((prev) => ({ ...prev, currentTopic: topic }));
      setShowTopicPicker(false);
      const questions = await getSuggestedQuestions(topic);
      setSuggestedQuestions(questions);
    },
    [onWorkspaceChange]
  );

  const setMessages = useCallback(
    (updater: (prev: TutorMessage[]) => TutorMessage[]) => {
      onWorkspaceChange((prev) => ({
        ...prev,
        messages: updater(prev.messages),
      }));
    },
    [onWorkspaceChange]
  );

  const sendQuestion = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || isLoading || !sessionId) return;

      setInput("");
      setIsLoading(true);
      setSaveHint(null);

      const userMsg: TutorMessage = {
        role: "user",
        content: text,
        timestamp: new Date(),
        topic: currentTopic,
      };
      const assistantMsg: TutorMessage = {
        role: "assistant",
        content: "",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      let fullText = "";
      stopRef.current = streamTutorAsk(
        { session_id: sessionId, question: text, current_topic: currentTopic },
        (chunk) => {
          fullText += chunk;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: fullText,
            };
            return updated;
          });
        },
        () => {
          setIsLoading(false);
          stopRef.current = null;
        }
      );
    },
    [isLoading, sessionId, currentTopic, setMessages]
  );

  const handleSave = () => {
    onWorkspaceChange((prev) => ({ ...prev }));
    setSaveHint("已保存到当前学习计划");
    window.setTimeout(() => setSaveHint(null), 2500);
  };

  const handleExport = () => {
    if (userMessageCount === 0) {
      alert("暂无对话内容可导出");
      return;
    }
    downloadTutorTranscript(messages, currentTopic, sessionId);
  };

  const handleClear = async () => {
    if (!confirm("确认清空辅导对话？本地与服务器记录都将删除。")) return;
    try {
      await clearTutorHistory(sessionId);
    } catch {
      // 仍清空本地
    }
    onWorkspaceChange(() => createEmptyTutorWorkspace());
    setSuggestedQuestions([]);
    setSaveHint(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuestion(input);
    }
  };

  return (
    <div className="h-full flex overflow-hidden">
      <aside className="w-64 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-700 text-sm">智能辅导</h2>
          <p className="text-xs text-slate-400 mt-0.5">随时答疑 · 多轮追问</p>
        </div>

        <div className="p-3 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-500 mb-2">当前学习主题</p>
          <button
            type="button"
            onClick={() => setShowTopicPicker(!showTopicPicker)}
            className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 hover:bg-indigo-50 hover:border-indigo-300 transition-all"
          >
            <span>{currentTopic || "请选择主题..."}</span>
            <span className="text-slate-400">{showTopicPicker ? "▲" : "▼"}</span>
          </button>

          {showTopicPicker && (
            <div className="mt-1 bg-white border border-slate-200 rounded-lg shadow-md overflow-hidden z-10">
              {TOPICS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => selectTopic(t)}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-indigo-50 hover:text-indigo-700 ${
                    currentTopic === t
                      ? "bg-indigo-50 text-indigo-700 font-medium"
                      : "text-slate-700"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {suggestedQuestions.length > 0 && (
            <>
              <p className="text-xs font-semibold text-slate-500 mb-2">💡 推荐问题</p>
              <div className="space-y-1.5">
                {suggestedQuestions.map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => sendQuestion(q)}
                    disabled={isLoading}
                    className="w-full text-left text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100 rounded-lg px-3 py-2 leading-relaxed transition-all disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </>
          )}

          {!currentTopic && (
            <div className="text-center py-8 text-slate-400">
              <div className="text-3xl mb-2">🎯</div>
              <p className="text-xs">选择学习主题<br />获取推荐问题</p>
            </div>
          )}

          {profile.knowledge_level && (
            <div className="mt-4 bg-slate-50 rounded-lg p-3 border border-slate-100">
              <p className="text-xs font-semibold text-slate-500 mb-1">已适配你的画像</p>
              <p className="text-xs text-slate-600">
                📊 {profile.knowledge_level} · {profile.cognitive_style || "通用"}风格
              </p>
              {profile.weak_points.length > 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  ⚠️ 重点关注：{profile.weak_points.slice(0, 2).join("、")}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-slate-100 space-y-2 bg-slate-50/80">
          <p className="text-[10px] text-slate-400">
            对话 {userMessageCount} 轮 · 切换标签后自动保留
          </p>
          {saveHint && (
            <p className="text-xs text-green-600 bg-green-50 border border-green-100 rounded-lg px-2 py-1.5">
              ✅ {saveHint}
            </p>
          )}
          <button
            type="button"
            onClick={handleSave}
            className="w-full py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors"
          >
            💾 保存辅导记录
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={userMessageCount === 0}
              className="flex-1 py-1.5 text-xs border border-slate-200 bg-white hover:bg-slate-50 rounded-lg disabled:opacity-40"
            >
              ⬇️ 导出
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={userMessageCount === 0 && messages.length <= 1}
              className="flex-1 py-1.5 text-xs border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-600 rounded-lg disabled:opacity-40"
            >
              🗑️ 清空
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
        >
          {messages.map((msg, i) => (
            <TutorBubble
              key={`${msg.role}-${i}-${msg.timestamp instanceof Date ? msg.timestamp.getTime() : i}`}
              message={msg}
              isStreaming={
                isLoading && i === messages.length - 1 && msg.role === "assistant"
              }
            />
          ))}
          <div ref={endRef} />
        </div>

        <div ref={composerOuterRef} className="flex-shrink-0 border-t border-slate-200 bg-white p-4">
          {currentTopic && (
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-xs text-slate-400">当前主题：</span>
              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                {currentTopic}
              </span>
            </div>
          )}
          <div className="flex gap-3 items-end">
            <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入你的问题，Enter 发送..."
                rows={2}
                disabled={isLoading || !sessionId}
                className="w-full bg-transparent px-4 py-3 text-sm text-slate-700 placeholder-slate-400 resize-none outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => sendQuestion(input)}
              disabled={isLoading || !input.trim() || !sessionId}
              className="flex-shrink-0 w-10 h-10 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white rounded-xl flex items-center justify-center transition-colors"
            >
              {isLoading ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-center text-xs text-slate-400 mt-2">
            辅导Agent · 基于学生画像个性化答疑 · 每次回答含自查题
          </p>
        </div>
      </div>
    </div>
  );
}

function TutorBubble({
  message,
  isStreaming,
}: {
  message: TutorMessage;
  isStreaming: boolean;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex gap-3 flex-row-reverse animate-slide-in">
        <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold bg-violet-600 text-white">
          我
        </div>
        <div className="max-w-[75%] flex flex-col gap-1 items-end">
          {message.topic && (
            <span className="text-xs text-slate-400 px-1">#{message.topic}</span>
          )}
          <div className="rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed bg-violet-600 text-white">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  const [mainContent, selfCheck] = splitSelfCheck(message.content);

  return (
    <div className="flex gap-3 animate-slide-in">
      <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
        师
      </div>
      <div className="max-w-[82%] flex flex-col gap-2">
        <div
          className={`rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed bg-white border border-slate-200 shadow-sm text-slate-700 ${
            isStreaming ? "typing-cursor" : ""
          }`}
        >
          <TutorMarkdown content={mainContent} />
        </div>
        {selfCheck && !isStreaming && <SelfCheckCard content={selfCheck} />}
      </div>
    </div>
  );
}

function splitSelfCheck(content: string): [string, string] {
  const markerPatterns = [
    /\n---\n([\s\S]*💡[\s\S]*自查[\s\S]*)/,
    /\n---\n([\s\S]*自查一下[\s\S]*)/,
    /\n\n(💡\s*自查一下[\s\S]*)/,
  ];

  for (const pattern of markerPatterns) {
    const match = content.match(pattern);
    if (match) {
      const splitIndex = content.indexOf(match[0]);
      return [content.slice(0, splitIndex).trim(), match[1].trim()];
    }
  }
  return [content, ""];
}

function SelfCheckCard({ content }: { content: string }) {
  const [revealed, setRevealed] = useState(false);

  const lines = content.split("\n").filter((l) => l.trim());
  const questionLines: string[] = [];
  const answerLines: string[] = [];
  let inAnswer = false;

  for (const line of lines) {
    if (/答案|参考答案|解析/.test(line)) {
      inAnswer = true;
    }
    if (inAnswer) {
      answerLines.push(line);
    } else {
      questionLines.push(line);
    }
  }

  const question = questionLines.join("\n");
  const answer = answerLines.join("\n");

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 animate-slide-in">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-base">💡</span>
        <span className="text-xs font-semibold text-amber-700">自查一下</span>
        <span className="text-xs text-amber-500 ml-auto">验证你的理解</span>
      </div>
      <div className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
        {question || content}
      </div>
      {answer && (
        <div className="mt-2">
          {!revealed ? (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="text-xs text-amber-600 hover:text-amber-800 font-medium border border-amber-300 rounded px-2 py-0.5 transition-colors"
            >
              查看参考答案
            </button>
          ) : (
            <div className="mt-1.5 bg-white border border-amber-200 rounded-lg p-2 text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
              {answer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TutorMarkdown({ content }: { content: string }) {
  if (!content) return null;

  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const inner = part.slice(3, -3);
          const firstNewline = inner.indexOf("\n");
          const lang = firstNewline > 0 ? inner.slice(0, firstNewline).trim() : "";
          const code = firstNewline > 0 ? inner.slice(firstNewline + 1) : inner;
          return (
            <div key={i} className="my-3">
              {lang && (
                <div className="flex items-center bg-slate-700 text-slate-300 text-xs px-3 py-1 rounded-t-lg font-mono">
                  {lang}
                </div>
              )}
              <pre
                className={`bg-slate-900 text-slate-100 p-3 overflow-x-auto text-xs font-mono leading-relaxed ${
                  lang ? "rounded-b-lg" : "rounded-lg"
                }`}
              >
                <code>{code}</code>
              </pre>
            </div>
          );
        }

        const lines = part.split("\n");
        return (
          <div key={i}>
            {lines.map((line, j) => {
              if (line.startsWith("### "))
                return (
                  <h3 key={j} className="font-semibold text-slate-800 text-sm mt-3 mb-1">
                    {renderInline(line.slice(4))}
                  </h3>
                );
              if (line.startsWith("## "))
                return (
                  <h2 key={j} className="font-bold text-slate-800 mt-4 mb-1.5">
                    {renderInline(line.slice(3))}
                  </h2>
                );
              if (line.startsWith("# "))
                return (
                  <h1 key={j} className="font-bold text-indigo-700 mt-4 mb-2">
                    {renderInline(line.slice(2))}
                  </h1>
                );
              if (line.startsWith("- ") || line.startsWith("* "))
                return (
                  <li key={j} className="ml-4 list-disc my-0.5 text-slate-700">
                    {renderInline(line.slice(2))}
                  </li>
                );
              if (/^\d+\. /.test(line)) {
                const m = line.match(/^(\d+)\. (.+)/);
                if (m)
                  return (
                    <li key={j} className="ml-4 list-decimal my-0.5 text-slate-700">
                      {renderInline(m[2])}
                    </li>
                  );
              }
              if (line === "---") return <hr key={j} className="border-slate-200 my-2" />;
              if (line === "") return <br key={j} />;
              return (
                <p key={j} className="my-0.5 leading-relaxed">
                  {renderInline(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold text-slate-800">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={i} className="bg-slate-100 px-1 py-0.5 rounded text-xs font-mono text-violet-700">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
