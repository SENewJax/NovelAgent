import { generateText } from "ai";
import { createAIClient, getConfig } from "@/lib/config";
import { safeGenerateObject } from "@/lib/safe-generate";
import { z } from "zod";

const DETECT_SYSTEM = `你是一个小说内容审核专家。你的任务是判断给定的文本片段是否属于正常的小说正文内容。

需要识别的异常内容包括（但不限于）：
- 广告/推广信息（产品推荐、付费链接、二维码等）
- 作者声明/公告（求订阅、求月票、免责声明等）
- 平台水印/版权声明（非剧情内容）
- 引流信息（公众号、QQ群、微信群等）
- 与小说剧情完全无关的插入内容
- 乱码或无意义重复

评分标准：
- 0-2分：正常小说内容（对话、描写、叙述、心理活动等）
- 3-5分：灰色地带（可能是作者话外音但仍有信息量）
- 6-10分：明确的广告/垃圾/非正文内容`;

const detectSchema = z.object({
  score: z.number().min(0).max(10).describe("广告/异常评分，0=正常小说内容，10=纯广告"),
  isAd: z.boolean().describe("是否为广告/异常内容（score>=6则为true）"),
  reason: z.string().describe("判断理由，一句话说明"),
});

export interface DetectResult {
  segment: string;
  score: number;
  isAd: boolean;
  reason: string;
}

/**
 * 检测单个文本片段是否为广告/异常内容
 */
async function detectSegment(text: string): Promise<DetectResult> {
  const openai = await createAIClient();
  const config = await getConfig();

  // 过短的片段跳过检测，直接认为是正常的
  if (text.trim().length < 10) {
    return { segment: text, score: 0, isAd: false, reason: "过短片段，跳过" };
  }

  try {
    const { object } = await safeGenerateObject({
      model: openai(config.ai.scoreModel || config.ai.model),
      system: DETECT_SYSTEM,
      prompt: `请判断以下文本片段是否为正常的小说内容：\n\n---\n${text}\n---`,
      schema: detectSchema,
    });

    return {
      segment: text,
      score: object.score,
      isAd: object.isAd,
      reason: object.reason,
    };
  } catch {
    return { segment: text, score: 0, isAd: false, reason: "检测失败，保留原文" };
  }
}

/**
 * 将文本按段落分割为检测单元
 * 策略：按空行或明显分隔符分割
 */
function splitIntoSegments(text: string): string[] {
  // 按空行分割
  const segments = text.split(/\n\s*\n/).filter((s) => s.trim().length > 0);

  // 如果只有一个段落，按句号分割
  if (segments.length <= 1) {
    const sentences = text.match(/[^。！？\n]+[。！？\n]?/g) || [text];
    // 每3-5句合并为一个检测单元
    const merged: string[] = [];
    for (let i = 0; i < sentences.length; i += 4) {
      merged.push(sentences.slice(i, i + 4).join(""));
    }
    return merged;
  }

  return segments;
}

/**
 * 广告检测 Pipeline
 * 输入：完整章节文本
 * 输出：清理后的文本 + 检测报告
 */
export async function removeAds(
  text: string,
  onProgress?: (msg: string) => void
): Promise<{
  cleanText: string;
  report: {
    totalSegments: number;
    adsRemoved: number;
    details: DetectResult[];
  };
}> {
  const segments = splitIntoSegments(text);
  const results: DetectResult[] = [];
  const cleanSegments: string[] = [];

  onProgress?.(`🔍 检测到 ${segments.length} 个文本片段，开始广告检测...`);

  // 批量检测（每批5个，控制并发）
  const BATCH_SIZE = 5;
  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map((seg) => detectSegment(seg))
    );

    for (const result of batchResults) {
      results.push(result);
      if (!result.isAd) {
        cleanSegments.push(result.segment);
      }
    }

    const progress = Math.min(i + BATCH_SIZE, segments.length);
    onProgress?.(`🔍 广告检测进度: ${progress}/${segments.length}`);
  }

  const adsRemoved = results.filter((r) => r.isAd).length;

  onProgress?.(`✅ 广告检测完成: 移除 ${adsRemoved}/${segments.length} 个异常片段`);

  return {
    cleanText: cleanSegments.join("\n\n"),
    report: {
      totalSegments: segments.length,
      adsRemoved,
      details: results.filter((r) => r.isAd),
    },
  };
}
