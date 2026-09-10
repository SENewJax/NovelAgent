/**
 * 批量打分 Agent（Phase 2）
 *
 * Phase 1 摘要已改为本地 TextRank 提取（local-summarizer.ts），不走 AI。
 * 本文件只保留 Phase 2：从摘要批量打分。
 *
 * 每批 20 条摘要发 1 次 AI 调用，产出 7 维度评分。
 * 对比旧方案（逐章全文打分 1542 次 AI 调用）：
 * - Phase 1: 0 次 AI 调用（本地 TextRank，毫秒级完成）
 * - Phase 2: 1542/20 = ~78 次调用（只读摘要不读全文，每次快 ~5x）
 */

import { safeGenerateObject } from "@/lib/safe-generate";
import { z } from "zod";
import { Chapter, ChapterScore, ChapterSummary, CategoryDetection, ScoringContext, DimensionScores } from "@/scoring/types";
import { createAIClient, getConfig } from "@/lib/config";
import { getPrompt } from "@/lib/prompt-registry";
import { getGenderScoringHint } from "@/scoring/rubric";
import { calculateWeightedTotal, findWeakestDimensions, weightsFromContext } from "@/scoring/calculator";
import { buildDimensionScoresSchema } from "@/scoring/score-schema";
import { buildRubric } from "@/scoring/rubric-builder";
import { FALLBACK_DIMENSIONS } from "@/lib/fallback-pack";
import type { DimensionSpec } from "@/lib/config-pack-protocol";
import { contentHash, extractKeyExcerpts, extractLocalFeaturePack } from "@/lib/chapter-features";

/** Phase 2 打分批大小（10章/批，平衡输出长度与API调用次数） */
export const SCORE_BATCH_SIZE = 10;

// ── 工具：数组分块 ──
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// ════════════════════════════════════════════
// Phase 2: 批量打分（从摘要）
// ════════════════════════════════════════════

/**
 * 批量打分条目 schema，按本次评分的维度表生成。
 */
function scoreItemSchemaFor(dimensions: readonly DimensionSpec[]) {
  return z.object({
    index: z.number(),
    scores: buildDimensionScoresSchema(dimensions),
    summary: z.string(),
    emotionalBeat: z.string(),
    generalQuality: z.number().min(1).max(10).optional(),
    categoryFit: z.number().min(1).max(10).optional(),
    confidence: z.number().min(0).max(1).optional(),
    evidence: z.array(z.object({ quote: z.string(), dimension: z.string(), reason: z.string() })).optional(),
  });
}

// 兼容模型返回 scores 为对象而非数组的情况：
// 情况1: {"0": {...}, "1": {...}} — 数字键对象，需转为数组
// 情况2: 单章评分对象（含 dimension keys）→ 包为单元素数组
function batchScoreSchemaFor(dimensions: readonly DimensionSpec[]) {
  const scoreItemSchema = scoreItemSchemaFor(dimensions);
  const dimensionKeySet = new Set(dimensions.map((d) => d.key));
  return z.object({
    scores: z.preprocess(
      (val) => {
        if (val && typeof val === "object" && !Array.isArray(val)) {
          const keys = Object.keys(val as Record<string, unknown>);
          if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
            return keys
              .sort((a, b) => parseInt(a) - parseInt(b))
              .map(k => (val as Record<string, unknown>)[k]);
          }
          if (keys.length > 0 && keys.some(k => dimensionKeySet.has(k))) {
            return [{ index: 0, scores: val, summary: "", emotionalBeat: "" }];
          }
        }
        return val;
      },
      z.array(scoreItemSchema)
    ),
  });
}

/**
 * 批量打分：一次 AI 调用处理 SCORE_BATCH_SIZE 条摘要
 *
 * @param batch 章节摘要数组
 * @param chapters 原始章节数组（用于 wordCount 查找）
 * @param styleContext 风格上下文
 * @param detection 分类判定结果
 * @param scoringContext 本次分析解析出的评分上下文（平台/权重/维度表）
 * @returns ChapterScore[]
 */
