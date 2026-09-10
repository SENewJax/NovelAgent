import { createHash } from "crypto";
import { Chapter, LocalFeaturePack } from "@/scoring/types";

export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

export function extractLocalFeaturePack(content: string): LocalFeaturePack {
  const paragraphs = content.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const sentences = content.split(/[。！？!?]+/).map((s) => s.trim()).filter(Boolean);
  const dialogueChars = (content.match(/[“「『][^”」』]*[”」』]/g) || []).join("").length;
  const shortSentences = sentences.filter((s) => s.length <= 15).length;
  const emotionHits = (content.match(/怒|惊|喜|悲|怕|恨|爱|哭|笑|颤|疯|痛/g) || []).length;
  const tail = content.slice(-400);
  const hookHits = (tail.match(/突然|竟然|没想到|是谁|为什么|却见|就在这时|秘密|真相|危险/g) || []).length;
  const anomalyFlags: string[] = [];
  if (content.trim().length < 200) anomalyFlags.push("内容过短");
  if (/加群|公众号|微信|最新网址|点击下载|本章未完|广告/.test(content)) anomalyFlags.push("疑似广告或站外信息");
  if (paragraphs.some((p) => p.length > 1500)) anomalyFlags.push("异常超长段落");
  const tokens = content.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  const counts = new Map<string, number>(); for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  const keywords = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([x]) => x);
  const namedEntities = [...new Set(content.match(/[\u4e00-\u9fa5]{2,4}(?:哥|姐|师|帝|王|城|国|府|宗|门)/g) || [])].slice(0, 30).map((text) => ({ text, type: /哥|姐|师|帝|王/.test(text) ? "person" as const : "location" as const }));
  const emotionCurve = paragraphs.map((p, i) => ({ position: i / Math.max(paragraphs.length - 1, 1), valence: ((p.match(/喜|笑|胜|暖|爱/g) || []).length - (p.match(/怒|悲|哭|死|恨|痛/g) || []).length), intensity: Math.min(1, ((p.match(/[！？!?]/g) || []).length + 1) / 5) }));
  const repeated = [...counts.values()].filter((n) => n > 1).reduce((a, n) => a + n - 1, 0);
  return { wordCount: content.length, paragraphCount: paragraphs.length, dialogueRatio: Number((dialogueChars / Math.max(content.length, 1)).toFixed(3)), sentenceLengthMean: Number((content.length / Math.max(sentences.length, 1)).toFixed(1)), shortSentenceRatio: Number((shortSentences / Math.max(sentences.length, 1)).toFixed(3)), hookStrength: Math.min(1, hookHits / 4), emotionKeywordDensity: Number((emotionHits / Math.max(content.length, 1) * 1000).toFixed(2)), anomalyFlags, tokens, namedEntities, keywords, emotionCurve, repetitionRate: Number((repeated / Math.max(tokens.length, 1)).toFixed(3)) };
}

export function extractKeyExcerpts(content: string): string[] {
  const mid = Math.floor(content.length / 2);
  return [...new Set([content.slice(0, 350), content.slice(Math.max(0, mid - 175), mid + 175), content.slice(-350)].map((s) => s.trim()).filter(Boolean))];
}
