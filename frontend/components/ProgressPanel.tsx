"use client";

import { useState, useEffect, useCallback } from "react";
import { getProgressSummary, markChapterComplete, recordQuizScore } from "@/lib/api";
import type { ProgressSummary, StudentProfile } from "@/types";

const CHAPTERS = [
  { id: "ch01", title: "AI概述与发展历史" },
  { id: "ch02", title: "搜索算法" },
  { id: "ch03", title: "机器学习基础" },
  { id: "ch04", title: "监督学习" },
  { id: "ch05", title: "神经网络与深度学习" },
  { id: "ch06", title: "卷积神经网络" },
  { id: "ch07", title: "自然语言处理" },
  { id: "ch08", title: "大语言模型与Transformer" },
  { id: "ch09", title: "强化学习基础" },
  { id: "ch10", title: "AI伦理与社会影响" },
];

interface Props {
  sessionId: string;
  profile: StudentProfile;
}

function getScoreColor(score: number): string {
  if (score >= 0.8) return "text-emerald-600";
  if (score >= 0.6) return "text-blue-600";
  if (score >= 0.4) return "text-amber-600";
  return "text-rose-600";
}

function getScoreBg(score: number): string {
  if (score >= 0.8) return "bg-emerald-500";
  if (score >= 0.6) return "bg-blue-500";
  if (score >= 0.4) return "bg-amber-500";
  return "bg-rose-500";
}

export default function ProgressPanel({ sessionId, profile }: Props) {
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [topic, setTopic] = useState("");
  const [score, setScore] = useState("");
  const [total, setTotal] = useState("10");
  const [submitting, setSubmitting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const data = await getProgressSummary(sessionId);
      setSummary(data);
      setCompleted(new Set(data.completed_chapters.map((c) => c.chapter_id)));
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [sessionId, load]);

  const handleMark = async (id: string) => {
    try {
      await markChapterComplete(sessionId, "人工智能导论", id);
      setCompleted((p) => new Set([...p, id]));
      void load();
    } catch {}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = parseFloat(score);
    const t = parseFloat(total);
    if (!topic || isNaN(s) || isNaN(t) || t <= 0 || s < 0 || s > t) {
      setHint("请正确填写");
      return;
    }
    setSubmitting(true);
    try {
      await recordQuizScore(sessionId, topic, s, t);
      setHint(`已记录 ${((s / t) * 100).toFixed(1)}%`);
      setScore("");
      setTopic("");
      void load();
      setTimeout(() => setHint(null), 3000);
    } catch {
      setHint("记录失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center text-2xl animate-pulse">
            📊
          </div>
          <p className="text-sm text-slate-500">加载中...</p>
        </div>
      </div>
    );
  }

  const done = CHAPTERS.filter((c) => completed.has(c.id)).length;
  const prog = done / CHAPTERS.length;
  const compAvg = summary?.comprehension_average ?? 0;
  const quizAvg = summary?.quiz_average ?? 0;

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <h2 className="text-xl font-bold text-slate-800">学习进度追踪</h2>
          <p className="text-sm text-slate-500 mt-1">章节完成、测试得分、理解度评分</p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-xs text-slate-400">章节完成</p>
            <p className={`text-2xl font-bold mt-1 ${getScoreColor(prog)}`}>
              {done}<span className="text-sm text-slate-400">/{CHAPTERS.length}</span>
            </p>
            <div className="h-1.5 bg-slate-100 rounded-full mt-2">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${prog * 100}%` }} />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-xs text-slate-400">测试平均分</p>
            <p className={`text-2xl font-bold mt-1 ${getScoreColor(quizAvg / 100)}`}>
              {quizAvg > 0 ? `${quizAvg}%` : "—"}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {(summary?.quiz_scores.length ?? 0) > 0 ? `${summary?.quiz_scores.length} 次` : "暂无"}
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-xs text-slate-400">辅导理解度</p>
            <p className={`text-2xl font-bold mt-1 ${getScoreColor(compAvg)}`}>
              {compAvg > 0 ? Math.round(compAvg * 100) : "—"}
            </p>
            <p className="text-xs text-slate-400 mt-1">{compAvg > 0 ? "分" : "暂无"}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5">
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-700 mb-3">人工智能导论</h3>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {CHAPTERS.map((ch) => {
                  const d = completed.has(ch.id);
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => !d && handleMark(ch.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition ${
                        d ? "bg-emerald-50 border border-emerald-100" : "bg-slate-50 border border-slate-100 hover:bg-indigo-50"
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${d ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400"}`}>
                        {d ? "✓" : "○"}
                      </div>
                      <span className={`text-sm flex-1 ${d ? "text-emerald-700 font-medium" : "text-slate-600"}`}>{ch.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-700 mb-3">提交练习得分</h3>
              <form onSubmit={handleSubmit} className="space-y-3">
                <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="练习主题" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-300" />
                <div className="flex gap-2">
                  <input type="number" value={score} onChange={(e) => setScore(e.target.value)} placeholder="得分" className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-300" />
                  <input type="number" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="总分" className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-300" />
                </div>
                {hint && <p className={`text-xs px-2 py-1.5 rounded-lg ${hint.includes("失败") || hint.includes("请") ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"}`}>{hint}</p>}
                <button type="submit" disabled={submitting || !topic || !score} className="w-full py-2 text-sm font-semibold bg-indigo-600 text-white rounded-xl disabled:opacity-40">
                  {submitting ? "记录中..." : "提交得分"}
                </button>
              </form>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-700 mb-3">理解度记录</h3>
              {summary && summary.comprehension_scores.length > 0 ? (
                <div className="space-y-2.5">
                  {summary.comprehension_scores.slice(0, 6).map((s, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${getScoreBg(s.score)}`} />
                      <span className="text-xs text-slate-600 flex-1 truncate">{s.topic}</span>
                      <span className={`text-xs font-semibold ${getScoreColor(s.score)}`}>{Math.round(s.score * 100)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">在智能辅导 Tab 提问后自动记录</p>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-700 mb-3">测试得分</h3>
              {summary && summary.quiz_scores.length > 0 ? (
                <div className="space-y-3 max-h-48 overflow-y-auto">
                  {summary.quiz_scores.map((s, i) => (
                    <div key={i}>
                      <div className="flex justify-between mb-1">
                        <span className="text-xs text-slate-600 truncate">{s.quiz_topic}</span>
                        <span className={`text-xs font-semibold ${getScoreColor(s.percentage / 100)}`}>{s.percentage}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full">
                        <div className={`h-full ${getScoreBg(s.percentage / 100)}`} style={{ width: `${s.percentage}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">提交得分后显示</p>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-700 mb-3">薄弱点分析</h3>
              {profile.weak_points && profile.weak_points.length > 0 ? (
                <div className="space-y-2">
                  {profile.weak_points.map((wp, i) => (
                    <div key={i} className="flex items-center gap-2.5 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                      <div className="w-2 h-2 rounded-full bg-rose-400" />
                      <span className="text-sm text-rose-700">{wp}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">完成画像构建后显示</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
