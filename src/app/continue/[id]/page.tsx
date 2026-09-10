"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ScoreBadge } from "@/components/score-badge";
import { TypeBadges } from "@/components/type-badges";
import { CategoryDetection } from "@/scoring/types";
import { useSSE, SSEEvent } from "@/hooks/use-sse";

interface ChapterPlan {
  title: string;
  coreEvent: string;
  emotionalArc: string;
  keyScenes: string[];
  chapterHook: string;
}

export default function ContinuePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [plan, setPlan] = useState<ChapterPlan | null>(null);
  const [content, setContent] = useState("");
  const [score, setScore] = useState<any>(null);
  const [progressMsg, setProgressMsg] = useState("");
  const [phase, setPhase] = useState<"idle" | "planning" | "confirming" | "generating" | "done">("idle");
  const [totalChapters, setTotalChapters] = useState(0);
  const [typeDetection, setTypeDetection] = useState<CategoryDetection | null>(null);
  const [refineInput, setRefineInput] = useState("");
  const [refining, setRefining] = useState(false);

  // 参数面板
  const [enableDeAI, setEnableDeAI] = useState(true);
  const [enableAdRemove, setEnableAdRemove] = useState(true);
  const [enableStyleAlign, setEnableStyleAlign] = useState(true);
  const [styleHint, setStyleHint] = useState("");

  const onSSEEvent = useCallback((event: SSEEvent) => {
    if (event.event === "progress" && event.data.message) {
      setProgressMsg(event.data.message);
    }
  }, []);

  const onSSEComplete = useCallback((event: SSEEvent) => {
    if (event.event === "complete" && event.data?.result) {
      setContent(event.data.result.content);
      setScore(event.data.result.scores);
      setPhase("done");
    }
  }, []);

  const sse = useSSE(onSSEEvent, onSSEComplete);

  // SSE 错误处理
  useEffect(() => {
    if (sse.error) {
      alert("生成失败: " + sse.error);
      setPhase("confirming");
    }
  }, [sse.error]);

  useEffect(() => {
    loadProject();
  }, [id]);

  const loadProject = async () => {
    try {
      const res = await fetch(`/api/novel/${id}`);
      const project = await res.json();
      setTotalChapters(project.chapters?.length || 0);
      if (project.categoryDetection) setTypeDetection(project.categoryDetection);
    } catch {}
  };

  const handlePlan = async () => {
    // 每次操作前重新获取最新章节数
    await loadProject();
    setPhase("planning");
    setProgressMsg("🧠 Thinking: 正在规划章节...");

    try {
      const res = await fetch("/api/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novelId: id, afterChapter: totalChapters - 1, step: "plan" }),
      });
      const data = await res.json();

      if (data.error) {
        alert("规划失败: " + data.error);
        setPhase("idle");
      } else {
        setPlan(data.plan);
        setPhase("confirming");
      }
    } catch (err: any) {
      alert("规划失败: " + err.message);
      setPhase("idle");
    }
  };

  const handleGenerate = async () => {
    if (!plan) return;
    // 确保用最新章节数
    await loadProject();
    setPhase("generating");
    setProgressMsg("✍️ Acting: 正在生成正文...");

    sse.start("/api/continue", {
      novelId: id,
      afterChapter: totalChapters - 1,
      step: "generate",
      plan,
      enableDeAI,
      enableAdRemove,
      enableStyleAlign,
      styleHint: styleHint || undefined,
    });
  };

  const handleRefine = async () => {
    if (!refineInput.trim() || refining) return;
    setRefining(true);

    try {
      const res = await fetch("/api/write/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterContent: content,
          chapterTitle: plan?.title,
          feedback: refineInput,
        }),
      });
      const data = await res.json();

      if (data.error) {
        alert("修改失败: " + data.error);
      } else {
        setContent(data.content);
        setRefineInput("");
      }
    } catch (err: any) {
      alert("修改失败: " + err.message);
    } finally {
      setRefining(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">智能续写</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-gray-500">在现有{totalChapters}章后续写下一章</p>
            <TypeBadges detection={typeDetection} />
          </div>
        </div>
        <button
          className="text-sm text-gray-500 hover:text-blue-600"
          onClick={() => router.push(`/analysis/${id}`)}
        >
          ← 返回分析报告
        </button>
      </div>

      <div className="flex gap-4 items-start">
        {/* 左侧主体 */}
        <div className="flex-1 space-y-4">
          {/* 各阶段渲染 */}
          {phase === "idle" && (
            <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
              <div className="text-4xl mb-4">✍️</div>
              <p className="text-gray-600 mb-4">系统将基于已有内容，为你规划下一章</p>
              <button
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                onClick={handlePlan}
              >
                生成章节规划
              </button>
            </div>
          )}

          {phase === "planning" && (
            <div className="bg-white rounded-xl shadow-sm border p-8">
              <div className="text-center">
                <div className="text-4xl mb-3 animate-pulse">🧠</div>
                <h3 className="font-semibold mb-2">AI 正在规划章节</h3>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 mt-3">
                <div className="flex items-start gap-2">
                  <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded shrink-0">THINKING</span>
                  <p className="text-sm text-gray-700">{progressMsg}</p>
                </div>
              </div>
            </div>
          )}

          {phase === "confirming" && plan && (
            <div className="bg-white rounded-xl shadow-sm border p-6 space-y-3">
              <h3 className="text-lg font-bold">📋 章节规划</h3>
              <div className="space-y-2 text-sm">
                <div><span className="text-gray-500">标题：</span><span className="font-medium">{plan.title}</span></div>
                <div><span className="text-gray-500">核心事件：</span><p className="mt-0.5">{plan.coreEvent}</p></div>
                <div><span className="text-gray-500">情感节奏：</span><p className="mt-0.5">{plan.emotionalArc}</p></div>
                <div>
                  <span className="text-gray-500">关键场景：</span>
                  <ul className="mt-0.5 space-y-0.5">{plan.keyScenes.map((s, i) => <li key={i}>• {s}</li>)}</ul>
                </div>
                <div><span className="text-gray-500">章尾钩子：</span><p className="mt-0.5">{plan.chapterHook}</p></div>
              </div>
            </div>
          )}

          {phase === "generating" && (
            <div className="bg-white rounded-xl shadow-sm border p-8">
              <div className="text-center">
                <div className="text-4xl mb-3 animate-pulse">📝</div>
                <h3 className="font-semibold mb-2">AI 正在创作正文</h3>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 mt-3">
                <div className="flex items-start gap-2">
                  <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded shrink-0">ACTING</span>
                  <p className="text-sm text-gray-700">{progressMsg}</p>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-3">
                <div className="bg-orange-500 h-2 rounded-full animate-pulse w-2/3" />
              </div>
            </div>
          )}

          {phase === "done" && (
            <>
              {score && (
                <div className="bg-white rounded-xl shadow-sm border p-4 flex items-center gap-4">
                  <h3 className="font-semibold text-sm">自检评分</h3>
                  <ScoreBadge score={score.weightedTotal} />
                  <span className="text-xs text-gray-500">{score.summary}</span>
                </div>
              )}

              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div className="px-5 py-3 border-b flex items-center justify-between">
                  <h3 className="font-semibold text-sm">{plan?.title}</h3>
                  <span className="text-xs text-gray-500">{content.length}字</span>
                </div>
                <div className="px-5 py-4 max-h-80 overflow-y-auto">
                  <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{content}</div>
                </div>
                {/* 微调 */}
                <div className="border-t p-3 bg-gray-50">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 px-3 py-2 border rounded-lg text-xs"
                      placeholder="输入修改意见，如：对话太少加几段 / 结尾太平淡加反转..."
                      value={refineInput}
                      onChange={(e) => setRefineInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleRefine()}
                    />
                    <button
                      className="px-4 py-2 bg-orange-600 text-white rounded-lg text-xs hover:bg-orange-700 disabled:bg-gray-300 shrink-0"
                      onClick={handleRefine}
                      disabled={refining || !refineInput.trim()}
                    >
                      {refining ? "修改中..." : "微调"}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 右侧参数面板 */}
        <div className="w-72 shrink-0 bg-white rounded-xl shadow-sm border p-4 space-y-4 sticky top-4">
          <h3 className="font-bold text-sm">⚙ 续写参数</h3>

          {/* 去广告开关 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-700">广告/异常检测</span>
            <button
              className={`w-10 h-5 rounded-full transition-colors ${
                enableAdRemove ? "bg-blue-600" : "bg-gray-300"
              }`}
              onClick={() => setEnableAdRemove(!enableAdRemove)}
            >
              <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${
                enableAdRemove ? "translate-x-5" : "translate-x-0.5"
              }`} />
            </button>
          </div>

          {/* 去AI味开关 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-700">去AI味润色</span>
            <button
              className={`w-10 h-5 rounded-full transition-colors ${
                enableDeAI ? "bg-blue-600" : "bg-gray-300"
              }`}
              onClick={() => setEnableDeAI(!enableDeAI)}
            >
              <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${
                enableDeAI ? "translate-x-5" : "translate-x-0.5"
              }`} />
            </button>
          </div>

          {/* 风格对齐开关 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-700">风格对齐（仿原作者）</span>
            <button
              className={`w-10 h-5 rounded-full transition-colors ${
                enableStyleAlign ? "bg-blue-600" : "bg-gray-300"
              }`}
              onClick={() => setEnableStyleAlign(!enableStyleAlign)}
            >
              <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${
                enableStyleAlign ? "translate-x-5" : "translate-x-0.5"
              }`} />
            </button>
          </div>

          {/* 风格提示 */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">风格提示（可选）</label>
            <textarea
              className="w-full px-3 py-2 border rounded-lg text-xs resize-none focus:ring-1 focus:ring-blue-500 outline-none"
              rows={2}
              placeholder="如：更热血 / 偏幽默 / 增加战斗描写..."
              value={styleHint}
              onChange={(e) => setStyleHint(e.target.value)}
            />
          </div>

          {/* Pipeline 预览 */}
          <div className="bg-gray-50 rounded-lg p-2">
            <p className="text-xs text-gray-500 mb-1">Pipeline:</p>
            <div className="flex items-center gap-1 text-xs flex-wrap">
              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">生成</span>
              <span className="text-gray-400">→</span>
              {enableAdRemove && (
                <>
                  <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded">去广告</span>
                  <span className="text-gray-400">→</span>
                </>
              )}
              {enableDeAI && (
                <>
                  <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">去AI味</span>
                  <span className="text-gray-400">→</span>
                </>
              )}
              {enableStyleAlign && (
                <>
                  <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">风格对齐</span>
                  <span className="text-gray-400">→</span>
                </>
              )}
              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">打分</span>
            </div>
          </div>

          {/* 操作按钮 */}
          {phase === "idle" && (
            <button
              className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
              onClick={handlePlan}
            >
              生成章节规划
            </button>
          )}

          {phase === "confirming" && (
            <div className="space-y-2">
              <button
                className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                onClick={handleGenerate}
              >
                确认，开始生成
              </button>
              <button
                className="w-full py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                onClick={handlePlan}
              >
                重新规划
              </button>
            </div>
          )}

          {phase === "done" && (
            <div className="space-y-2">
              <button
                className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                onClick={handleGenerate}
              >
                重新生成
              </button>
              <button
                className="w-full py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                onClick={() => router.push(`/analysis/${id}`)}
              >
                返回分析报告
              </button>
            </div>
          )}

          {(phase === "planning" || phase === "generating") && (
            <div className="text-center text-xs text-gray-400">
              执行中，请稍候...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
