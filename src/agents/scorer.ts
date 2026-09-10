import { safeGenerateObject } from "@/lib/safe-generate";
import { getGenderScoringHint } from "@/scoring/rubric";
import { buildRubric } from "@/scoring/rubric-builder";
import { buildScoreSchema } from "@/scoring/score-schema";
import { FALLBACK_DIMENSIONS } from "@/lib/fallback-pack";
import { DimensionScores, ScoreBlock, ChapterScore, CategoryDetection, ScoringContext } from "@/scoring/types";
import { calculateWeightedTotal, findWeakestDimensions, weightsFromContext } from "@/scoring/calculator";
import { createAIClient, getConfig } from "@/lib/config";
import { getPrompt } from "@/lib/prompt-registry";
import { withValidation, buildScorerValidator } from "@/lib/validate-retry";
import type { RoleWeights } from "@/scoring/attention";

/** 把一份评分压成提示词里的摘要，键名/标签随维度表，不硬编码 7 维。 */
function renderScoreSummary(block: ScoreBlock): string {
  return Object.entries(block.scores)
    .map(([key, detail]) => `${key}: ${detail.score}分（${detail.comment}）`)
    .join(" ");
}

/**
 * 章节内容截断：评分不需要完整章节，截取首尾即可大幅缩短 prompt。
 * 前 2000 字足以判断文笔/节奏/爽点，后 500 字补充结尾收束。
 */
function truncateContent(content: string, maxLen = 2500): string {
  if (content.length <= maxLen) return content;
  const headLen = 2000;
  const tailLen = maxLen - headLen - 20;
  return content.slice(0, headLen) + "\n……（中略）……\n" + content.slice(-tailLen);
}

/**
 * 输出 schema 按本次评分的维度表生成，避免模型返回的键与权重表错位。
 */
function scoreSchemaFor(context?: ScoringContext) {
  const dimensions =
    context?.dimensions?.map((d) => ({ key: d.key, label: d.label })) ||
    FALLBACK_DIMENSIONS.scorer;
  return buildScoreSchema(dimensions);
}

/**
 * 对单个章节进行评分
 */
export async function scoreChapter(
  chapter: { title: string; content: string; index: number },
  context?: string,
  detection?: CategoryDetection,
  scoringContext?: ScoringContext
): Promise<ChapterScore> {
  const openai = await createAIClient();
  const config = await getConfig();
  const model = config.ai.scoreModel || config.ai.model;

  const dimensions =
    scoringContext?.dimensions?.map((d) => ({ key: d.key, label: d.label })) ||
    FALLBACK_DIMENSIONS.scorer;
  const weights = weightsFromContext(scoringContext);
  const scoreSchema = scoreSchemaFor(scoringContext);

  // rubric 由维度表 + 权重渲染；包下发的权重在这里体现为「（权重N%）」
  const rubric = buildRubric(dimensions, weights);
  const genderHint = getGenderScoringHint(detection?.gender);
  const basePrompt = await getPrompt("scorer", { genderHint: genderHint || undefined }, {
    gender: detection?.gender,
    platform: scoringContext?.platformId || undefined,
    primaryCategory: detection?.primaryCategory,
    secondaryCategory: detection?.secondaryCategory,
  });
  // 回退时无模板，手动追加 genderHint；有模板时模板已渲染 genderHint
  const systemPrompt = basePrompt.includes("男频评分偏好") || basePrompt.includes("女频评分偏好")
    ? basePrompt + rubric
    : basePrompt + genderHint + rubric;

  const validateScores = buildScorerValidator(weights as unknown as RoleWeights);

  // 输出校验 + 重试：高权重维度必须有非空评语，否则带反馈重新评分
  const { result: object } = await withValidation(
    async (feedback) => {
      const { object } = await safeGenerateObject({
        model: openai(model),
        system: systemPrompt,
        prompt: `请按评分标准对以下章节进行${dimensions.length}维度评分。每个维度的评语只写结论和一个最关键的问题/优点，限25-40字；禁止复述剧情过程、罗列多个问题或使用套话。\n${context ? `\n上下文信息：${context}\n` : ""}\n【${chapter.title}】\n\n${truncateContent(chapter.content)}${feedback ? `\n\n【校验反馈】${feedback}` : ""}`,
        schema: scoreSchema,
      });
      return object;
    },
    (obj) => validateScores(obj.scores),
    1
  );

  const scores: DimensionScores = object.scores;
  const weightedTotal = calculateWeightedTotal(scores, weights);
  const weakestDimensions = findWeakestDimensions(scores, weights, 2);

  return {
    index: chapter.index,
    title: chapter.title,
    wordCount: chapter.content.length,
    scores,
    weightedTotal,
    summary: object.summary,
    emotionalBeat: object.emotional_beat,
    weakestDimensions,
  };
}

/**
 * 对改写后的文本重新打分
 */
export async function rescoreText(
  text: string,
  chapterTitle: string,
  originalScores?: ScoreBlock,
  detection?: CategoryDetection,
  scoringContext?: ScoringContext
): Promise<ScoreBlock> {
  const openai = await createAIClient();
  const config = await getConfig();
  const model = config.ai.scoreModel || config.ai.model;

  const context = originalScores
    ? `\n原章节评分参考：总分${originalScores.weightedTotal}分${renderScoreSummary(originalScores)}`
    : "";

  const genderHint2 = getGenderScoringHint(detection?.gender);
  const basePrompt2 = await getPrompt("scorer", { genderHint: genderHint2 || undefined }, {
    gender: detection?.gender,
    platform: scoringContext?.platformId || undefined,
    primaryCategory: detection?.primaryCategory,
    secondaryCategory: detection?.secondaryCategory,
  });
  // 与 scoreChapter 一致：追加 rubric（含 1-10 分标准与输出结构），否则模型会按 0-100 打分导致校验失败。
  const rubric2 = buildRubric(
    scoringContext?.dimensions?.map((d) => ({ key: d.key, label: d.label })) || FALLBACK_DIMENSIONS.scorer,
    weightsFromContext(scoringContext),
  );
  const systemPrompt2 = basePrompt2.includes("男频评分偏好") || basePrompt2.includes("女频评分偏好")
    ? basePrompt2 + rubric2
    : basePrompt2 + genderHint2 + rubric2;

  const weights = weightsFromContext(scoringContext);
  const scoreSchema2 = scoreSchemaFor(scoringContext);
  const validateScores2 = buildScorerValidator(weights as unknown as RoleWeights);

  // 输出校验 + 重试
  const { result: object } = await withValidation(
    async (feedback) => {
      const { object } = await safeGenerateObject({
        model: openai(model),
        system: systemPrompt2,
        prompt: `请对以下改写后的章节进行评分。${context}\n\n【${chapterTitle}】\n\n${truncateContent(text)}${feedback ? `\n\n【校验反馈】${feedback}` : ""}`,
        schema: scoreSchema2,
      });
      return object;
    },
    (obj) => validateScores2(obj.scores),
    1
  );

  return {
    scores: object.scores,
    weightedTotal: calculateWeightedTotal(object.scores, weights),
    summary: object.summary,
  };
}
