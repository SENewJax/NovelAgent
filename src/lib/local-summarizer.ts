/**
 * 本地摘要提取器（零 AI 依赖）
 *
 * 混合方案：维度关键词提取 + TextRank 补位
 *
 * 1. 按换行拆分段落
 * 2. 扫描 5 个维度的关键词：剧情/感情线/创意/钩子/张力
 * 3. 每维度选得分最高的段落，拼成结构化摘要
 * 4. 维度覆盖不足时，用 TextRank 补位选段
 * 5. 关键词词库推断情感节奏
 */

// ──────────────────────────────────────
// 维度关键词词库
// ──────────────────────────────────────

interface DimEntry {
  label: string;    // 维度标签，如 "剧情"
  keywords: string[];
}

const DIMENSIONS: DimEntry[] = [
  {
    label: "\u5267\u60c5", // 剧情
    keywords: [
      "\u8f6c\u6298", "\u53d1\u73b0", "\u8ba1\u5212", "\u884c\u52a8", "\u7ed3\u679c",
      "\u7a81\u7834", "\u8fdb\u5c55", "\u5e03\u5c40", "\u6536\u7f51", "\u51fa\u624b",
      "\u51b3\u5b9a", "\u51c6\u5907", "\u5f00\u59cb", "\u7ed3\u675f", "\u5b8c\u6210",
      "\u5931\u8d25", "\u6210\u529f", "\u9003\u8dd1", "\u8ffd\u67e3", "\u5305\u56f4",
      "\u63ed\u7a7f", "\u66dd\u5149", "\u5e8a\u7b79", "\u8bbe\u5c40", "\u53cd\u8f6c",
      "\u51fa\u5175", "\u5f00\u6218", "\u6295\u964d", "\u8fdb\u653b", "\u6492\u9000",
    ],
  },
  {
    label: "\u611f\u60c5", // 感情线
    keywords: [
      "\u559c\u6b22", "\u7231", "\u6068", "\u5fc3\u52a8", "\u6697\u604b", "\u8868\u767d",
      "\u8bef\u4f1a", "\u548c\u597d", "\u5206\u624b", "\u60c5\u611f", "\u7231\u6155",
      "\u604b", "\u5a5a", "\u79bb\u522b", "\u91cd\u9022", "\u62b5\u89e6",
      "\u6e29\u67d4", "\u4eb2\u543b", "\u62e5\u62b1", "\u6ce3", "\u54ed",
      "\u7ea2\u773c", "\u5fc3\u75db", "\u5fc3\u7597", "\u5ac9\u5992", "\u60ca\u8bb6",
      "\u611f\u52a8", "\u6b23\u6170", "\u5931\u671b", "\u671f\u5f85", "\u7275\u6302",
    ],
  },
  {
    label: "\u521b\u610f", // 创意
    keywords: [
      "\u65b0\u9896", "\u72ec\u7279", "\u5de7\u5999", "\u521b\u65b0", "\u524d\u6240\u672a\u6709",
      "\u522b\u51fa\u5fc3\u88c1", "\u7a81\u5174", "\u53e6\u7c7b", "\u72ec\u4e00\u65e0\u4e8c",
      "\u610f\u5916", "\u60ca\u8bb6", "\u4e0d\u53ef\u601d\u8bae", "\u732b\u5c3d", "\u5947\u601d\u5999\u60f3",
      "\u7075\u611f", "\u5949\u5993", "\u5929\u624d", "\u7a7f\u8d8a", "\u91cd\u751f",
      "\u91d1\u624b\u6307", "\u91d1\u7c97\u817f", "\u7a7f\u8d8a\u8005", "\u7cfb\u7edf",
      "\u91d1\u624b\u6307", "\u7b7e\u5230", "\u91d1\u724c", "\u91d1\u8eab", "\u91d1\u773c",
    ],
  },
  {
    label: "\u94a9\u5b50", // 钩子
    keywords: [
      "\u60ac\u5ff5", "\u7591\u95ee", "\u5230\u5e95", "\u7a76\u7adf", "\u4e3a\u4ec0\u4e48",
      "\u7136\u800c", "\u7a81\u7136", "\u4f46\u662f", "\u53ef\u6015", "\u60ca\u60f9",
      "\u6765\u4e86", "\u51fa\u73b0", "\u96be\u4ee5\u7f6e\u4fe1", "\u4e0d\u6562\u76f8\u4fe1",
      "\u8be1\u5f02", "\u5947\u602a", "\u795e\u79d8", "\u9690\u85cf", "\u672a\u77e5",
      "\u4e0d\u77e5\u9053", "\u6478\u4e0d\u900f", "\u770b\u4e0d\u61c2", "\u731c\u4e0d\u900f",
      "\u7a76\u7adf", "\u5230\u5e95\u662f\u8c01", "\u4e0d\u77e5\u6240\u63aa", "\u8feb\u8fd1",
      "\u4e34\u8fd1", "\u5c06\u8981", "\u5373\u5c06", "\u773c\u770b",
    ],
  },
  {
    label: "\u5f20\u529b", // 张力
    keywords: [
      "\u51b2\u7a81", "\u5bf9\u6297", "\u5371\u673a", "\u7d27\u8feb", "\u5a01\u80c1",
      "\u538b\u8feb", "\u6c7b\u6218", "\u5355\u6311", "\u7ea6\u6218", "\u6224\u6597",
      "\u8ffd\u67e0", "\u5305\u56f4", "\u7d2f\u6355", "\u6740\u610f", "\u6740\u6212",
      "\u5c4d\u4f53", "\u8d4c\u535a", "\u52ab\u6301", "\u5371\u9669", "\u60ca\u9669",
      "\u6fc0\u6218", "\u8150\u70c2", "\u72c2\u7206", "\u7206\u53d1", "\u6602\u8d35",
      "\u8feb\u4e0d\u53ca\u5f85", "\u5339\u9a6c\u8d76\u5230", "\u5343\u94a9\u4e00\u53d1",
      "\u6025", "\u5fd9", "\u4e71", "\u60ca\u614c",
    ],
  },
];

