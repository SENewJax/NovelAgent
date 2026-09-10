"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { RadarChart } from "@/components/radar-chart";
import { ScoreBadge } from "@/components/score-badge";
import { TypeBadges } from "@/components/type-badges";
import { AnalysisResult, ChapterScore } from "@/scoring/types";
import { labelsFromContext } from "@/scoring/calculator";
import { useSSE, SSEEvent } from "@/hooks/use-sse";

interface ProgressInfo {
  phase: string;
  message: string;
  current?: number;
  total?: number;
  timestamp?: number;
}

interface ProjectChapter {
  index: number;
  title: string;
  content: string;
  wordCount: number;
}

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  // 维度显示名来自分析结果的上下文快照而非硬编码常量，维度可配置后常量必然过期
  const dimensionLabels = labelsFromContext(analysis?.scoringContext ?? undefined);
  const [chapters, setChapters] = useState<ProjectChapter[]>([]);
  const [projectName, setProjectName] = useState<string>("");
  const [progress, setProgress] = useState<ProgressInfo>({ phase: "idle", message: "准备中..." });
  const [scoreLog, setScoreLog] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisDraft, setAnalysisDraft] = useState<{
    hasGlobal: boolean;
    hasCategoryDetection: boolean;
    scoredCount: number;
    totalChapters: number;
    startedAt: string;
    updatedAt: string;
  } | null>(null);

  const onSSEEvent = useCallback((event: SSEEvent) => {
    if (event.event === "progress") {
      setProgress(event.data);
      if (event.data.phase === "scoring" && event.data.message?.startsWith("✓")) {
        setScoreLog((prev) => [...prev.slice(-20), event.data.message]);
      }
    }
  }, []);

  const onSSEComplete = useCallback((event: SSEEvent) => {
    setAnalyzing(false);
    if (event.event === "complete" && event.data?.result) {
      setAnalysis(event.data.result);
    }
  }, []);

  const sse = useSSE(onSSEEvent, onSSEComplete);

  useEffect(() => {
    loadExisting();
  }, [id]);

  // SSE 错误同步
  useEffect(() => {
    if (sse.error) {
      setError(sse.error);
      setAnalyzing(false);
    }
  }, [sse.error]);

  const loadExisting = async () => {
    try {
      const res = await fetch(`/api/novel/${id}`);
      const project = await res.json();

      // 保存项目名（文件名）
      if (project.name) {
        setProjectName(project.name);
      }

      // 始终加载全部章节（包含续写/改写）
      if (project.chapters) {
        setChapters(project.chapters);
      }

      if (project.analysis) {
        // 已有分析结果：优先展示报告。若有草稿（partial 失败的章节待补分）则保留它，
        // 用于报告顶部的「继续分析补分」提示；无草稿则清空历史残留。
        setAnalysis(project.analysis);
        setError(null);
        setAnalysisDraft(project.analysisDraft || null);
        return;
      }

      // 检查是否有分析草稿（断点续跑）
      if (project.analysisDraft) {
        setAnalysisDraft(project.analysisDraft);
        return; // 不自动开始，等用户选择继续或重来
      }

      // 没有结果，也没有草稿，开始分析
      startAnalysis();
    } catch {
      // 网络错误时重试加载，不自动开始分析（避免误触发全量重跑）
      setError("网络连接失败，请检查网络后刷新页面");
    }
  };

  const startAnalysis = (resume: boolean = false) => {
    setAnalyzing(true);
    setError(null);
    setAnalysisDraft(null);
    setProgress({ phase: "start", message: resume ? "🔄 从断点恢复分析..." : "🚀 正在启动分析引擎..." });
    setScoreLog([]);
    sse.start("/api/analysis", { novelId: id, resume });
  };

  const handleReanalyze = async () => {
    if (!confirm("确定清除已有分析结果与型判定并重新分析吗？（原文和章节内容不受影响）")) return;
    try {
      await fetch(`/api/novel/${id}`, { method: "DELETE" });
      setAnalysis(null);
      setScoreLog([]);
      startAnalysis();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // 已有完整分析结果时不再显示「分析中断」—— 报告优先，中断框只在无结果时出现。
  if (error && !analysis) {
    const canResume = !!analysisDraft || error.includes("中断") || error.includes("quota") || error.includes("Failed") || error.includes("网络") || error.includes("timeout") || error.includes("超时") || error.includes("进度已保存") || error.includes("评分失败") || error.includes("继续分析");
    return (
      <div className="bg-white rounded-xl shadow-sm border border-red-200 p-8 text-center">
        <div className="text-4xl mb-4">❌</div>
        <h2 className="text-xl font-bold text-red-600 mb-2">分析中断</h2>
        <p className="text-gray-600 mb-4 whitespace-pre-wrap">{error}</p>
        <p className="text-sm text-gray-400 mb-4">已完成的分析进度已自动保存，无需重来。</p>
        <div className="flex justify-center gap-3">
          {canResume && (
            <button
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              onClick={() => { setError(null); startAnalysis(true); }}
            >
              🔄 继续分析（断点续跑）
            </button>
          )}
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            onClick={() => { setError(null); startAnalysis(false); }}
          >
            重新开始
          </button>
        </div>
      </div>
    );
  }

  // 断点续跑提示：检测到草稿，等用户选择。已有分析结果时优先显示报告，不拦截。
  if (analysisDraft && !analyzing && !analysis) {
    const pct = analysisDraft.totalChapters > 0
      ? Math.round((analysisDraft.scoredCount / analysisDraft.totalChapters) * 100)
      : 0;
    return (
      <div className="bg-white rounded-xl shadow-sm border border-amber-200 p-8 text-center">
        <div className="text-4xl mb-4">⚡</div>
        <h2 className="text-xl font-bold text-amber-600 mb-2">分析进度已保存</h2>
        <p className="text-gray-600 mb-1">上次分析中断，已完成的部分可以继续，无需重来。</p>
        <div className="bg-gray-50 rounded-lg p-4 my-4 max-w-md mx-auto">
          <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
            <span>章节评分进度</span>
            <span className="font-medium">{analysisDraft.scoredCount} / {analysisDraft.totalChapters} 章</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div className="bg-green-500 h-3 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
            {analysisDraft.hasGlobal && <span>✓ 全局分析</span>}
            {analysisDraft.hasCategoryDetection && <span>✓ 分类判定</span>}
            <span>中断于 {new Date(analysisDraft.updatedAt).toLocaleString("zh-CN")}</span>
          </div>
        </div>
        <div className="flex justify-center gap-3">
          <button
            className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
            onClick={() => startAnalysis(true)}
          >
            🔄 继续分析
          </button>
          <button
            className="px-6 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
            onClick={async () => {
              if (!confirm("确定丢弃已有进度，从头重新分析吗？")) return;
              await fetch(`/api/novel/${id}`, { method: "DELETE" });
              setAnalysisDraft(null);
              startAnalysis(false);
            }}
          >
            丢弃重来
          </button>
        </div>
      </div>
    );
  }

  if (analyzing) {
    const isScoring = progress.phase === "scoring";
    const pct = progress.total ? Math.round((progress.current! / progress.total) * 100) : 0;

    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3 animate-pulse">
            {progress.phase === "global" ? "🧠" : progress.phase === "scoring" ? "🔍" : "📊"}
          </div>
          <h2 className="text-lg font-bold mb-1">AI 正在分析小说</h2>
        </div>

        {/* 当前状态 */}
        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-2">
            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded mt-0.5 shrink-0">
              {progress.phase === "global" ? "THINKING" : progress.phase === "type_detect" ? "DETECTING" : progress.phase === "scoring" ? "ACTING" : progress.phase === "review" ? "REVIEWING" : "WORKING"}
            </span>
            <p className="text-sm text-gray-700">{progress.message}</p>
          </div>
        </div>

        {/* 进度条 */}
        {isScoring && progress.total && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>章节打分进度</span>
              <span>{progress.current}/{progress.total} ({pct}%)</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-blue-500 h-3 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* 实时评分日志 */}
        {scoreLog.length > 0 && (
          <div className="border rounded-lg p-3 max-h-40 overflow-y-auto">
            <h4 className="text-xs text-gray-500 mb-2 font-medium">实时评分结果</h4>
            {scoreLog.map((msg, i) => (
              <div key={i} className="text-xs text-gray-600 py-0.5">{msg}</div>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-4">
          分析流程：全局风格识别 → 型判定 → 逐章7维度打分 → 审稿校验 → 汇总报告
        </p>
      </div>
    );
  }

  if (!analysis) return null;

  return (
    <div className="space-y-6">
      {/* 有草稿且有分析结果时：报告已产出，但还缺部分章节的评分，提示可补分 */}
      {analysisDraft && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="text-sm text-amber-800">
            ⚠️ 报告已生成，但仍有 {analysisDraft.totalChapters - analysisDraft.scoredCount} 章评分失败未补。点击「继续分析」可跳过已完成章节、只补失败章节，无需重跑。
          </div>
          <button
            className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700 shrink-0"
            onClick={() => { setError(null); startAnalysis(true); }}
          >
            🔄 继续分析
          </button>
        </div>
      )}

      {/* 标题区 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold break-words">{projectName || analysis.novel.title}</h1>
            {projectName && analysis.novel.title && projectName !== analysis.novel.title && (
              <p className="text-sm text-gray-400 mt-0.5">《{analysis.novel.title}》</p>
            )}
            <TypeBadges detection={analysis.categoryDetection} className="mt-2 flex-wrap" />
            <p className="text-gray-500 mt-2 text-sm">
              {analysis.novel.totalChapters}章 · {analysis.novel.totalWords}字
              {analysis.novel.platform && ` · ${analysis.novel.platform}`}
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 sm:block sm:text-right shrink-0">
            <div className="text-3xl font-bold text-blue-600">
              {analysis.overall.weightedTotal.toFixed(1)}
            </div>
            <div className="text-sm text-gray-500">综合评分</div>
            <button
              className="mt-2 text-xs px-3 py-1.5 border border-orange-200 text-orange-600 rounded-lg hover:bg-orange-50"
              onClick={handleReanalyze}
            >
              🔄 重新分析
            </button>
          </div>
        </div>
      </div>

      {/* 分类判定结果卡片 */}
      {analysis.categoryDetection && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl shadow-sm border border-indigo-200 p-6">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <span className="text-lg">🎯</span> 分类判定结果
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500">性别：</span>
              <span className={`font-bold ${analysis.categoryDetection.gender === "male" ? "text-blue-600" : "text-pink-600"}`}>
                {analysis.categoryDetection.gender === "male" ? "男频" : "女频"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">一级分类：</span>
              <span className="font-bold">{analysis.categoryDetection.primaryLabel}</span>
            </div>
            <div>
              <span className="text-gray-500">二级分类：</span>
              <span className="font-bold">{analysis.categoryDetection.secondaryCategory}</span>
            </div>
            <div>
              <span className="text-gray-500">置信度：</span>
              <span className="font-bold">{Math.round(analysis.categoryDetection.confidence * 100)}%</span>
            </div>
          </div>
          <div className="mt-3 text-sm text-gray-600">
            <span className="text-gray-500">判定理由：</span>{analysis.categoryDetection.reasoning}
          </div>
        </div>
      )}

      {/* 审稿结果卡片 */}
      {analysis.review && (
        <div className={`rounded-xl shadow-sm border p-6 ${
          analysis.review.passed
            ? "bg-green-50 border-green-200"
            : "bg-red-50 border-red-200"
        }`}>
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <span className="text-lg">{analysis.review.passed ? "✅" : "⚠️"}</span>
            审稿校验（{analysis.review.mnemonic}）
          </h3>
          {analysis.review.fatalFlaws.length > 0 && (
            <div className="mb-3">
              <h4 className="text-sm font-medium text-red-700 mb-1">命门问题：</h4>
              <ul className="list-disc pl-5 text-sm text-red-600 space-y-0.5">
                {analysis.review.fatalFlaws.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}
          {analysis.review.issues.length > 0 && (
            <div className="space-y-1.5">
              {analysis.review.issues.slice(0, 5).map((issue, i) => (
                <div key={i} className="text-xs flex items-start gap-2">
                  <span className={`px-1.5 py-0.5 rounded shrink-0 ${
                    issue.severity === "fatal" ? "bg-red-100 text-red-700" :
                    issue.severity === "warning" ? "bg-yellow-100 text-yellow-700" :
                    "bg-gray-100 text-gray-600"
                  }`}>
                    {issue.severity === "fatal" ? "致命" : issue.severity === "warning" ? "警告" : "建议"}
                  </span>
                  <div>
                    <span className="text-gray-500">[{issue.category}]</span> {issue.description}
                    {issue.suggestion && <span className="text-gray-500 ml-1">→ {issue.suggestion}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 雷达图 + 风格信息 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="font-semibold mb-4">多维度评分</h3>
          <RadarChart scores={analysis.overall.scores} />
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div>
            <h3 className="font-semibold mb-2">小说风格</h3>
            <div className="text-sm space-y-1">
              <p><span className="text-gray-500">类型：</span>{analysis.style.genre}</p>
              <p><span className="text-gray-500">基调：</span>{analysis.style.tone}</p>
              <p><span className="text-gray-500">叙事：</span>{analysis.style.narrative}</p>
              <p className="text-gray-700 mt-2">{analysis.style.summary}</p>
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-2">世界观</h3>
            <p className="text-sm text-gray-700">{analysis.world.summary}</p>
          </div>

          {analysis.world.mapAnalysis && (
            <div className="border-t pt-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="font-semibold">地图与空间扩展</h3>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  analysis.world.mapAnalysis.verdict === "narrow" ? "bg-amber-100 text-amber-700" :
                  analysis.world.mapAnalysis.verdict === "broad" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                }`}>
                  {analysis.world.mapAnalysis.verdict === "narrow" ? "空间偏窄" : analysis.world.mapAnalysis.verdict === "broad" ? "空间开阔" : "空间适中"}
                </span>
              </div>
              <p className="text-sm text-gray-700">{analysis.world.mapAnalysis.summary}</p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {analysis.world.mapAnalysis.keyLocations.slice(0, 6).map((location) => (
                  <div key={location.name} className="text-sm bg-gray-50 rounded-lg p-2">
                    <div className="font-medium">{location.name} <span className="text-xs text-gray-400">· {location.type}</span></div>
                    <div className="text-xs text-gray-500 mt-0.5">{location.significance}</div>
                  </div>
                ))}
              </div>
              {analysis.world.mapAnalysis.recommendations.length > 0 && (
                <div className="mt-3 text-sm">
                  <span className="text-gray-500">扩展建议：</span>{analysis.world.mapAnalysis.recommendations.slice(0, 3).join("；")}
                </div>
              )}
            </div>
          )}

          <div>
            <h3 className="font-semibold mb-2">核心角色</h3>
            <div className="space-y-2">
              {analysis.characters.map((char, i) => (
                <div key={i} className="text-sm flex items-start gap-2">
                  <span className="px-2 py-0.5 bg-gray-100 rounded text-xs shrink-0">{char.type}</span>
                  <div>
                    <span className="font-medium">{char.name}</span>
                    <span className="text-gray-500"> — {char.oneLiner}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t">
            <h3 className="font-semibold mb-2">整体评论</h3>
            <p className="text-sm text-gray-700">{analysis.overall.summary}</p>
          </div>
        </div>
      </div>

      {/* 维度评分明细 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="font-semibold mb-4">各维度得分</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(Object.entries(analysis.overall.scores) as [string, { score: number; comment: string }][]).map(
            ([key, val]) => (
              <div key={key} className="p-3 rounded-lg border">
                <div className="text-xs text-gray-500 mb-1">
                  {dimensionLabels[key] || key}
                </div>
                <ScoreBadge score={val.score} />
                <p className="text-xs text-gray-600 mt-1">{val.comment}</p>
              </div>
            )
          )}
        </div>
      </div>

      {/* 章节列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="font-semibold mb-4">
          章节列表（{chapters.length}章）
        </h3>
        <div className="space-y-2">
          {chapters.map((ch) => {
            // 从分析结果中查找对应章节的评分
            const scoreData = analysis?.chapters.find((ac) => ac.index === ch.index);
            return (
              <div
                key={ch.index}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:border-blue-200 hover:bg-blue-50/40 transition-colors cursor-pointer"
                onClick={() => router.push(`/preview/${id}?chapter=${ch.index}`)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-16 text-center">
                    {scoreData ? (
                      <ScoreBadge score={scoreData.weightedTotal} />
                    ) : (
                      <span className="text-xs text-gray-400">未评分</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{ch.title}</div>
                    <div className="text-xs text-gray-500">
                      {ch.wordCount}字{scoreData ? ` · ${scoreData.emotionalBeat}` : ""}
                    </div>
                  </div>
                  {scoreData?.weakestDimensions && scoreData.weakestDimensions.length > 0 && (
                    <div className="flex gap-1">
                      {scoreData.weakestDimensions.map((d) => (
                        <span key={d} className="text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded">
                          {dimensionLabels[d] || d}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="text-xs px-3 py-1.5 border border-blue-200 text-blue-600 rounded hover:bg-blue-50 ml-4"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/rewrite/${id}?chapter=${ch.index}`);
                  }}
                >
                  改写
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 续写入口 */}
      <div className="text-center">
        <button
          className="px-8 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
          onClick={() => router.push(`/continue/${id}`)}
        >
          续写下一章
        </button>
      </div>
    </div>
  );
}
