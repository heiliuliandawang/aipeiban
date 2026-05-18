"use client";

import { useState, useEffect, useCallback } from "react";
import {
  listCourses,
  listChapters,
  getChapter,
  searchKnowledge,
  searchKnowledgeWeb,
  initKnowledge,
} from "@/lib/api";
import type {
  KnowledgeCourse,
  KnowledgeChapter,
  KnowledgeSearchResult,
  WebSearchResult,
} from "@/types";

type SearchSource = "web" | "local";

export default function KnowledgePanel() {
  const [courses, setCourses] = useState<KnowledgeCourse[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>("");
  const [chapters, setChapters] = useState<KnowledgeChapter[]>([]);
  const [activeChapter, setActiveChapter] = useState<KnowledgeChapter | null>(null);
  const [chapterContent, setChapterContent] = useState<string>("");
  const [loadingContent, setLoadingContent] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [webResults, setWebResults] = useState<WebSearchResult[]>([]);
  const [searchError, setSearchError] = useState("");
  const [searchSource, setSearchSource] = useState<SearchSource>("web");
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<"browse" | "search">("browse");

  const [initializing, setInitializing] = useState(false);
  const [initDone, setInitDone] = useState(false);

  useEffect(() => {
    listCourses().then((data) => {
      setCourses(data.courses || []);
      if (data.courses?.length > 0) {
        setSelectedCourse(data.courses[0].name);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedCourse) return;
    listChapters(selectedCourse).then((data) => {
      setChapters(data.chapters || []);
      setActiveChapter(null);
      setChapterContent("");
    });
  }, [selectedCourse]);

  const openChapter = useCallback(async (chapter: KnowledgeChapter) => {
    setActiveChapter(chapter);
    setLoadingContent(true);
    setMode("browse");
    try {
      const data = await getChapter(selectedCourse, chapter.id);
      setChapterContent(data.content || "");
    } catch {
      setChapterContent("# 加载失败\n请检查知识库是否已初始化");
    }
    setLoadingContent(false);
  }, [selectedCourse]);

  const doSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setMode("search");
    setSearchError("");
    setSearchResults([]);
    setWebResults([]);
    try {
      if (searchSource === "web") {
        const data = await searchKnowledgeWeb(searchQuery.trim());
        setWebResults(data.results || []);
      } else {
        const data = await searchKnowledge(searchQuery, selectedCourse || undefined);
        setSearchResults(data.results || []);
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "搜索失败");
    }
    setSearching(false);
  }, [searchQuery, selectedCourse, searchSource]);

  const handleInit = async () => {
    setInitializing(true);
    await initKnowledge();
    setTimeout(() => {
      setInitializing(false);
      setInitDone(true);
    }, 2000);
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* ── 左侧：课程 + 章节列表 ── */}
      <aside className="w-64 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
        {/* 课程选择 */}
        <div className="p-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-700 text-sm mb-2">学习检索</h2>
          <p className="text-[11px] text-slate-400 mb-2 leading-snug">
            本地仅含《人工智能导论》示例章节；搜其它主题请用「联网」
          </p>
          <select
            value={selectedCourse}
            onChange={(e) => setSelectedCourse(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-indigo-400 bg-slate-50"
          >
            {courses.map((c) => (
              <option key={c.name} value={c.name}>
                {c.title || c.name}
              </option>
            ))}
          </select>
          {selectedCourse && courses.find(c => c.name === selectedCourse) && (
            <p className="text-xs text-slate-400 mt-1.5">
              {courses.find(c => c.name === selectedCourse)?.chapter_count} 个章节
            </p>
          )}
        </div>

        {/* 搜索框 */}
        <div className="p-3 border-b border-slate-100">
          <div className="flex gap-1 mb-2 p-0.5 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSearchSource("web")}
              className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-colors ${
                searchSource === "web"
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              联网
            </button>
            <button
              type="button"
              onClick={() => setSearchSource("local")}
              className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-colors ${
                searchSource === "local"
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              本地课程
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder={searchSource === "web" ? "搜索全网学习资料..." : "搜索本地章节..."}
              className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-400"
            />
            <button
              onClick={doSearch}
              disabled={searching || !searchQuery.trim()}
              className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg text-xs transition-colors"
            >
              {searching ? (
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : "🔍"}
            </button>
          </div>
        </div>

        {/* 章节列表 */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-2 space-y-0.5">
            {chapters.map((ch, i) => (
              <button
                key={ch.id}
                onClick={() => openChapter(ch)}
                className={`w-full flex items-start gap-2 px-3 py-2.5 rounded-xl text-left transition-all ${
                  activeChapter?.id === ch.id && mode === "browse"
                    ? "bg-indigo-600 text-white"
                    : "hover:bg-slate-50 text-slate-700"
                }`}
              >
                <span
                  className={`flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold mt-0.5 ${
                    activeChapter?.id === ch.id && mode === "browse"
                      ? "bg-white/20 text-white"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="text-xs leading-relaxed">{ch.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 初始化按钮 */}
        <div className="p-3 border-t border-slate-100">
          <button
            onClick={handleInit}
            disabled={initializing}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all border border-slate-200 hover:border-indigo-200"
          >
            {initializing ? (
              <>
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                向量化中...
              </>
            ) : initDone ? (
              "✅ 向量索引已就绪"
            ) : (
              "⚡ 初始化向量索引"
            )}
          </button>
          <p className="text-xs text-slate-400 text-center mt-1">首次需下载嵌入模型</p>
        </div>
      </aside>

      {/* ── 右侧：内容区 ── */}
      <div className="flex-1 overflow-hidden flex flex-col bg-slate-50">
        {/* 模式切换指示 */}
        {mode === "search" && (searchResults.length > 0 || webResults.length > 0) && (
          <div className="flex-shrink-0 bg-white border-b border-slate-200 px-5 py-2.5 flex items-center gap-3">
            <span className="text-xs text-slate-500">
              🔍 「{searchQuery}」的{searchSource === "web" ? "联网" : "本地"}结果 ·{" "}
              {searchSource === "web" ? webResults.length : searchResults.length} 条
            </span>
            <button
              onClick={() => setMode("browse")}
              className="text-xs text-indigo-600 hover:text-indigo-700 ml-auto"
            >
              ← 返回浏览
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          {/* 搜索结果 */}
          {mode === "search" && (
            <div className="space-y-3">
              {searchError && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3">
                  {searchError}
                </div>
              )}
              {!searching &&
                searchSource === "web" &&
                webResults.length === 0 &&
                !searchError && (
                  <div className="text-center py-12 text-slate-400">
                    <div className="text-3xl mb-2">🌐</div>
                    <p className="text-sm">未找到联网结果，可换关键词重试</p>
                  </div>
                )}
              {!searching &&
                searchSource === "local" &&
                searchResults.length === 0 &&
                !searchError && (
                  <div className="text-center py-12 text-slate-400">
                    <div className="text-3xl mb-2">📚</div>
                    <p className="text-sm">本地库仅含《人工智能导论》章节</p>
                    <p className="text-xs mt-2">搜 Java、考研等请切换到「联网」</p>
                  </div>
                )}
              {searchSource === "web" &&
                webResults.map((result, i) => (
                  <WebSearchResultCard key={`${result.url}-${i}`} result={result} />
                ))}
              {searchSource === "local" &&
                searchResults.map((result, i) => (
                  <SearchResultCard
                    key={i}
                    result={result}
                    onOpen={() => {
                      const ch = chapters.find((c) => c.id === result.chapter_id);
                      if (ch) openChapter(ch);
                    }}
                  />
                ))}
            </div>
          )}

          {/* 浏览模式 */}
          {mode === "browse" && !activeChapter && (
            <KnowledgeEmptyState
              course={courses.find(c => c.name === selectedCourse)}
              onChapterClick={openChapter}
              chapters={chapters.slice(0, 3)}
            />
          )}

          {mode === "browse" && activeChapter && loadingContent && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center text-slate-400">
                <div className="w-10 h-10 mx-auto mb-3 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                <p className="text-sm">加载中...</p>
              </div>
            </div>
          )}

          {mode === "browse" && activeChapter && !loadingContent && chapterContent && (
            <ChapterViewer
              chapter={activeChapter}
              content={chapterContent}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function KnowledgeEmptyState({
  course,
  chapters,
  onChapterClick,
}: {
  course?: KnowledgeCourse;
  chapters: KnowledgeChapter[];
  onChapterClick: (ch: KnowledgeChapter) => void;
}) {
  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="text-center mb-8">
        <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center text-4xl shadow-inner">
          📚
        </div>
        <h2 className="text-xl font-bold text-slate-700">{course?.title || "课程知识库"}</h2>
        <p className="text-sm text-slate-400 mt-1">{course?.description || "点击左侧章节开始阅读"}</p>
      </div>

      {chapters.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wider">推荐入门章节</p>
          <div className="grid gap-3">
            {chapters.map((ch) => (
              <button
                key={ch.id}
                onClick={() => onChapterClick(ch)}
                className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 p-3 hover:border-indigo-300 hover:bg-indigo-50 transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center text-lg flex-shrink-0">
                  📖
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700 group-hover:text-indigo-700">{ch.title}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {ch.keywords?.slice(0, 3).map((kw, i) => (
                      <span key={i} className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md">{kw}</span>
                    ))}
                  </div>
                </div>
                <span className="ml-auto text-slate-300 group-hover:text-indigo-400">→</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChapterViewer({
  chapter,
  content,
}: {
  chapter: KnowledgeChapter;
  content: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-scale-in">
      {/* 章节头 */}
      <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-100 to-teal-200 flex items-center justify-center text-lg">
            📖
          </div>
          <div>
            <h3 className="font-bold text-slate-800 text-base">{chapter.title}</h3>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {chapter.keywords?.slice(0, 4).map((kw, i) => (
                <span key={i} className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded-md">
                  {kw}
                </span>
              ))}
            </div>
          </div>
        </div>
        <button
          onClick={copy}
          className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
        >
          {copied ? "✅ 已复制" : "📋 复制"}
        </button>
      </div>

      {/* Markdown 内容 */}
      <div className="p-6 overflow-y-auto max-h-[calc(100vh-250px)]">
        <MarkdownContent content={content} />
      </div>
    </div>
  );
}

function WebSearchResultCard({ result }: { result: WebSearchResult }) {
  const inner = (
    <>
      <div className={`px-4 py-3 ${result.url ? "border-b border-slate-100" : ""}`}>
        <p className="font-semibold text-indigo-700 text-sm line-clamp-2">{result.title}</p>
        {result.url ? (
          <p className="text-[11px] text-slate-400 mt-1 truncate">{result.url}</p>
        ) : (
          <p className="text-[11px] text-amber-600 mt-1">星火推荐阅读 · 请自行在平台检索</ p>
        )}
      </div>
      {result.snippet && (
        <p className="px-4 py-3 text-xs text-slate-600 leading-relaxed line-clamp-4">{result.snippet}</p>
      )}
    </>
  );

  if (!result.url) {
    return (
      <div className="block bg-white rounded-xl border border-slate-200 overflow-hidden animate-slide-in">
        {inner}
      </div>
    );
  }

  return (
    <a
      href={result.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-white rounded-xl border border-slate-200 overflow-hidden hover:border-indigo-300 hover:shadow-sm transition-all animate-slide-in"
    >
      {inner}
    </a>
  );
}

function SearchResultCard({
  result,
  onOpen,
}: {
  result: KnowledgeSearchResult;
  onOpen: () => void;
}) {
  const scoreColor =
    result.relevance_score > 0.7
      ? "text-green-600 bg-green-50 border-green-200"
      : result.relevance_score > 0.4
      ? "text-amber-600 bg-amber-50 border-amber-200"
      : "text-slate-500 bg-slate-50 border-slate-200";

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:border-indigo-200 transition-all animate-slide-in">
      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-base">📄</span>
          <span className="font-semibold text-slate-700 text-sm">{result.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${scoreColor}`}>
            相关度 {Math.round(result.relevance_score * 100)}%
          </span>
          <button
            onClick={onOpen}
            className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
          >
            查看全文 →
          </button>
        </div>
      </div>
      <div className="px-4 py-3 text-xs text-slate-600 leading-relaxed line-clamp-4">
        {result.content_preview}
      </div>
    </div>
  );
}

/** 完整 Markdown 渲染（支持代码块、表格、列表） */
function MarkdownContent({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="markdown-body text-sm">
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const inner = part.slice(3, -3);
          const nl = inner.indexOf("\n");
          const lang = nl > 0 ? inner.slice(0, nl).trim() : "";
          const code = nl > 0 ? inner.slice(nl + 1) : inner;
          return (
            <div key={i} className="my-3 rounded-xl overflow-hidden border border-slate-700">
              {lang && (
                <div className="bg-slate-800 px-3 py-1.5 text-xs font-mono text-slate-400 border-b border-slate-700">
                  {lang}
                </div>
              )}
              <pre className="bg-slate-900 text-slate-200 p-4 overflow-x-auto text-xs font-mono leading-relaxed">
                <code>{code}</code>
              </pre>
            </div>
          );
        }
        return <div key={i} dangerouslySetInnerHTML={{ __html: renderMd(part) }} />;
      })}
    </div>
  );
}

function renderMd(text: string): string {
  return text
    .replace(/^#### (.+)$/gm, '<h4 class="text-sm font-semibold text-slate-700 mt-3 mb-1">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-slate-800 mt-4 mb-1.5">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-indigo-700 mt-5 mb-2 pb-1 border-b border-indigo-100">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-slate-900 mt-4 mb-3">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-slate-800">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-slate-100 px-1 py-0.5 rounded text-xs font-mono text-violet-700 border border-slate-200">$1</code>')
    .replace(/^\> (.+)$/gm, '<blockquote class="border-l-3 border-indigo-400 pl-3 py-1 my-2 bg-indigo-50 text-slate-600 text-sm rounded-r">$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc my-0.5">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal my-0.5">$1</li>')
    .replace(/^---$/gm, '<hr class="border-slate-200 my-4" />')
    .replace(/\n\n/g, '</p><p class="my-2">')
    .replace(/\n/g, "<br/>");
}
