"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ScoreBadge } from "@/components/score-badge";
import { CategoryDetection, AnalysisResult } from "@/scoring/types";
import { labelsFromContext } from "@/scoring/calculator";
import { useSSE, SSEEvent } from "@/hooks/use-sse";
import { TypeBadges } from "@/components/type-badges";

export default function RewritePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const chapterIndex = parseInt(searchParams.get("chapter") || "0", 10);

  const [originalText, setOriginalText] = useState("");
  const [rewrittenText, setRewrittenText] = useState("");
  const [originalScore, setOriginalScore] = useState<any>(null);
  const [newScore, setNewScore] = useState<any>(null);
  const [progressMsg, setProgressMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [rewriting, setRewriting] = useState(false);
  const [typeDetection, setTypeDetection] = useState<CategoryDetection | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  // 维度显示名与维度清单来自评分上下文快照，不再硬编码 7 维
  const dimensionLabels = labelsFromContext(analysis?.scoringContext ?? undefined);
  const allDimensions = analysis?.scoringContext
    ? analysis.scoringContext.dimensions.map((d) => d.key)
    : Object.keys(analysis?.overall?.scores ?? {});

  // 参数面板
  const [targetDims, setTargetDims] = useState<string[]>([]);
  const [styleHint, setStyleHint] = useState("");
  const [enableDeAI, setEnableDeAI] = useState(true);
  const [enableAdRemove, setEnableAdRemove] = useState(true);
  const [enableStyleAlign, setEnableStyleAlign] = useState(true);

  const onSSEEvent = useCallback((event: SSEEvent) => {
    if (event.event === "progress" && event.data.message) {
      setProgressMsg(event.data.message);
    }
  }, []);

  const onSSEComplete = useCallback((event: SSEEvent) => {
    setRewriting(false);
    setProgressMsg("");
    if (event.event === "complete" && event.data?.result) {
      setRewrittenText(event.data.result.content);
      setNewScore(event.data.result.scores);
    }
  }, []);

  const sse = useSSE(onSSEEvent, onSSEComplete);

  useEffect(() => {
    loadChapter();
  }, [id, chapterIndex]);

  // SSE 错误处理
  useEffect(() => {
    if (sse.error) {
      alert("改写失败: " + sse.error);
      setRewriting(false);
      setProgressMsg("");
    }
  }, [sse.error]);

  const loadChapter = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/novel/${id}`);
      const project = await res.json();

      if (project.categoryDetection) setTypeDetection(project.categoryDetection);
      if (project.analysis) setAnalysis(project.analysis);

      if (project.chapters?.[chapterIndex]) {
        setOriginalText(project.chapters[chapterIndex].content);
      }
      if (project.analysis?.chapters) {
        const score = project.analysis.chapters.find((c: any) => c.index === chapterIndex);
        if (score) {
          setOriginalScore(score);
          // 默认选中系统推荐的最弱2个维度
          setTargetDims(score.weakestDimensions || []);
        }
      }
    } catch (err: any) {
      alert("加载失败: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRewrite = () => {
    setRewriting(true);
    setProgressMsg("📂 加载中...");
    setRewrittenText("");
    setNewScore(null);

    sse.start("/api/rewrite", {
      novelId: id,
      chapterIndex,
      targetDimensions: targetDims.length > 0 ? targetDims : undefined,
      styleHint: styleHint || undefined,
      enableDeAI,
      enableAdRemove,
      enableStyleAlign,
    });
  };

  const toggleDim = (dim: string) => {
    setTargetDims((prev) =>
      prev.includes(dim) ? prev.filter((d) => d !== dim) : [...prev, dim]
    );
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">加载中...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">章节改写</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-gray-500">第 {chapterIndex + 1} 章</p>
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

      {/* 主体：左中右布局 */}
      <div className="flex gap-4 items-start">
        {/* 左侧：原文 vs 改写 */}
        <div className="flex-1 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">原文</h3>
                {originalScore && <ScoreBadge score={originalScore.weightedTotal} />}
              </div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap max-h-80 overflow-y-auto border rounded p-3 bg-gray-50">
                {originalText}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">改写版</h3>
                {newScore && <ScoreBadge score={newScore.weightedTotal} />}
              </div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap max-h-80 overflow-y-auto border rounded p-3 bg-green-50">
                {rewrittenText || (
                  <span className="text-gray-400">
                    {rewriting ? progressMsg : "调整右侧参数后点击「开始改写」"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 分数变化 */}
          {newScore && originalScore && (
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="font-semibold text-sm mb-3">分数变化</h3>
              <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
                {(Object.keys(originalScore.scores) as string[]).map((key) => {
                  const before = originalScore.scores[key]?.score;
                  const after = newScore.scores[key]?.score;
                  const diff = after - before;
                  return (
                    <div key={key} className="text-center text-xs">
                      <div className="text-gray-500 mb-1">
                        {dimensionLabels[key] || key}
                      </div>
                      <div>
                        <span>{before}</span>
                        <span className="mx-1 text-gray-400">→</span>
                        <span className={diff > 0 ? "text-green-600 font-bold" : diff < 0 ? "text-red-600" : ""}>
                          {after}
                          {diff > 0 && " ↑"}
                          {diff < 0 && " ↓"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 进度显示 */}
          {rewriting && (
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-sm text-gray-700">{progressMsg}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div className="bg-blue-500 h-2 rounded-full animate-pulse w-2/3" />
              </div>
            </div>
          )}
        </div>

        {/* 右侧：参数面板 */}
        <div className="w-72 shrink-0 bg-white rounded-xl shadow-sm border p-4 space-y-4 sticky top-4">
          <h3 className="font-bold text-sm">⚙ 改写参数</h3>

          {/* 目标维度 */}
          <div>
            <label className="text-xs text-gray-500 block mb-2">目标维度（点击选择）</label>
            <div className="flex flex-wrap gap-1.5">
              {allDimensions.map((dim) => (
                <button
                  key={dim}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    targetDims.includes(dim)
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                  }`}
                  onClick={() => toggleDim(dim)}
                >
                  {dimensionLabels[dim] || dim}
                </button>
              ))}
            </div>
          </div>

          {/* 风格提示 */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">风格提示（可选）</label>
            <textarea
              className="w-full px-3 py-2 border rounded-lg text-xs resize-none focus:ring-1 focus:ring-blue-500 outline-none"
              rows={2}
              placeholder="如：更口语化 / 增加对话 / 偏古风..."
              value={styleHint}
              onChange={(e) => setStyleHint(e.target.value)}
            />
          </div>

          {/* 去广告开关 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-700">广告/异常检测</span>
            <button
              className={`w-10 h-5 rounded-full transition-colors ${
                enableAdRemove ? "bg-blue-600" : "bg-gray-300"
              }`}
              onClick={() => setEnableAdRemove(!enableAdRemove)}
            >
              <div
                className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  enableAdRemove ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
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
              <div
                className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  enableDeAI ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
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
              <div
                className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  enableStyleAlign ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {/* Pipeline 预览 */}
          <div className="bg-gray-50 rounded-lg p-2">
            <p className="text-xs text-gray-500 mb-1">Pipeline:</p>
            <div className="flex items-center gap-1 text-xs flex-wrap">
              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">改写</span>
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

          {/* 确认按钮 */}
          <button
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
            onClick={handleRewrite}
            disabled={rewriting}
          >
            {rewriting ? "改写中..." : rewrittenText ? "重新改写" : "确认，开始改写"}
          </button>
        </div>
      </div>
    </div>
  );
}