// ──────────────────────────────────────
// 情感关键词词库
// ──────────────────────────────────────

const EMOTION_LEXICON: Record<string, string[]> = {
  "\u5e73\u9759": ["\u65e5\u5e38", "\u4f11\u606f", "\u95f2", "\u5e73\u6de1", "\u5b89\u9759", "\u60a0\u95f2", "\u95f2\u804a", "\u95f2\u9002", "\u6563\u6b65"],
  "\u9707\u60ca": ["\u9707\u60ca", "\u610f\u5916", "\u7adf\u7136", "\u5c45\u7136", "\u4e0d\u53ef\u601d\u8bae", "\u50bb\u773c", "\u61f5", "\u60ca\u8bb6", "\u9a87\u7136", "\u9519\u6124", "\u6124", "\u6106\u903c", "\u6106\u7136", "\u6106\u61f5"],
  "\u6124\u6012": ["\u6012", "\u6c14", "\u6124", "\u6068", "\u6012\u6025", "\u66b4\u6012", "\u6012\u706b", "\u6076\u6012", "\u8ba8\u538c", "\u6124\u6124\u4e0d\u5e73", "\u6c14\u6124", "\u6012\u4e0d\u53ef\u904f"],
  "\u60b2\u4f24": ["\u60b2", "\u75db", "\u54ed", "\u60b2\u4f24", "\u4e07\u5ff5\u4ff1\u7070", "\u60b2\u75db", "\u54c0", "\u6ce3", "\u6cea", "\u4f24\u5fc3", "\u60c5\u7136"],
  "\u5f00\u5fc3": ["\u7b11", "\u559c", "\u4e50", "\u9ad8\u5174", "\u6fc0\u52a8", "\u6b22\u559c", "\u6b23\u6170", "\u6109\u60a6", "\u5f00\u5fc3", "\u5174\u594b", "\u723d\u5feb", "\u9171"],
  "\u7d27\u5f20": ["\u5371\u9669", "\u6218\u6597", "\u5a01\u80c1", "\u7d27\u6025", "\u6050\u60e7", "\u7d27\u5f20", "\u5371\u673a", "\u7d27\u8feb", "\u60ca\u6050", "\u6740\u610f", "\u7d27\u6025\u4e07\u5206"],
  "\u5f97\u610f": ["\u5f97\u610f", "\u54c8\u54c8", "\u653e\u8086", "\u56a3\u5f20", "\u72c2\u5984", "\u50b2\u7136", "\u5f97\u610f\u6d0b\u6d0b", "\u563d\u5f20", "\u731b", "\u723d"],
  "\u91ca\u7136": ["\u91ca\u7136", "\u653e\u5fc3", "\u677e\u4e86\u53e3\u6c14", "\u5b89\u5fc3", "\u7ec8\u4e8e", "\u5e78\u4e8f", "\u5e78\u597d", "\u6123\u7136"],
};

// ──────────────────────────────────────
// 工具函数
// ──────────────────────────────────────

/** 按换行拆分段落，去除空白行和缩进 */
function splitParagraphs(content: string): string[] {
  return content
    .split(/\n/)
    .map((line) => line.replace(/^[\s\u3000]+/, "").replace(/[\s\u3000]+$/, "").trim())
    .filter((line) => line.length > 0);
}

/** 去除标点和空白，只保留正文 */
function cleanText(text: string): string {
  return text.replace(
    /[\s\u3000\u3001\u3002\uff01\uff1f\uff1b\uff0c\uff1a\uff08\uff09\u201c\u201d\u2018\u2019\u300a\u300b\u3010\u3011]/g,
    ""
  );
}

/** 提取字符 bigram 集合 */
function extractBigrams(text: string): Set<string> {
  const cleaned = cleanText(text);
  const bigrams = new Set<string>();
  for (let i = 0; i < cleaned.length - 1; i++) {
    bigrams.add(cleaned.slice(i, i + 2));
  }
  return bigrams;
}

