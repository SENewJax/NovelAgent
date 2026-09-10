/**
 * 按维度表构建评分输出 schema。
 *
 * scorer / batch-scorer 曾经硬编码 7 个维度 key；维度可配置后，
 * 输出校验必须按包下发的 dimensions.json 生成，否则模型返回的键
 * 与权重表对不上，总和会算成 0。
 */
import { z } from "zod";
import type { DimensionSpec } from "@/lib/config-pack-protocol";

const scoreDetailSchema = z.object({
  score: z.number().min(1).max(10),
  comment: z.string(),
});

/** 单一维度评分 schema。 */
export const scoreDetailZod = scoreDetailSchema;

/**
 * 评分对象的 schema：每个维度一个 score/comment 字段。
 *
 * 不设 .strict() —— 模型可能多输出一两个跨维度指标（general_quality 等），
 * 多余字段在打分场景无害，strict 反而会让一次良性多写变成整本失败。
 */
export function buildDimensionScoresSchema(dimensions: readonly DimensionSpec[]) {
  return z.object(
    Object.fromEntries(dimensions.map((d) => [d.key, scoreDetailSchema])),
  );
}

/** 单章评分 schema：维度 + summary + emotional_beat。 */
export function buildScoreSchema(dimensions: readonly DimensionSpec[]) {
  return z.object({
    scores: buildDimensionScoresSchema(dimensions),
    summary: z.string(),
    emotional_beat: z.string(),
  });
}
