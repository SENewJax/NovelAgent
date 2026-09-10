/**
 * 加权计算 —— 只做算术，不决定权重。
 *
 * 权重一律由调用方从配置包解析后传入（lib/pack-resolver.ts 的 resolveWeights）。
 * 这里刻意不再保留任何按性别硬编码的权重表：analyzer 一旦自带一份数字，
 * studio 调完权重后两边就会各算一套分，而且没人知道报告用的是哪一套。
 * 缺权重时退回等权，并且这个退化是显式的（source: "balanced"）。
 */
import { balancedWeights } from "@/lib/pack-resolver";
import { DimensionLabelMap, DimensionScores, ScoreBlock, ScoringContext } from "./types";

/** 归一化到 0-1 的权重表，键为维度 key。 */
export type DimensionWeights = Record<string, number>;

/**
 * 计算加权总分。
 *
 * 只按 weights 里出现的维度累加，并按实际命中的权重和归一 ——
 * 评分缺某个维度时（模型漏答、包升级加了新维度），
 * 不归一会让总分凭空缩水，看起来像质量下降。
 */
export function calculateWeightedTotal(scores: DimensionScores, weights: DimensionWeights): number {
  let total = 0;
  let weightSum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const detail = scores[key];
    if (!detail || !Number.isFinite(detail.score)) continue;
    total += detail.score * weight;
    weightSum += weight;
  }
  if (weightSum <= 0) return 0;
  return Math.round((total / weightSum) * 100) / 100;
}

/**
 * 从 LLM 原始输出构建 ScoreBlock。
 *
 * 不信任模型自报的 weighted_total：权重在包里，模型看不到归一后的数值，
 * 它给的总分只能当参考。总分一律本地重算。
 */
export function buildScoreBlock(
  raw: {
    scores: DimensionScores;
    summary: string;
    general_quality?: number;
    category_fit?: number;
    confidence?: number;
  },
  weights: DimensionWeights,
): ScoreBlock {
  return {
    scores: raw.scores,
    weightedTotal: calculateWeightedTotal(raw.scores, weights),
    summary: raw.summary,
    generalQuality: raw.general_quality,
    categoryFit: raw.category_fit,
    confidence: raw.confidence,
  };
}

/**
 * 找出最弱的 N 个维度，按维度表顺序稳定排序。
 *
 * 只看 weights 覆盖的维度：包外的残留键（旧结果里的老维度）不该指导改写方向。
 */
export function findWeakestDimensions(
  scores: DimensionScores,
  weights: DimensionWeights,
  n: number = 2,
): string[] {
  return Object.keys(weights)
    .filter((key) => Number.isFinite(scores[key]?.score))
    .sort((a, b) => scores[a].score - scores[b].score || a.localeCompare(b))
    .slice(0, n);
}

/** 判断改写后目标维度是否全部提升。 */
export function hasImproved(before: ScoreBlock, after: ScoreBlock, targetDimensions: string[]): boolean {
  return targetDimensions.every((dimension) => {
    const previous = before.scores[dimension]?.score;
    const current = after.scores[dimension]?.score;
    if (!Number.isFinite(previous) || !Number.isFinite(current)) return false;
    return current > previous;
  });
}

/** 分数对应的等级，用于报告配色。 */
export function getScoreLevel(score: number): "excellent" | "good" | "average" | "weak" | "poor" {
  if (score >= 9) return "excellent";
  if (score >= 7) return "good";
  if (score >= 5) return "average";
  if (score >= 3) return "weak";
  return "poor";
}

/** 从评分上下文取权重，缺失时按上下文维度表等权兜底。 */
export function weightsFromContext(context?: ScoringContext): DimensionWeights {
  if (context && Object.keys(context.weights).length > 0) return context.weights;
  return balancedWeights(context?.dimensions || []);
}

/**
 * 从评分上下文取维度显示名表。
 *
 * 旧代码用模块级 DIMENSION_LABELS 常量，维度可配置后这个常量必然过期：
 * label 只能来自打分时那一份快照。查不到的 key 由调用方回退到 key 本身。
 */
export function labelsFromContext(context?: ScoringContext): DimensionLabelMap {
  const map: DimensionLabelMap = {};
  for (const d of context?.dimensions || []) map[d.key] = d.label;
  return map;
}
