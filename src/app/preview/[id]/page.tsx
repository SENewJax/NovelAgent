"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ScoreBadge } from "@/components/score-badge";
import { TypeBadges } from "@/components/type-badges";
import { AnalysisResult, CategoryDetection } from "@/scoring/types";
import { labelsFromContext } from "@/scoring/calculator";

interface ProjectChapter {
  index: number;
  title: string;
  content: string;
  wordCount: number;
}

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const chapterIndex = parseInt(searchParams.get("chapter") || "0", 10);

  const [chapters, setChapters] = useState<ProjectChapter[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [typeDetection, setTypeDetection] = useState<CategoryDetection | null>(null);
  const [novelTitle, setNovelTitle] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProject();
  }, [id]);

  const loadProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/novel/${id}`);
      const project = await res.json();

      if (project.chapters) setChapters(project.chapters);
      // 书名优先用项目名（文件名），分析结果的 novel.title 只在缺失时兜底 ——
      // 避免旧数据里 analysis.novel.title 为「未命名」时误显示在页头。
      if (project.analysis) {
        setAnalysis(project.analysis);
        setNovelTitle(project.name || project.analysis.novel?.title || "");
      } else {
        setNovelTitle(project.name || "");
      }
      if (project.categoryDetection) setTypeDetection(project.categoryDetection);
    } catch (err: any) {
      alert("加载失败: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const chapter = chapters.find((ch) => ch.index === chapterIndex);
  const scoreData = analysis?.chapters.find((ac) => ac.index === chapterIndex);
  // 维度显示名来自评分上下文快照，维度可配置后不存在全局常量
  const dimensionLabels = labelsFromContext(analysis?.scoringContext ?? undefined);

  const gotoChapter = (idx: number) => {
    router.push(`/preview/${id}?chapter=${idx}`);
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">加载中...</div>;
  }

  if (!chapter) {
    return (
      <div className="text-center py-12 text-gray-500">
        章节不存在
        <div className="mt-4">
          <button
            className="text-sm text-blue-600 hover:underline"
            onClick={() => router.push(`/analysis/${id}`)}
          >
            ← 返回分析报告
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* 顶部：标题与操作 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{chapter.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-gray-500">
              {novelTitle && `${novelTitle} · `}{chapter.wordCount}字 · 共{chapters.length}章
            </p>
            <TypeBadges detection={typeDetection} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="text-xs px-3 py-1.5 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50"
            onClick={() => router.push(`/rewrite/${id}?chapter=${chapterIndex}`)}
          >
            ✏️ 改写本章
          </button>
          <button
            className="text-sm text-gray-500 hover:text-blue-600"
            onClick={() => router.push(`/analysis/${id}`)}
          >
            ← 返回分析报告
          </button>
        </div>
      </div>

      {/* 章节评分信息 */}
      {scoreData && (
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <ScoreBadge score={scoreData.weightedTotal} />
            <span className="text-sm text-gray-600">{scoreData.emotionalBeat}</span>
            {scoreData.weakestDimensions?.length > 0 && (
              <div className="flex gap-1 ml-auto">
                {scoreData.weakestDimensions.map((d) => (
                  <span key={d} className="text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded">
                    弱项：{(dimensionLabels[d] || d)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 正文阅读区 */}
      <div className="bg-white rounded-xl shadow-sm border p-6 md:p-10">
        <div className="text-[15px] leading-8 text-gray-800 whitespace-pre-wrap">
          {chapter.content}
        </div>
      </div>

      {/* 底部：上一章 / 下一章 */}
      <div className="flex items-center justify-between">
        <button
          className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={chapterIndex <= 0}
          onClick={() => gotoChapter(chapterIndex - 1)}
        >
          ← 上一章
        </button>
        <span className="text-xs text-gray-400">
          {chapterIndex + 1} / {chapters.length}
        </span>
        <button
          className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={chapterIndex >= chapters.length - 1}
          onClick={() => gotoChapter(chapterIndex + 1)}
        >
          下一章 →
        </button>
      </div>
    </div>
  );
}
