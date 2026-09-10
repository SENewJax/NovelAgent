/**
 * 合并全局分析 + 型判定 Agent
 *
 * 将原来两次独立的 AI 调用（analyzeGlobal + detectType）合并为一次，
 * 省 1 次完整前 3 章 prompt 传输和 1 次模型调用。
 */

import { safeGenerateObject } from "@/lib/safe-generate";
import { z } from "zod";
import { Chapter, CategoryDetection, Gender } from "@/scoring/types";
import { createAIClient, getConfig } from "@/lib/config";
import { getPrompt, loadActivePack } from "@/lib/prompt-registry";
import { resolveCategory, taxonomyPrompt } from "@/lib/taxonomy";
import type { PackGender } from "@/lib/config-pack-protocol";
import type { GlobalAnalysis } from "@/agents/analyst";

const combinedSchema = z.object({
  // ── 全局分析字段 ──
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
  // ── 分类判定字段 ──
  gender: z.enum(["male", "female"]),
  primary_category: z.string(),
  secondary_category: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const COMBINED_SYSTEM = `你是一位资深网文编辑，同时负责两个任务：

## 任务一：全局分析
分析小说的风格、世界观、人设，输出 style、world、characters、overall_comment 字段。

## 任务二：分类判定
分析小说内容，反推频道（男频/女频）与主分类、次分类。主分类必须从下方候选清单中选取，不要自创。

### 频道判定依据
- 主角性别和设定（男频以男主为主，女频以女主为主）
- 情感线权重（男频辅助15%，女频核心或重要辅助30-40%）
- 爽感来源：男频=力量/权力/地位展示，女频=能力认可/尊严回收/价值实现
- 台词风格：男频短狠炸，女频清醒有力带情绪

## 输出要求
返回严格的 JSON，包含以下字段：
- style: { genre, tone, narrative, summary }（每个字段不超过 1 句话）
- world: { setting, rules: string[], summary, mapAnalysis }（mapAnalysis 必须包含 verdict、score、summary、keyLocations、ranges、recommendations）
- characters: [{ name, oneLiner, type }]（最多 3 个角色）
- overall_comment: 整体评论（不超过 3 句话）
- gender: "male" 或 "female"
- primary_category: 主分类 id，必须来自候选清单
- secondary_category: 次分类 id（可选，同样来自候选清单）
- confidence: 0-1 置信度
- reasoning: 判定理由（不超过 2 句话）

【重要】输出要简洁，所有字段加起来不超过 2000 字。只输出 JSON，不要包含其他文字。`;

export interface CombinedAnalysisResult {
  globalAnalysis: GlobalAnalysis;
  categoryDetection: CategoryDetection;
}

/**
 * 合并全局分析 + 分类判定：一次 AI 调用同时产出两者
 *
 * 取前 3 章内容，用主模型（config.ai.model）保证分析质量。
 */
export async function analyzeGlobalAndCategory(
  chapters: Chapter[],
  hintGender?: Gender
): Promise<CombinedAnalysisResult> {
  const openai = await createAIClient();
  const config = await getConfig();

  // 取前 3 章内容（每章截断前 2000 字，避免 prompt 过长）
  const sampleText = chapters
    .slice(0, Math.min(3, chapters.length))
    .map((ch) => `【${ch.title}】\n${ch.content.slice(0, 2000)}`)
    .join("\n\n---\n\n");

  const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);

  const hintPrompt = hintGender
    ? `\n\n【用户提示】用户已指定本文性别为${hintGender === "male" ? "男频" : "女频"}，请在判定时参考此信息。`
    : "";

  // 候选清单来自配置包词表，与独立的 detectCategory 走同一套词表和归一规则
  const pack = await loadActivePack();
  const hintChannel: PackGender | undefined =
    hintGender === "male" || hintGender === "female" ? hintGender : undefined;
  const candidates = taxonomyPrompt(pack?.taxonomy, hintChannel);

  // 尝试从 Registry 获取合并 prompt，回退到硬编码
  const analystPrompt = await getPrompt("analyst", {});
  const typePrompt = await getPrompt(
    "type-detector",
    { taxonomy: candidates },
    { gender: hintGender }
  );

  const basePrompt = analystPrompt && typePrompt
    ? analystPrompt + "\n\n---\n\n" + typePrompt + "\n\n只输出 JSON，不要包含其他文字。"
    : COMBINED_SYSTEM;
  const systemPrompt =
    basePrompt + (candidates ? `\n\n## 分类候选清单\n${candidates}` : "");

  const { object } = await safeGenerateObject({
    model: openai(config.ai.model),
    system: systemPrompt,
    prompt: `请分析以下小说（共${chapters.length}章，约${totalWords}字），同时完成全局分析和分类判定。world.mapAnalysis 为必填对象，必须完整包含 verdict、score、summary、keyLocations、ranges、recommendations，不得省略；没有地点、区间或建议时输出空数组。\n\n以下是前${Math.min(3, chapters.length)}章的内容：\n\n${sampleText}${hintPrompt}`,
    schema: combinedSchema,
    maxTokens: 8192,
  });

  // 模型只会返回 male/female，因此判定结果始终落在词表的两个频道内
  const gender: PackGender = hintChannel || object.gender;
  const resolved = resolveCategory(
    pack?.taxonomy,
    gender,
    object.primary_category,
    object.secondary_category ?? ""
  );

  return {
    globalAnalysis: {
      style: object.style,
      world: object.world,
      characters: object.characters,
      overallComment: object.overall_comment,
    },
    categoryDetection: {
      gender,
      primaryCategory: resolved.primaryId,
      primaryLabel: resolved.primaryLabel,
      secondaryCategory: resolved.secondary,
      // 归一到「其他」说明模型选了词表外的分类，置信度不能照搬
      confidence: resolved.inTaxonomy ? object.confidence : Math.min(object.confidence, 0.5),
      reasoning: object.reasoning,
      outOfTaxonomy: resolved.inTaxonomy ? undefined : true,
    },
  };
}
