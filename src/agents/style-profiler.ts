import { safeGenerateObject } from "@/lib/safe-generate";
import { z } from "zod";
import { Chapter, StyleProfile } from "@/scoring/types";
import { createAIClient, getConfig } from "@/lib/config";

const styleProfileSchema = z.object({
  sentence_rhythm: z.string(),
  dialogue_habits: z.string(),
  narrative_voice: z.string(),
  vocabulary: z.string(),
  scene_habits: z.string(),
  signature_phrases: z.array(z.string()),
  sample_excerpts: z.array(z.string()),
  summary: z.string(),
});

const PROFILER_SYSTEM = `你是一位资深的文学编辑，擅长文体学分析。你的任务是从原文中提取作者的"风格指纹"——那些让读者一眼认出"这是同一个作者写的"的深层写作习惯。

分析要求：
1. **句式节奏**：平均句长、长短句交错方式、段落长度习惯（如：喜用短段落/长段落、单句成段的频率）
2. **对话习惯**：对话占比、对话引导词偏好（"说/道/开口/冷笑"）、对话中是否带动作插入、标点习惯（省略号/破折号/感叹号频率）
3. **叙事视角与声音**：人称、叙事腔调（冷峻/诙谐/煽情）、心理描写是直白还是含蓄、是否爱插科打诨或吐槽
4. **词汇特征**：口语化程度、时代感用词、特色语气词（"啧/哼/好家伙"）、是否爱用网络用语或古风词
5. **场景与描写习惯**：动作戏/心理戏/环境描写比例、场景转换方式（硬切/过渡句）、章末收笔习惯
6. **口头禅**：作者反复使用的词语、句式、转场语（如"话说""且说""另一边"）
7. **原文摘录**：从提供的文本中原样摘录3段最能代表该作者风格的片段（每段100-200字，必须逐字引用，不得改写）

注意：你要提取的是"习惯"而非"内容"——关注怎么写，而不是写了什么。`;

/**
 * 从原文章节中深度提取作者风格指纹
 *
 * @param chapters 用于提取的原始章节（建议使用未被改写的原始内容）
 */
export async function extractStyleProfile(
  chapters: Chapter[]
): Promise<StyleProfile> {
  const openai = await createAIClient();
  const config = await getConfig();

  // 采样策略：首章 + 中间一章 + 末章，覆盖作者风格全貌
  // 每章截取前2500字，控制 prompt 长度
  const samples: Chapter[] = [];
  if (chapters.length > 0) samples.push(chapters[0]);
  if (chapters.length > 2) samples.push(chapters[Math.floor(chapters.length / 2)]);
  if (chapters.length > 1) samples.push(chapters[chapters.length - 1]);

  const sampleText = samples
    .map((ch) => `【${ch.title}】\n${ch.content.slice(0, 2500)}`)
    .join("\n\n---\n\n");

  const { object } = await safeGenerateObject({
    model: openai(config.ai.model),
    system: PROFILER_SYSTEM,
    prompt: `请分析以下${samples.length}个章节样本，提取该作者的风格指纹：\n\n${sampleText}`,
    schema: styleProfileSchema,
  });

  return {
    sentenceRhythm: object.sentence_rhythm,
    dialogueHabits: object.dialogue_habits,
    narrativeVoice: object.narrative_voice,
    vocabulary: object.vocabulary,
    sceneHabits: object.scene_habits,
    signaturePhrases: object.signature_phrases,
    sampleExcerpts: object.sample_excerpts,
    summary: object.summary,
    extractedAt: new Date().toISOString(),
  };
}

/**
 * 将风格指纹渲染为可注入 prompt 的约束文本
 */
export function buildStyleConstraintPrompt(profile: StyleProfile): string {
  const excerpts = profile.sampleExcerpts
    .slice(0, 2)
    .map((e, i) => `【锚点${i + 1}】\n${e}`)
    .join("\n\n");

  return `
【作者风格指纹 — 必须严格模仿，禁止"作者换人"】
风格总述：${profile.summary}

1. 句式节奏：${profile.sentenceRhythm}
2. 对话习惯：${profile.dialogueHabits}
3. 叙事声音：${profile.narrativeVoice}
4. 词汇特征：${profile.vocabulary}
5. 场景习惯：${profile.sceneHabits}
${profile.signaturePhrases.length > 0 ? `6. 作者口头禅/高频表达：${profile.signaturePhrases.join("、")}` : ""}

【风格锚点（原文片段，新写内容需与这些片段读起来像同一人所写）】
${excerpts}

【风格一致性铁律】
- 句长节奏、段落切分方式必须与原文一致
- 对话引导词、标点习惯必须沿用原文
- 禁止引入原文没有的叙事腔调（如原文冷峻，禁止突然煽情抒情）
- 禁止使用原文从未出现的词汇风格（如原文口语化，禁止突然书面化/文艺腔）
`;
}
