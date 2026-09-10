import { analyzeGlobal } from "@/agents/analyst";
import { detectType } from "@/agents/type-detector";
import { batchScoreFromSummaries, chunk, SCORE_BATCH_SIZE } from "@/agents/batch-scorer";
import { localSummarizeChapter } from "@/lib/local-summarizer";
import { reviewChapter } from "@/agents/reviewer";
import { calculateWeightedTotal, weightsFromContext } from "@/scoring/calculator";
import { AnalysisResult, Chapter, ChapterScore, ChapterSummary, CategoryDetection, AnalysisDraft, ReviewResult, ScoringContext } from "@/scoring/types";
import { getScoringContext } from "@/lib/prompt-registry";
import { saveAnalysis, saveProject, loadProject, loadAnalysisDraft, saveAnalysisDraft, clearAnalysisDraft } from "@/lib/novel-store";
import { withRetry } from "@/lib/retry";
import { runWithConcurrency } from "@/lib/concurrency";
import { contentHash, extractKeyExcerpts, extractLocalFeaturePack } from "@/lib/chapter-features";
import { sanitizeErrorMessage } from "@/lib/sse";

/** Phase 2 打分并发数 */
const SCORE_CONCURRENCY = 3;

/** 项目级分析锁：防止同一项目同时运行多个分析 */
const analysisLocks = new Map<string, Promise<void>>();

interface ScoreFailure { index: number; title: string; error: string }

/** "不可恢复"的系统性错误特征 —— 出现时整批放弃，不拆批逐个重试（否则会为同一条 401 调 185 次 API 且必然失败）。 */
function isSystemicFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err).toLowerCase();
  return /insufficient_quota|invalid_api_key|unauthorized|forbidden|bad request|\b400\b|\b401\b/.test(msg);
}

/** 批量失败时递归拆分，直到单章；避免模型漏一章导致整批成果丢失。 */
async function scoreWithFallback(
  batch: ChapterSummary[],
  chapters: Chapter[],
  styleContext: string,
  detection: CategoryDetection,
  scoringContext?: ScoringContext
): Promise<{ scores: ChapterScore[]; failures: ScoreFailure[] }> {
  try {
    const scores = await withRetry(
      () => batchScoreFromSummaries(batch, chapters, styleContext, detection, scoringContext),
      { tag: `score_${batch[0].index}` }
    );
    return { scores, failures: [] };
  } catch (err) {
    // 系统性错误（认证/配额/参数）拆批也只会重复失败，整批标记放弃，避免浪费配额。
    // 这类错误不 throw —— 由 runAnalysis 记录到草稿，用户看到「分析中断」提示而非整本失败。
    if (isSystemicFailure(err)) {
      return {
        scores: [],
        failures: batch.map((chapter) => ({
          index: chapter.index,
          title: chapter.title,
          error: sanitizeErrorMessage(err),
        })),
      };
    }
    if (batch.length === 1) {
      return {
        scores: [],
        failures: [{ index: batch[0].index, title: batch[0].title, error: sanitizeErrorMessage(err) }],
      };
    }
    // 其余错误（网络抖动/偶发 5xx/格式异常）拆批逐枚，直到单章；不让一次偶发拖垮整本。
    const middle = Math.ceil(batch.length / 2);
    const [left, right] = await Promise.all([
      scoreWithFallback(batch.slice(0, middle), chapters, styleContext, detection, scoringContext),
      scoreWithFallback(batch.slice(middle), chapters, styleContext, detection, scoringContext),
    ]);
    return { scores: [...left.scores, ...right.scores], failures: [...left.failures, ...right.failures] };
  }
}

export interface AnalysisProgress {
  phase: "global" | "type_detect" | "summary" | "scoring" | "review" | "complete";
  message: string;
  current?: number;
  total?: number;
  latestScore?: ChapterScore;
  categoryDetection?: CategoryDetection;
}

export interface AnalysisOptions {
  /** 断点续跑：true 时从草稿恢复已完成步骤，绝不重来 */
  resume?: boolean;
}

/**
 * 执行完整的分析 Workflow（两阶段打分 + 断点续跑）
 *
 * 1. 全局分析 + 型判定（合并为 1 次 AI 调用）—— 有草稿则跳过
 * 2. Phase 1：批量摘要（每批 5 章，5 路并发）—— 有草稿则跳过已完成
 * 3. Phase 2：批量打分（每批 20 条摘要，3 路并发）—— 有草稿则跳过已完成
 * 4. 汇总报告 + 审稿校验
 *
 * 每完成一个步骤就增量保存草稿，中断后可从草稿恢复。
 */
