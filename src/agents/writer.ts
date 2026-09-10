import { generateText } from "ai";
import { safeGenerateObject } from "@/lib/safe-generate";
import { z } from "zod";
import { ScoreBlock, Chapter, CategoryDetection, StyleProfile } from "@/scoring/types";
import { getSkillKnowledge } from "@/skills";
import { buildStyleConstraintPrompt } from "@/agents/style-profiler";
import { createAIClient, getConfig } from "@/lib/config";
import { getPrompt } from "@/lib/prompt-registry";

const planSchema = z.object({
  title: z.string(),
  core_event: z.string(),
  emotional_arc: z.string(),
  key_scenes: z.array(z.string()),
  chapter_hook: z.string(),
});

export interface ChapterPlan {
  title: string;
  coreEvent: string;
  emotionalArc: string;
  keyScenes: string[];
  chapterHook: string;
}

/**
 * 根据型+赛道构建写作约束提示
 */
function buildTrackConstraintPrompt(detection: CategoryDetection): string {
  const knowledge = getSkillKnowledge(detection.gender);
  return `
【分类约束】
当前性别: ${detection.gender === "male" ? "男频" : "女频"}
一级分类: ${detection.primaryLabel}
二级分类: ${detection.secondaryCategory}

## 爽点设计参考
${knowledge.satisfaction}

## 结构框架参考
${knowledge.structure}

【反套壳禁令】
- 禁止混用其他赛道的价值观和套路
- 禁止将A赛道的元素机械套用到B赛道
- 所有剧情必须符合当前赛道的核心爽感来源和节奏铁律
`;
}

/**
 * 改写章节
 */
export async function rewriteChapter(
  chapterContent: string,
  chapterTitle: string,
  originalScores: ScoreBlock,
  targetDimensions: string[],
  styleContext: string,
  detection?: CategoryDetection,
  styleProfile?: StyleProfile
): Promise<string> {
  const openai = await createAIClient();
  const config = await getConfig();

  const trackConstraint = detection
    ? buildTrackConstraintPrompt(detection)
    : "";

  const styleConstraint = styleProfile
    ? buildStyleConstraintPrompt(styleProfile)
    : "";

  const baseWriterPrompt = await getPrompt("writer", { trackConstraint: trackConstraint || undefined });
  const systemPrompt = baseWriterPrompt + trackConstraint + styleConstraint;

  const { text } = await generateText({
    model: openai(config.ai.model),
    system: systemPrompt,
    prompt: `## 改写任务

**章节**: ${chapterTitle}
**风格要求**: ${styleContext}
**目标改善维度**: ${targetDimensions.join(", ")}

**当前评分**:
${Object.entries(originalScores?.scores ?? {})
  .map(([key, detail]) => `- ${key}: ${detail.score}分 — ${detail.comment}`)
  .join("\n")}

**原文**:
${chapterContent}

请针对上述薄弱维度进行改写，保留好的部分。直接输出改写后的正文。`,
  });

  return text;
}

/**
 * 生成续写章节规划
 */
export async function planNextChapter(
  lastChapters: Chapter[],
  styleContext: string,
  characters: string,
  detection?: CategoryDetection
): Promise<ChapterPlan> {
  const openai = await createAIClient();
  const config = await getConfig();

  const trackConstraint = detection
    ? buildTrackConstraintPrompt(detection)
    : "";

  const basePlannerPrompt = await getPrompt("planner", { trackConstraint: trackConstraint || undefined });
  const systemPrompt = basePlannerPrompt + trackConstraint;

  const recentContent = lastChapters
    .slice(-2)
    .map((ch) => `【${ch.title}】\n${ch.content.slice(-2000)}`)
    .join("\n\n---\n\n");

  const { object } = await safeGenerateObject({
    model: openai(config.ai.model),
    system: systemPrompt,
    prompt: `## 续写规划任务

**小说风格**: ${styleContext}
**主要角色**: ${characters}

**最近章节内容**:
${recentContent}

请规划下一章的内容。`,
    schema: planSchema,
  });

  return {
    title: object.title,
    coreEvent: object.core_event,
    emotionalArc: object.emotional_arc,
    keyScenes: object.key_scenes,
    chapterHook: object.chapter_hook,
  };
}

/**
 * 生成续写正文
 */
export async function generateContinueText(
  plan: ChapterPlan,
  lastChapters: Chapter[],
  styleContext: string,
  detection?: CategoryDetection,
  styleProfile?: StyleProfile
): Promise<string> {
  const openai = await createAIClient();
  const config = await getConfig();

  const trackConstraint = detection
    ? buildTrackConstraintPrompt(detection)
    : "";

  const styleConstraint = styleProfile
    ? buildStyleConstraintPrompt(styleProfile)
    : "";

  // 根据性别注入台词风格方向
  let dialogueHint = "";
  if (detection?.gender === "male") {
    dialogueHint = "\n台词方向：短、狠、炸（身份/配不配/废物/跪）";
  } else if (detection?.gender === "female") {
    dialogueHint = "\n台词方向：清醒、有力、带情绪（自我/欠我的/清醒/人生）";
  }

  const baseWriterPrompt2 = await getPrompt("writer", { trackConstraint: trackConstraint || undefined });
  const systemPrompt = baseWriterPrompt2 + trackConstraint + styleConstraint + dialogueHint;

  const lastChapterEnd = lastChapters[lastChapters.length - 1]?.content.slice(-1000) || "";

  const { text } = await generateText({
    model: openai(config.ai.model),
    system: systemPrompt,
    prompt: `## 续写任务

**风格要求**: ${styleContext}

**上一章结尾**:
${lastChapterEnd}

**本章规划**:
- 标题: ${plan.title}
- 核心事件: ${plan.coreEvent}
- 情感节奏: ${plan.emotionalArc}
- 关键场景: ${plan.keyScenes.join("、")}
- 章尾钩子: ${plan.chapterHook}

请根据以上规划，写出完整的章节正文（3000-5000字）。直接输出正文。`,
  });

  return text;
}
