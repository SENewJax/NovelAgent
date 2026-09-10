// 型判定 Agent — 分析小说内容，反推性别/型/赛道

import { safeGenerateObject } from "@/lib/safe-generate";
import { z } from "zod";
import { CategoryDetection, Gender, Chapter } from "@/scoring/types";
import { createAIClient, getConfig } from "@/lib/config";
import { getPrompt, loadActivePack } from "@/lib/prompt-registry";
import { resolveCategory, taxonomyPrompt } from "@/lib/taxonomy";
import type { PackGender } from "@/lib/config-pack-protocol";

const typeDetectionSchema = z.object({
  gender: z.enum(["male", "female"]),
  primary_category: z.string(),
  secondary_category: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const TYPE_DETECTOR_SYSTEM = `你是一位资深网文编辑，精通男频和女频小说的"型"判定体系。

你的任务是分析小说内容，自动反推以下信息：
1. 性别（男频/女频）
2. 型（成长型/身份型/预知型 或 实力逆袭型/身份反转型/情感关系型）
3. 赛道（逆袭/修仙/玄幻/战神/赘婿/霸总/重生/穿越降维/穿越穿书/职场/学霸/医生/穿越修仙/真千金/马甲/虐文言情）

## 判定口诀
### 男频判定口诀
- "看他怎么变强" → 成长型
- "看他何时亮身份" → 身份型
- "看他怎么用预知改命" → 预知型

### 女频判定口诀
- "看她怎么靠本事翻身" → 实力逆袭型
- "看她何时亮身份" → 身份反转型
- "看两人怎么走到一起" → 情感关系型

## 性别判定依据
分析以下特征来判定性别：
- 主角性别和设定（男频以男主为主，女频以女主为主）
- 情感线权重（男频情感线是辅助15%，女频情感线是核心或重要辅助30-40%）
- 爽感来源差异：
  - 男频核心驱动=力量/权力/地位，爽感=力量展示×身份碾压×观众震惊
  - 女频核心驱动=自我价值/尊严/情感独立，爽感=能力认可×尊严回收×价值实现
- 台词风格：男频短狠炸，女频清醒有力带情绪
- 反派动机差异：男频多为利益/权力/嫉妒，女频多为嫉妒/占有欲/身份争夺/情感纠葛

## 型判定表

### 男频三型
| 特征 | 成长型 | 身份型 | 预知型 |
|------|--------|--------|--------|
| 主角起点 | 弱小/落魄，实力低 | 已是巅峰，隐藏实力 | 可高可低，起点非重点 |
| 核心看点 | 变强曲线（怎么变强） | 揭晓时机（何时亮身份） | 信息差（预知如何兑现与递减） |
| 时间结构 | 由弱到强，循序渐进 | 开局即巅峰，扮猪吃虎 | 与"已知的坏结局"赛跑 |
| 爽感来源 | 越级战、突破、逆袭 | 反差打脸、身份曝光 | 认知碾压、改写既定悲剧 |
| 代表赛道 | 逆袭·修仙·玄幻 | 战神·赘婿·霸总 | 重生·穿越 |

### 女频三型
| 特征 | 实力逆袭型 | 身份反转型 | 情感关系型 |
|------|-----------|-----------|-----------|
| 主角起点 | 有本事但被踩在底层 | 真实身份被剥夺/隐藏 | 被辜负、被利用、被蒙蔽 |
| 核心驱动 | 靠本事翻身（能力认可） | 亮身份夺回一切（价值归位） | 看清渣男后清算+与对的人走到一起 |
| 代表赛道 | 职场·学霸·医生 | 穿越修仙·真千金·马甲 | 虐文言情 |

## 输出要求
返回严格的JSON，包含以下字段：
- gender: "male" 或 "female"
- primary_category: 一级分类的 id，必须取自候选清单
- secondary_category: 二级分类名，必须在该一级分类的清单内
- confidence: 0-1之间的置信度
- reasoning: 判定理由（2-3句话）`;

/**
 * 型判定：分析小说内容，反推性别/型/赛道
 * @param chapters 小说章节（取前3章）
 * @param hintGender 可选的用户指定性别（优先使用）
 */
export async function detectType(
  chapters: Chapter[],
  hintGender?: Gender
): Promise<CategoryDetection> {
  const openai = await createAIClient();
  const config = await getConfig();
  const model = config.ai.scoreModel || config.ai.model;

  // 取前3章内容（每章截断前 2000 字，避免 prompt 过长）
  const sampleText = chapters
    .slice(0, Math.min(3, chapters.length))
    .map((ch) => `【${ch.title}】\n${ch.content.slice(0, 2000)}`)
    .join("\n\n---\n\n");

  const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);

  const hintPrompt = hintGender
    ? `\n\n【用户提示】用户已指定本文性别为"${hintGender === "male" ? "男频" : "女频"}"，请在判定时参考此信息。`
    : "";

  // 候选清单来自配置包词表：模型只能在词表内选，越界的结果由 resolveCategory 归一到「其他」
  // 词表只分男频/女频；mixed/unknown 的提示不足以锁定频道，两个频道的候选都要给模型。
  const pack = await loadActivePack();
  const hintChannel: PackGender | undefined =
    hintGender === "male" || hintGender === "female" ? hintGender : undefined;
  const candidates = taxonomyPrompt(pack?.taxonomy, hintChannel);

  // 从 Registry 获取基础 prompt，回退时使用硬编码的 TYPE_DETECTOR_SYSTEM
  const registryPrompt = await getPrompt(
    "type-detector",
    { taxonomy: candidates },
    { gender: hintGender }
  );
  const systemPrompt = (registryPrompt || TYPE_DETECTOR_SYSTEM) +
    (candidates ? `\n\n## 分类候选清单\n${candidates}` : "");

  const { object } = await safeGenerateObject({
    model: openai(model),
    system: systemPrompt,
    prompt: `请分析以下小说（共${chapters.length}章，约${totalWords}字），判定其性别、型和赛道。\n\n以下是前${Math.min(3, chapters.length)}章的内容：\n\n${sampleText}${hintPrompt}`,
    schema: typeDetectionSchema,
    maxTokens: 4096,
  });

  const result = object as z.infer<typeof typeDetectionSchema>;

  // 模型只会返回 male/female，因此判定结果始终落在词表的两个频道内
  const gender: PackGender = hintChannel || result.gender;
  const resolved = resolveCategory(
    pack?.taxonomy,
    gender,
    result.primary_category,
    result.secondary_category
  );

  return {
    gender,
    primaryCategory: resolved.primaryId,
    primaryLabel: resolved.primaryLabel,
    secondaryCategory: resolved.secondary,
    // 归一到「其他」说明模型选了词表外的分类，置信度不能照搬
    confidence: resolved.inTaxonomy ? result.confidence : Math.min(result.confidence, 0.5),
    reasoning: result.reasoning,
    outOfTaxonomy: resolved.inTaxonomy ? undefined : true,
  };
}
