import { rewriteChapter } from "@/agents/writer";
import { scoreChapter, rescoreText } from "@/agents/scorer";
import { removeAIFlavor } from "@/agents/deai";
import { removeAds } from "@/agents/ad-detector";
import { alignStyle } from "@/agents/style-align";
import { reviewChapter } from "@/agents/reviewer";
import { findWeakestDimensions, weightsFromContext } from "@/scoring/calculator";
import { getScoringContext } from "@/lib/prompt-registry";
import { ScoreBlock, RewriteVersion, Chapter, StyleProfile } from "@/scoring/types";
import { loadProject, getChapterContent, saveRewrite, saveProject, getOrExtractStyleProfile } from "@/lib/novel-store";

export interface RewriteOptions {
  targetDimensions?: string[];
  styleHint?: string;
  enableDeAI?: boolean;
  enableAdRemove?: boolean;
  enableStyleAlign?: boolean;
}

export interface RewriteProgress {
  phase: "loading" | "rewriting" | "adcheck" | "deai" | "stylealign" | "scoring" | "complete";
  message: string;
  rewrittenText?: string;
  newScore?: ScoreBlock;
}

/**
 * 执行改写 Workflow
 * Pipeline: 改写(注入风格指纹) → 去广告(可选) → 去AI味(可选) → 风格对齐(可选) → 重新打分
 */
export async function runRewrite(
  projectId: string,
  chapterIndex: number,
  options?: RewriteOptions,
  onProgress?: (p: RewriteProgress) => void
): Promise<RewriteVersion> {
  const pipelineStart = Date.now();
  const log = (step: string, detail?: string) => {
    const tag = `[Rewrite][${projectId.slice(0, 8)}][ch${chapterIndex}][${step}]`;
    console.log(`${tag} ${detail || ""}`);
  };
  const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    log(label, "start");
    try {
      const result = await fn();
      log(label, `done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return result;
    } catch (err: any) {
      log(label, `FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${err.message}`);
      throw err;
    }
  };

  const dims = options?.targetDimensions;
  const enableDeAI = options?.enableDeAI !== false; // 默认开启
  const enableAdRemove = options?.enableAdRemove !== false; // 默认开启
  const enableStyleAlign = options?.enableStyleAlign !== false; // 默认开启
  const styleHint = options?.styleHint;

  log("pipeline", `start | deAI=${enableDeAI} adRemove=${enableAdRemove} styleAlign=${enableStyleAlign}`);

  onProgress?.({ phase: "loading", message: "加载分析结果和原文..." });

  const project = await loadProject(projectId);
  if (!project) throw new Error("项目不存在");
  if (!project.analysis) throw new Error("请先执行分析");

  const chapter = project.chapters[chapterIndex];
  if (!chapter) throw new Error("章节不存在");

  // 复用分析时解析的权重上下文，保证改写目标维度与原始评分口径一致；
  // 旧分析结果没有记录上下文时按项目分类重新解析。
  const scoringContext =
    project.analysis.scoringContext ??
    (await getScoringContext("scorer", {
      platform: project.platformId,
      gender: project.categoryDetection?.gender,
      primaryCategory: project.categoryDetection?.primaryCategory,
      secondaryCategory: project.categoryDetection?.secondaryCategory,
    })) ??
    undefined;

  // 获取或自动生成章节评分（续写章节可能没有分析评分）
  let chapterScore = project.analysis.chapters.find((c) => c.index === chapterIndex);
  if (!chapterScore) {
    onProgress?.({ phase: "loading", message: "该章节缺少评分，正在自动生成..." });

    chapterScore = await timed("auto_score", () => scoreChapter(chapter, undefined, undefined, scoringContext));
    project.analysis.chapters.push(chapterScore);
    await saveProject(project);
  }

  // 确定目标维度
  const targetDims = dims || findWeakestDimensions(chapterScore.scores, weightsFromContext(scoringContext), 2);

  // 获取作者风格指纹（首次使用时提取，之后读缓存）
  let styleProfile: StyleProfile | undefined;
  if (enableStyleAlign) {
    onProgress?.({ phase: "loading", message: "🖊 提取作者风格指纹..." });
    try {
      styleProfile = await timed("style_profile", () => getOrExtractStyleProfile(projectId));
      onProgress?.({ phase: "loading", message: `✓ 风格指纹就绪：${styleProfile.summary}` });
    } catch (err: any) {
      log("style_profile", `skip: ${err.message}`);
      // 风格提取失败不阻断主流程，降级为无风格约束模式运行
    }
  }

  // 构建风格上下文
  const styleContext = `${project.analysis.style.genre} ${project.analysis.style.tone}，${project.analysis.style.narrative}。${project.analysis.style.summary}`;

  onProgress?.({ phase: "rewriting", message: `正在改写（目标: ${targetDims.join(", ")}）...` });

  // 执行改写（注入赛道约束 + 风格指纹）
  let rewrittenContent = await timed("rewrite", () =>
    rewriteChapter(
      chapter.content,
      chapter.title,
      chapterScore,
      targetDims,
      styleContext,
      project.categoryDetection,
      styleProfile
    )
  );

  // 去广告 Pipeline
  if (enableAdRemove) {
    onProgress?.({ phase: "adcheck", message: "广告检测中...", rewrittenText: rewrittenContent });

    const adResult = await timed("adcheck", () => removeAds(rewrittenContent));
    rewrittenContent = adResult.cleanText;
  }

  // 去AI味 Pipeline
  if (enableDeAI) {
    onProgress?.({ phase: "deai", message: "去AI味润色中...", rewrittenText: rewrittenContent });

    const toneHint = styleHint || `${project.analysis.style.tone}，${project.analysis.style.genre}`;
    rewrittenContent = await timed("deai", () => removeAIFlavor(rewrittenContent, toneHint, project.categoryDetection));
  }

  // 风格对齐 Pipeline（消除“作者换人”既视感）
  if (enableStyleAlign && styleProfile) {
    onProgress?.({ phase: "stylealign", message: "🖊 风格对齐：向原作者风格看齐...", rewrittenText: rewrittenContent });

    rewrittenContent = await timed("stylealign", () => alignStyle(rewrittenContent, styleProfile));
  }

  onProgress?.({ phase: "scoring", message: "重新打分验证...", rewrittenText: rewrittenContent });

  // 重新打分（复用分析时解析的权重上下文，否则权重为空、总分恒为 0）
  const newScore = await timed("rescore", () =>
    rescoreText(rewrittenContent, chapter.title, chapterScore, project.categoryDetection, scoringContext)
  );

  // 审稿校验（如果有型判定）
  if (project.categoryDetection) {
    try {
      onProgress?.({ phase: "scoring", message: "📝 Acting: 审稿校验中..." });
      const td = project.categoryDetection;
      if (td) {
        await timed("review", () => reviewChapter(rewrittenContent, td, chapter.title));
      }
    } catch {
      // 审稿失败不阻断主流程
    }
  }

  const rewriteVersion: RewriteVersion = {
    version: (project.rewrites[chapterIndex]?.length || 0) + 1,
    content: rewrittenContent,
    scores: newScore,
    targetDimensions: targetDims,
    createdAt: new Date().toISOString(),
  };

  // 保存
  await saveRewrite(projectId, chapterIndex, rewriteVersion);

  onProgress?.({ phase: "complete", message: "改写完成！", rewrittenText: rewrittenContent, newScore });

  log("pipeline", `done | total=${((Date.now() - pipelineStart) / 1000).toFixed(1)}s score=${newScore.weightedTotal}`);

  return rewriteVersion;
}