export async function runAnalysis(
  projectId: string,
  chapters: Chapter[],
  onProgress?: (p: AnalysisProgress) => void,
  options?: AnalysisOptions
): Promise<AnalysisResult> {
  const pipelineStart = Date.now();
  const log = (step: string, detail?: string) => {
    const tag = `[Analysis][${projectId.slice(0, 8)}][${step}]`;
    console.log(`${tag} ${detail || ""}`);
  };

  // ── 项目级并发锁：防止同一项目同时运行多个分析 ──
  if (analysisLocks.has(projectId)) {
    await analysisLocks.get(projectId);
    // 等待完成后检查是否已有分析结果
    const project = await loadProject(projectId);
    if (project?.analysis) {
      log("pipeline", "跳过：已有另一个分析正在运行且已完成");
      return project.analysis;
    }
  }

  // 设置锁
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => { releaseLock = resolve; });
  analysisLocks.set(projectId, lockPromise);

  try {
  log("pipeline", `start | chapters=${chapters.length} resume=${!!options?.resume}`);

  // 项目名（true 书名）优先作为分析报告标题；章标题提取只是兜底。
  const projectName = (await loadProject(projectId))?.name;

  // ── 加载或创建草稿 ──
  let draft: AnalysisDraft;
  if (options?.resume) {
    const existing = await loadAnalysisDraft(projectId);
    if (existing) {
      draft = existing;
      // 兼容旧草稿：补全新字段
      if (!draft.chapterSummaries) draft.chapterSummaries = [];
      // 旧草稿有 chapterScores 但没有 chapterSummaries → 旧方法评分，需重新走两阶段
      if (draft.chapterSummaries.length === 0 && draft.chapterScores.length > 0) {
        log("resume", `旧草稿检测到 ${draft.chapterScores.length} 章旧评分（无摘要），清空重来`);
        draft.chapterScores = [];
      }
      log("resume", `草稿恢复 | global=${!!draft.globalAnalysis} category=${!!draft.categoryDetection} summaries=${draft.chapterSummaries.length} scored=${draft.chapterScores.length}/${chapters.length}`);
    } else {
      draft = { chapterSummaries: [], chapterScores: [], failedIndices: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
  } else {
    // 非恢复模式：先检查是否有现有草稿，有则保留已打分的章节
    const existing = await loadAnalysisDraft(projectId);
    if (existing && existing.chapterScores.length > 0) {
      log("restart", `检测到现有草稿（${existing.chapterScores.length} 章已评分），保留已评分章节`);
      draft = existing;
      // 保留全局分析和型判定，清空失败记录
      draft.failedIndices = [];
    } else {
      draft = { chapterSummaries: [], chapterScores: [], failedIndices: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
  }

  // ── Step 1: 全局分析 + 型判定 ──
  let globalAnalysis = draft.globalAnalysis;
  let categoryDetection = draft.categoryDetection;

  // 非恢复模式下，从项目记录恢复已有结果，避免重复分析
  if (!globalAnalysis || !categoryDetection) {
    const project = await loadProject(projectId);
    if (project) {
      if (!categoryDetection && project.categoryDetection) {
        categoryDetection = project.categoryDetection;
        draft.categoryDetection = categoryDetection;
        log("category", "分类判定从项目记录恢复");
        onProgress?.({
          phase: "type_detect",
          message: `✓ 分类判定从项目记录恢复：${categoryDetection.gender === "male" ? "男频" : "女频"} / ${categoryDetection.primaryLabel} / ${categoryDetection.secondaryCategory}`,
          categoryDetection,
        });
      }
      if (!globalAnalysis && project.analysis?.style) {
        globalAnalysis = {
          style: project.analysis.style,
          world: project.analysis.world,
          characters: project.analysis.characters,
          overallComment: project.analysis.overall?.summary || "",
        };
        draft.globalAnalysis = globalAnalysis;
        log("global", "全局分析从项目记录恢复");
        onProgress?.({
          phase: "global",
          message: "✓ 全局分析从项目记录恢复",
        });
      }
    }
    // 恢复后立即保存草稿，防止后续步骤崩溃丢失
    if (draft.globalAnalysis || draft.categoryDetection) {
      await saveAnalysisDraft(projectId, draft);
    }
  }

  if (globalAnalysis && categoryDetection) {
    log("global+category", "skip（已有结果）");
  } else if (categoryDetection && !globalAnalysis) {
    // 型判定已有，只需全局分析（输出小，不易截断）
    onProgress?.({ phase: "global", message: "🧠 Thinking: 正在分析小说风格/世界观/人设..." });

    const result = await withRetry(() => analyzeGlobal(chapters), { tag: "global" });
    globalAnalysis = result;
    draft.globalAnalysis = globalAnalysis;
    await saveAnalysisDraft(projectId, draft);
    log("global", "done");
  } else {
    // 两者都没有，分开调用（各自输出小，不易截断）
    onProgress?.({ phase: "global", message: "🧠 Thinking: 正在分析小说风格/世界观/人设..." });
    globalAnalysis = await withRetry(() => analyzeGlobal(chapters), { tag: "global" });
    draft.globalAnalysis = globalAnalysis;
    await saveAnalysisDraft(projectId, draft);
    log("global", "done");

    onProgress?.({ phase: "global", message: "🧠 Thinking: 正在判定性别/一级分类/二级分类..." });
    categoryDetection = await withRetry(() => detectType(chapters), { tag: "category" });
    draft.categoryDetection = categoryDetection;
    await saveAnalysisDraft(projectId, draft);

    const project = await loadProject(projectId);
    if (project) {
      project.gender = categoryDetection.gender;
      project.primaryCategory = categoryDetection.primaryCategory;
      project.secondaryCategory = categoryDetection.secondaryCategory;
      project.categoryDetection = categoryDetection;
      await saveProject(project);
    }
    log("category", `done: ${categoryDetection.gender}/${categoryDetection.primaryLabel}/${categoryDetection.secondaryCategory}`);
  }

  onProgress?.({
    phase: "type_detect",
    message: `✓ 分类判定完成：${categoryDetection.gender === "male" ? "男频" : "女频"} / ${categoryDetection.primaryLabel} / ${categoryDetection.secondaryCategory}（置信度${Math.round(categoryDetection.confidence * 100)}%）`,
    categoryDetection,
  });

  // ── 解析本次分析生效的配置包权重（一次解析，全流程复用）──
  const project = await loadProject(projectId);
  const scoringContext = (await getScoringContext("scorer", {
    platform: project?.platformId,
    gender: categoryDetection.gender,
    primaryCategory: categoryDetection.primaryCategory,
    secondaryCategory: categoryDetection.secondaryCategory,
  })) ?? undefined;
  if (scoringContext) {
    log("weights", `pack=${scoringContext.packId}@${scoringContext.packVersion} source=${scoringContext.weightSource}`);
  }

  // ── Phase 1: 本地摘要（纯文本处理，无 AI 调用）──
  let chapterSummaries: ChapterSummary[] = [...draft.chapterSummaries];
  const summarizedSet = new Set(chapterSummaries.map((s) => s.index));

  if (summarizedSet.size >= chapters.length) {
    log("summary", "skip（草稿已有全部摘要）");
  } else {
    const pending = chapters.length - summarizedSet.size;
    log("summary", `本地 TextRank 摘要 ${summarizedSet.size}/${chapters.length} → 补充 ${pending} 章`);

    onProgress?.({
      phase: "summary",
      message: `📝 Phase 1: 本地摘要（TextRank，无 AI 调用，${pending} 章待处理）...`,
      current: summarizedSet.size,
      total: chapters.length,
    });

    let processedCount = 0;
    for (let i = 0; i < chapters.length; i++) {
      if (summarizedSet.has(i)) continue;

      const { summary, emotionalBeat } = localSummarizeChapter(chapters[i].content);
      chapterSummaries.push({ index: i, title: chapters[i].title, summary, emotionalBeat, sourceHash: contentHash(chapters[i].content), features: extractLocalFeaturePack(chapters[i].content), keyExcerpts: extractKeyExcerpts(chapters[i].content) });
      processedCount++;

      // 增量保存：每 200 章存一次，防止中断丢失进度
      if (processedCount % 200 === 0) {
        draft.chapterSummaries = chapterSummaries;
        await saveAnalysisDraft(projectId, draft);
      }

      if (i % 100 === 0 || i === chapters.length - 1) {
        onProgress?.({
          phase: "summary",
          message: `📝 本地摘要: ${i + 1}/${chapters.length}...`,
          current: chapterSummaries.length,
          total: chapters.length,
        });
      }
    }

    draft.chapterSummaries = chapterSummaries;
    await saveAnalysisDraft(projectId, draft);
    log("summary", `done | summaries=${chapterSummaries.length}`);
  }

  // ── Phase 2: 批量打分（从摘要）──
  let chapterScores: ChapterScore[] = [...draft.chapterScores];
  const scoredSet = new Set(chapterScores.map((s) => s.index));

  const pendingScoreSummaries: ChapterSummary[] = [];
  for (const s of chapterSummaries) {
    if (!scoredSet.has(s.index)) pendingScoreSummaries.push(s);
  }

  if (pendingScoreSummaries.length === 0) {
    log("scoring", "skip（草稿已有全部评分）");
  } else {
    const styleContext = `风格：${globalAnalysis!.style.genre} ${globalAnalysis!.style.tone}，${globalAnalysis!.style.narrative}`;
    const scoreBatches = chunk(pendingScoreSummaries, SCORE_BATCH_SIZE);
    log("scoring", `待评分=${pendingScoreSummaries.length} 批次=${scoreBatches.length} 并发=${SCORE_CONCURRENCY}`);

    onProgress?.({
      phase: "scoring",
      message: `🔍 Phase 2: 批量打分（${pendingScoreSummaries.length} 章待评分，${scoreBatches.length} 批次，${SCORE_CONCURRENCY} 路并发）...`,
      current: chapterScores.length,
      total: chapters.length,
    });

    // 互斥锁：确保草稿写入严格串行
    let saveMutex = Promise.resolve();

    const scoreFailures: ScoreFailure[] = [];
    const { failed: unexpectedFailures } = await runWithConcurrency(
      scoreBatches,
      SCORE_CONCURRENCY,
      async (batch) => {
        onProgress?.({
          phase: "scoring",
          message: `🔍 打分中: 第 ${batch[0].index + 1}-${batch[batch.length - 1].index + 1} 章（${batch.length} 章/批）...`,
          current: chapterScores.length,
          total: chapters.length,
        });

        const result = await scoreWithFallback(batch, chapters, styleContext, categoryDetection!, scoringContext);
        const scores = result.scores;
        scoreFailures.push(...result.failures);

        // 互斥锁：用 then 链确保每个 worker 的保存严格串行
        // 每个 worker 创建独立的 then 链，不会有两个 worker 同时写文件
        const mySave = saveMutex.then(async () => {
          chapterScores.push(...scores);
          draft.chapterScores = [...chapterScores];
          draft.failedIndices = scoreFailures.map((failure) => failure.index);
          draft.failedChapters = [...scoreFailures];
          await saveAnalysisDraft(projectId, draft);
        });
        saveMutex = mySave.catch(() => {}); // 后续 worker 等这个，即使失败也不阻塞
        await mySave;

        onProgress?.({
          phase: "scoring",
          message: `✓ 评分完成: ${scores.length} 章（累计 ${chapterScores.length}/${chapters.length}）`,
          current: chapterScores.length,
          total: chapters.length,
          latestScore: scores[scores.length - 1],
        });
      }
    );

    // 等待最后一次保存完成
    await saveMutex;

    for (const failure of unexpectedFailures) {
      const failedBatch = scoreBatches[failure.index] || [];
      scoreFailures.push(...failedBatch.map((chapter) => ({
        index: chapter.index,
        title: chapter.title,
        error: sanitizeErrorMessage(failure.error),
      })));
    }

    if (scoreFailures.length > 0) {
      // 部分章评分失败：不中断整本分析，记录到草稿供断点续跑补分，
      // 已成功的章照常汇总产出报告。
      draft.chapterScores = chapterScores;
      draft.failedIndices = [...new Set(scoreFailures.map((failure) => failure.index))];
      draft.failedChapters = scoreFailures;
      await saveAnalysisDraft(projectId, draft);
      log("scoring", `partial | 失败 ${draft.failedIndices.length} 章，成功 ${chapterScores.length} 章`);
      onProgress?.({
        phase: "scoring",
        message: `⚠️ ${draft.failedIndices.length} 章评分失败（章节：${draft.failedIndices.map((index) => index + 1).join("、")}），已跳过，可稍后点「继续分析」补分。`,
      });
    } else {
      // 无失败：清空失败记录。
      draft.failedIndices = [];
      draft.failedChapters = [];
    }

    log("scoring", `all done | scored=${chapterScores.length}`);
  }

  // ── Step 3: 汇总整体评分 ──
  const overallScores = aggregateScores(chapterScores);
  const weights = weightsFromContext(scoringContext);
  const overallWeightedTotal = calculateWeightedTotal(overallScores, weights);

  const analysisResult: AnalysisResult = {
    novel: {
      title: projectName || chapters[0]?.title?.replace(/第.*章\s*/, "") || "未命名",
      totalChapters: chapters.length,
      totalWords: chapters.reduce((sum, ch) => sum + ch.wordCount, 0),
    },
    style: globalAnalysis!.style,
    world: globalAnalysis!.world,
    characters: globalAnalysis!.characters,
    overall: {
      scores: overallScores,
      weightedTotal: overallWeightedTotal,
      summary: globalAnalysis!.overallComment,
    },
    chapters: chapterScores,
    categoryDetection,
    scoringContext,
  };

  // ── Step 4: 审稿校验（对低分章节执行）──
  const lowScoreChapters = chapterScores.filter((ch) => ch.weightedTotal < 6 || (ch.confidence || 0) < 0.55 || chapters[ch.index] && extractLocalFeaturePack(chapters[ch.index].content).anomalyFlags.length > 0);
  if (lowScoreChapters.length > 0) {
    if (draft.review) {
      analysisResult.review = draft.review;
      log("review", "skip（草稿已有）");
    } else {
      onProgress?.({ phase: "review", message: `📝 Acting: 对${lowScoreChapters.length}个低分章节执行审稿校验...` });

      try {
        const targets = lowScoreChapters.slice(0, 8);
        const reviews = [];
        for (const target of targets) {
          const content = chapters[target.index]?.content || "";
          const result = await withRetry(() => reviewChapter(content, categoryDetection!, target.title), { tag: `review_${target.index}` });
          reviews.push({ ...result, chapterIndex: target.index });
        }
        analysisResult.review = reviews[0];
        analysisResult.reviews = reviews;
        analysisResult.chapters = analysisResult.chapters.map((c) => targets.some((x) => x.index === c.index) ? { ...c, scoringMode: "full_review", confidence: Math.max(c.confidence || 0, 0.75) } : c);

        // 保存审稿结果到草稿
        draft.review = reviews[0];
        await saveAnalysisDraft(projectId, draft);

        onProgress?.({
          phase: "review",
          message: reviews.every((r) => r.passed)
            ? `✓ ${reviews.length} 个章节审稿通过`
            : `⚠️ ${reviews.filter((r) => !r.passed).length} 个章节审稿发现问题`,
        });
      } catch {
        onProgress?.({ phase: "review", message: "⚠️ 审稿校验跳过（模型调用失败）" });
      }
    }
  }

  // ── 保存最终分析结果，确认成功后清除草稿 ──
  await saveAnalysis(projectId, analysisResult);
  // 只在分析结果成功保存后才清除草稿（防止 saveAnalysis 失败时进度全丢）。
  // 若本次仍有评分失败章，保留草稿，让「继续分析」能跳过已成功的章、只补失败章。
  if (draft.failedChapters && draft.failedChapters.length > 0) {
    log("pipeline", `保留草稿（${draft.failedChapters.length} 章待补分），分析结果已产出`);
  } else {
    try {
      await clearAnalysisDraft(projectId);
    } catch {
      log("pipeline", "草稿清除失败（可忽略，下次启动时会自动跳过）");
    }
  }

  onProgress?.({ phase: "complete", message: "✅ 分析完成！" });

  log("pipeline", `done | total=${((Date.now() - pipelineStart) / 1000).toFixed(1)}s chapters=${chapters.length}`);

  return analysisResult;

  } finally {
    releaseLock!();
    analysisLocks.delete(projectId);
  }
}

/**
 * 汇总所有章节评分为整体评分
 */
function aggregateScores(chapterScores: ChapterScore[]) {
  // 全部章评分失败时不该崩溃：返回空聚合，让报告用空分数显示。
  if (chapterScores.length === 0) return {};
  const keys = Object.keys(chapterScores[0].scores) as (keyof typeof chapterScores[0]["scores"])[];
  const aggregated: Record<string, { score: number; comment: string }> = {};

  for (const key of keys) {
    const avg = chapterScores.reduce(
      (sum, ch) => sum + ch.scores[key].score,
      0
    ) / chapterScores.length;

    const weak = chapterScores
      .filter((ch) => ch.scores[key].score < 6)
      .sort((a, b) => a.scores[key].score - b.scores[key].score);
    const representative = weak.slice(0, 3);
    const evidence = representative
      .map((ch) => {
        const comment = ch.scores[key].comment
          .replace(/[\r\n]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 72);
        return `第${ch.index + 1}章：${comment}`;
      })
      .filter((item, index, items) => items.indexOf(item) === index)
      .join("；");
    const score = Math.round(avg * 10) / 10;
    const conclusion = score < 6
      ? `整体偏弱，${weak.length}章低于6分，问题集中在该维度的兑现与稳定性。`
      : score < 7
        ? "整体中等，局部章节存在明显短板，建议优先修复低分段。"
        : "整体表现稳定，未发现集中性的明显短板。";
    aggregated[key] = {
      score,
      comment: evidence ? `${conclusion}代表：${evidence}` : conclusion,
    };
  }

  return aggregated as unknown as typeof chapterScores[0]["scores"];
}