/** Jaccard 相似度 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

// ──────────────────────────────────────
// TextRank（补位用）
// ──────────────────────────────────────

function textRank(sentences: string[], damping = 0.85, iterations = 20): number[] {
  const n = sentences.length;
  if (n === 0) return [];
  if (n === 1) return [1];

  const bigrams = sentences.map(extractBigrams);
  const graph: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const rowSums = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = jaccardSimilarity(bigrams[i], bigrams[j]);
      if (sim > 0) {
        graph[i][j] = sim;
        graph[j][i] = sim;
        rowSums[i] += sim;
        rowSums[j] += sim;
      }
    }
  }

  let scores = new Array(n).fill(1 / n);
  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        if (i === j || rowSums[j] === 0) continue;
        sum += (graph[j][i] / rowSums[j]) * scores[j];
      }
      newScores[i] = (1 - damping) / n + damping * sum;
    }
    scores = newScores;
  }

  return scores;
}

// ──────────────────────────────────────
// 维度关键词评分
// ──────────────────────────────────────

/**
 * 对每段按各维度评分，选出每维度最佳段
 *
 * @returns 结构化摘要，如 "【剧情】xxx；【感情】yyy；【钩子】zzz"
 */
function dimensionBasedSummary(paragraphs: string[]): string {
  const selected: { label: string; text: string }[] = [];
  const usedIndices = new Set<number>();

  for (const dim of DIMENSIONS) {
    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      if (usedIndices.has(i)) continue;
      const para = paragraphs[i];
      let score = 0;
      for (const kw of dim.keywords) {
        let idx = 0;
        while ((idx = para.indexOf(kw, idx)) >= 0) {
          score++;
          idx += kw.length;
        }
      }
      // 归一化：关键词密度 = 命中次数 / 段落长度
      const density = score / Math.max(para.length, 1) * 100;
      if (density > bestScore) {
        bestScore = density;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestScore > 0) {
      selected.push({ label: dim.label, text: paragraphs[bestIdx] });
      usedIndices.add(bestIdx);
    }
  }

  return selected.map((s) => `\u3010${s.label}\u3011${s.text}`).join("\uff1b");
}

// ──────────────────────────────────────
// 情感节奏提取
// ──────────────────────────────────────

function extractEmotionalBeat(paragraphs: string[]): string {
  const emotions: string[] = [];
  let lastEmotion = "\u5e73\u9759";

  for (const para of paragraphs) {
    let bestEmotion = "";
    let bestCount = 0;

    for (const [emotion, keywords] of Object.entries(EMOTION_LEXICON)) {
      let count = 0;
      for (const kw of keywords) {
        let idx = 0;
        while ((idx = para.indexOf(kw, idx)) >= 0) {
          count++;
          idx += kw.length;
        }
      }
      if (count > bestCount) {
        bestCount = count;
        bestEmotion = emotion;
      }
    }

    const current = bestEmotion || lastEmotion;
    if (emotions.length === 0 || emotions[emotions.length - 1] !== current) {
      emotions.push(current);
    }
    lastEmotion = current;
  }

  return emotions.length > 0 ? emotions.join("\u2192") : "\u5e73\u9759";
}

// ──────────────────────────────────────
// 导出：本地章节摘要
// ──────────────────────────────────────

export interface LocalSummaryResult {
  summary: string;
  emotionalBeat: string;
}

/**
 * 本地摘要提取（无 AI 调用，纯文本处理）
 *
 * 混合策略：
 * 1. 优先用维度关键词提取（剧情/感情/创意/钩子/张力）
 * 2. 维度覆盖不足时用 TextRank 补位
 * 3. 情感节奏由关键词词库推断
 *
 * @param content 章节全文
 * @returns { summary, emotionalBeat }
 */
export function localSummarizeChapter(content: string): LocalSummaryResult {
  const paragraphs = splitParagraphs(content);

  if (paragraphs.length === 0) {
    return { summary: "", emotionalBeat: "\u5e73\u9759" };
  }

  // 段落太少时直接全部返回
  if (paragraphs.length <= 5) {
    return {
      summary: paragraphs.join("\uff1b"),
      emotionalBeat: extractEmotionalBeat(paragraphs),
    };
  }

  // 1. 维度关键词提取
  let summary = dimensionBasedSummary(paragraphs);

  // 2. 维度覆盖不足时用 TextRank 补位
  //    维度提取至少应选出 2 个段落，否则说明关键词不匹配，用 TextRank
  const dimCount = (summary.match(/\u3010/g) || []).length;
  if (dimCount < 2) {
    const scores = textRank(paragraphs);
    const topN = Math.min(5, Math.max(3, Math.floor(paragraphs.length / 10)));
    const ranked = scores
      .map((score, i) => ({ score, i }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map((x) => x.i)
      .sort((a, b) => a - b);

    summary = ranked.map((i) => paragraphs[i]).join("\uff1b");
  }

  const emotionalBeat = extractEmotionalBeat(paragraphs);

  return { summary, emotionalBeat };
}