export async function batchScoreFromSummaries(
  batch: ChapterSummary[],
  chapters: Chapter[],
  styleContext: string,
  detection: CategoryDetection,
  scoringContext?: ScoringContext
): Promise<ChapterScore[]> {
  const openai = await createAIClient();
  const config = await getConfig();
  const model = config.ai.scoreModel || config.ai.model;

  // \u7ef4\u5ea6\u8868\u6765\u81ea\u8bc4\u5206\u4e0a\u4e0b\u6587\uff1b\u6ca1\u6709\u5305\u65f6\u56de\u9000\u5185\u7f6e\u9ed8\u8ba4\u7ef4\u5ea6\uff08studio \u7684 scorer \u8868\uff09
  const dimensions =
    scoringContext?.dimensions?.map((d) => ({ key: d.key, label: d.label })) ||
    FALLBACK_DIMENSIONS.scorer;
  const batchScoreSchema = batchScoreSchemaFor(dimensions);
  const scoreItemSchema = scoreItemSchemaFor(dimensions);
  const weights = weightsFromContext(scoringContext);
  const rubric = buildRubric(dimensions, weights);

  const genderHint = getGenderScoringHint(detection.gender);
  const basePrompt = await getPrompt("scorer", { genderHint: genderHint || undefined }, {
    gender: detection.gender,
    platform: scoringContext?.platformId || undefined,
    primaryCategory: detection.primaryCategory,
    secondaryCategory: detection.secondaryCategory,
  });
  const systemPrompt = basePrompt.includes("\u7537\u9891\u8bc4\u5206\u504f\u597d") || basePrompt.includes("\u5973\u9891\u8bc4\u5206\u504f\u597d")
    ? basePrompt + rubric + "\n\n\u6ce8\u610f\uff1a\u4ee5\u4e0b\u63d0\u4f9b\u7684\u662f\u7ae0\u8282\u6458\u8981\u800c\u975e\u5168\u6587\uff0c\u8bf7\u57fa\u4e8e\u6458\u8981\u5185\u5bb9\u8fdb\u884c\u8bc4\u5206\u3002"
    : basePrompt + (genderHint || "") + rubric + "\n\n\u6ce8\u610f\uff1a\u4ee5\u4e0b\u63d0\u4f9b\u7684\u662f\u7ae0\u8282\u6458\u8981\u800c\u975e\u5168\u6587\uff0c\u8bf7\u57fa\u4e8e\u6458\u8981\u5185\u5bb9\u8fdb\u884c\u8bc4\u5206\u3002";

  const summaryTexts = batch
    .map((s) => { const ch = chapters.find((c) => c.index === s.index); const content = ch?.content || ""; const features = s.features || extractLocalFeaturePack(content); const excerpts = s.keyExcerpts || extractKeyExcerpts(content); return `【index:${s.index}】【${s.title}】\n摘要：${s.summary}\n情感节奏：${s.emotionalBeat}\n本地特征包：${JSON.stringify(features)}\n关键片段：${excerpts.join("\n---\n")}`; })
  /*
    .map((s) => `\u3010index:${s.index}\u3011\u3010${s.title}\u3011\n\u6458\u8981\uff1a${s.summary}\n\u60c5\u611f\u8282\u594f\uff1a${s.emotionalBeat}`)
    .join("\n\n---\n\n"); */

  const { object } = await safeGenerateObject({
    model: openai(model),
    system: systemPrompt,
    prompt: `请按维度选择输入：剧情张力/爽点使用情绪曲线与关键片段；文笔使用句长、对白和原文片段；人设/世界观使用实体与关键词；创新性使用关键词和重复度；通用质量与赛道适配度分开评分。以下章节包含摘要、本地特征包和关键片段：

上下文：${styleContext}

${summaryTexts}

【重要】输出格式要求：
你必须返回一个包含 ${batch.length} 个评分对象的数组，每个对象对应一个章节。格式如下：
{
  "scores": [
    {
      "index": 0,
      "scores": {
${dimensions.map((d) => `        "${d.key}": { "score": 7, "comment": "${d.label}点评..." }`).join(",\n")}
      },
      "summary": "一句话总结",
      "emotionalBeat": "平静→冲突→爆发"
    },
    ... 其余章节的评分
  ]
}

注意：index 必须与输入摘要中的 【index:N】 对应，不要遗漏任何章节！
评语要求：每个维度的 comment 只写结论和一个最关键的问题/优点，限 25-40 字；禁止复述剧情过程、罗列多个问题或使用“本章主要围绕……”等套话。`,
    schema: batchScoreSchema,
    maxTokens: 16384,
  });

  // 校验：所有章节都必须有评分
  const scoreItems = object.scores as z.infer<typeof scoreItemSchema>[];
  const returned = new Map(scoreItems.map((s) => [s.index, s]));
  const chapterMap = new Map(chapters.map((c) => [c.index, c]));

  // 检查返回的评分数是否与批次大小匹配
  if (scoreItems.length !== batch.length) {
    console.warn(`[batchScore] 评分数不匹配: 期望 ${batch.length} 章，实际 ${scoreItems.length} 章`);
    // 如果模型只返回了部分评分，尝试使用已有的评分
    if (scoreItems.length === 0) {
      throw new Error(`模型未返回任何评分，请重试`);
    }
  }

  const results: ChapterScore[] = [];
  for (const s of batch) {
    const found = returned.get(s.index) as z.infer<typeof scoreItemSchema> | undefined;
    if (!found) {
      throw new Error(`评分缺失：第${s.index + 1}章「${s.title}」（模型返回了 ${scoreItems.length} 章评分，但不包含此章）`);
    }

    const scores = found.scores as DimensionScores;
    const ch = chapterMap.get(s.index);

    results.push({
      index: s.index,
      title: s.title,
      wordCount: ch?.wordCount || 0,
      scores,
      weightedTotal: calculateWeightedTotal(scores, weights),
      summary: found.summary,
      emotionalBeat: found.emotionalBeat,
      weakestDimensions: findWeakestDimensions(scores, weights, 2),
    });
  }

  return results;
}

export { chunk };
