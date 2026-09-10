import { safeGenerateObject } from "@/lib/safe-generate";
import { z } from "zod";
import { Chapter, StyleInfo, WorldInfo, CharacterInfo } from "@/scoring/types";
import { createAIClient, getConfig } from "@/lib/config";
import { getPrompt } from "@/lib/prompt-registry";

// 分析结果的 Zod Schema
const analysisSchema = z.object({
  style: z.object({
    genre: z.string(),
    tone: z.string(),
    narrative: z.string(),
    summary: z.string(),
  }),
  world: z.object({
    setting: z.string(),
    rules: z.array(z.string()),
    summary: z.string(),
    mapAnalysis: z.object({
      verdict: z.enum(["narrow", "balanced", "broad"]),
      score: z.number().min(0).max(10),
      summary: z.string(),
      keyLocations: z.array(z.object({ name: z.string(), type: z.string(), significance: z.string() })).max(8),
      ranges: z.array(z.object({ startChapter: z.number(), endChapter: z.number(), summary: z.string() })),
      recommendations: z.array(z.string()).max(4),
    }),
  }),
  characters: z.array(
    z.object({
      name: z.string(),
      oneLiner: z.string(),
      type: z.string(),
    })
  ),
  overall_comment: z.string(),
});

const MAP_ANALYSIS_OUTPUT_CONTRACT = `
world.mapAnalysis 为必填对象，必须完整输出以下字段：
- verdict: "narrow" | "balanced" | "broad"
- score: 0-10 的数字
- summary: 空间覆盖结论
- keyLocations: 最多8项，每项包含 name、type、significance
- ranges: 按每100章划分，每项包含 startChapter、endChapter、summary
- recommendations: 最多4条字符串；没有建议时输出空数组
不得省略 mapAnalysis 或其中任何字段。`;

export interface GlobalAnalysis {
  style: StyleInfo;
  world: WorldInfo;
  characters: CharacterInfo[];
  overallComment: string;
}

/**
 * 全局分析：分析小说的风格、世界观、人设
 */
export async function analyzeGlobal(
  chapters: Chapter[]
): Promise<GlobalAnalysis> {
  const openai = await createAIClient();
  const config = await getConfig();

  // 取开篇和每100章边界样本，支持空间覆盖判断，控制 prompt 长度
  const sampleIndexes = Array.from(new Set([0, ...chapters.map((_, i) => i).filter(i => i % 100 === 0), Math.max(0, chapters.length - 1)]));
  const sampleText = sampleIndexes
    .map(i => chapters[i])
    .filter(Boolean)
    .map((ch) => `【${ch.title}】\n${ch.content.slice(0, 2000)}`)
    .join("\n\n---\n\n");

  const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);

  const systemPrompt = await getPrompt("analyst", {});

  const { object } = await safeGenerateObject({
    model: openai(config.ai.model),
    system: systemPrompt,
    prompt: `请分析以下小说（共${chapters.length}章，约${totalWords}字）。除风格、世界观、角色和整体评论外，请进行地图与空间扩展判定：按每100章一个区间，概括主要活动区域、空间覆盖是否过窄，并给出最多4条扩展建议。只输出结论，不罗列抽取过程。\n${MAP_ANALYSIS_OUTPUT_CONTRACT}\n\n以下是开篇及每100章边界的样本：\n\n${sampleText}`,
    schema: analysisSchema,
    maxTokens: 8192,
  });

  return {
    style: object.style,
    world: object.world,
    characters: object.characters,
    overallComment: object.overall_comment,
  };
}
