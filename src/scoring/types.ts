// 评分类型定义
//
// 维度不再硬编码：维度集合由配置包的 dimensions.json 下发，
// 这里只声明「一组维度的评分」这个形状。

// ──────────────────────────────────────
// 性别 / 分类 类型系统
// ──────────────────────────────────────

/** 性别 */
export type Gender = "male" | "female" | "mixed" | "unknown";

/**
 * 分类判定结果（分析时自动反推，写作时手动选择）。
 *
 * 一级/二级分类取自配置包的受控词表 taxonomy.json，不是自由文本 ——
 * 自由文本分类必然漂移（同义不同字、同一频道造出十几个一级分类）。
 * 词表外内容归入 other / 其他，由 lib/taxonomy.ts 的 resolveCategory 归一。
 */
export interface CategoryDetection {
  gender: Gender;
  /** 一级分类的稳定 id，如 "ancient_romance"。落库与匹配用它。 */
  primaryCategory: string;
  /** 一级分类显示名，如 "古代言情"。 */
  primaryLabel: string;
  /** 二级分类名，必须在该一级的 secondary 清单内。 */
  secondaryCategory: string;
  confidence: number;       // 0-1
  reasoning: string;        // 判定理由
  /** 模型给出的分类不在词表内、已被归一到「其他」。 */
  outOfTaxonomy?: boolean;
  alternatives?: Array<{ label: string; confidence: number }>;
  uncertain?: boolean;
}

/** 审稿问题 */
export interface ReviewIssue {
  severity: "fatal" | "warning" | "info";
  category: string;         // "型级" / "赛道级" / "通用"
  description: string;
  suggestion: string;
}

/** 审稿结果 */
export interface ReviewResult {
  passed: boolean;
  issues: ReviewIssue[];
  mnemonic: string;         // "依·渐·越·分" 等口诀
  fatalFlaws: string[];     // 命门命中的问题
}

/** 付费卡点设计 */
export interface PayPointDesign {
  position: string;         // "第10集" / "中段" 等
  strategy: string;         // 卡点策略描述
}

// ──────────────────────────────────────
// 评分基础类型
// ──────────────────────────────────────

export interface ScoreDetail {
  score: number; // 1-10
  comment: string; // 1-2句点评
}

/**
 * 一组维度评分。键即配置包 dimensions.json 里的维度 key。
 *
 * 刻意不写成固定 7 键：维度集合归 studio 管，写死在类型里就等于
 * 换一套维度必须改 analyzer 的代码，包也就管不到维度了。
 * 具体某次评分该有哪些键，由 buildDimensionScoresSchema 按维度表动态校验。
 */
export type DimensionScores = Record<string, ScoreDetail>;

/**
 * 一次评分生效的配置来源快照。
 *
 * 存下来是因为权重会随包升级而变：没有这个快照，三个月后再看一份 7.8 分，
 * 无法判断它和今天的 7.8 分是否可比。
 */
export interface ScoringContext {
  packId: string;
  packVersion: string;
  platformId: string;
  primaryCategory: string;
  secondaryCategory?: string;
  /** 维度表（key + label + 顺序），渲染报告时不必再回查包 */
  dimensions: Array<{ key: string; label: string }>;
  /** 归一化后的生效权重 */
  weights: Record<string, number>;
  /** 权重命中的继承层级，取值与 pack-resolver 的 ResolvedWeights.source 一致 */
  weightSource: "category" | "platform" | "defaults" | "balanced" | "fallback";
}

export interface ScoreBlock {
  scores: DimensionScores;
  weightedTotal: number;
  summary: string;
  generalQuality?: number;
  /** 与所属分类的契合度（原 trackFit） */
  categoryFit?: number;
  confidence?: number;
  evidence?: ScoreEvidence[];
  sourceHash?: string;
  scoringMode?: "hybrid" | "full_review";
  stale?: boolean;
  staleReason?: string;
}

export interface ScoreEvidence {
  /** 维度 key，或 general_quality / category_fit 这两个跨维度指标。 */
  dimension: string;
  quote: string;
  reason: string;
  start?: number;
  end?: number;
}

export interface LocalFeaturePack {
  wordCount: number;
  paragraphCount: number;
  dialogueRatio: number;
  sentenceLengthMean: number;
  shortSentenceRatio: number;
  hookStrength: number;
  emotionKeywordDensity: number;
  anomalyFlags: string[];
  tokens?: string[];
  namedEntities?: Array<{ text: string; type: "person" | "location" | "organization" | "time" | "unknown" }>;
  keywords?: string[];
  emotionCurve?: Array<{ position: number; valence: number; intensity: number }>;
  repetitionRate?: number;
}

export interface ChapterScore extends ScoreBlock {
  index: number;
  title: string;
  wordCount: number;
  emotionalBeat: string;
  weakestDimensions: string[];
}

export interface CharacterInfo {
  name: string;
  oneLiner: string;
  type: string;
}

export interface StyleInfo {
  genre: string;
  tone: string;
  narrative: string;
  summary: string;
}

/**
 * 作者风格指纹（深度提取，用于续写/改写时防止“作者换人”）
 */
export interface StyleProfile {
  /** 句式节奏：长短句习惯、段落长度分布 */
  sentenceRhythm: string;
  /** 对话习惯：对话占比、引导词、标点使用 */
  dialogueHabits: string;
  /** 叙事视角与声音：人称、叙事腔调、心理描写方式 */
  narrativeVoice: string;
  /** 词汇特征：口语化/书面化、特色用词、语气词 */
  vocabulary: string;
  /** 场景与描写习惯：动作/心理/环境描写比例、转场方式 */
  sceneHabits: string;
  /** 作者特色口头禅/高频词/标志性表达 */
  signaturePhrases: string[];
  /** 代表性原文片段（风格锚点，作 few-shot 参考） */
  sampleExcerpts: string[];
  /** 风格一句话总结 */
  summary: string;
  /** 提取时间 */
  extractedAt: string;
}

export interface WorldInfo {
  setting: string;
  rules: string[];
  summary: string;
  mapAnalysis: MapAnalysis;
}

export interface MapLocation {
  name: string;
  type: string;
  significance: string;
}

export interface MapRange {
  startChapter: number;
  endChapter: number;
  summary: string;
}

export interface MapAnalysis {
  verdict: "narrow" | "balanced" | "broad";
  score: number;
  summary: string;
  keyLocations: MapLocation[];
  ranges: MapRange[];
  recommendations: string[];
}

export interface AnalysisResult {
  novel: {
    title: string;
    totalChapters: number;
    totalWords: number;
    platform?: string;
  };
  style: StyleInfo;
  world: WorldInfo;
  characters: CharacterInfo[];
  overall: ScoreBlock;
  chapters: ChapterScore[];
  /** 分类判定结果（分析时自动反推） */
  categoryDetection?: CategoryDetection;
  /** 本次分析生效的配置包与权重来源，用于结果可追溯 */
  scoringContext?: ScoringContext;
  /** 审稿结果 */
  review?: ReviewResult;
  reviews?: Array<ReviewResult & { chapterIndex: number }>;
  /** 付费卡点设计 */
  payPoints?: PayPointDesign[];
}

export interface Chapter {
  index: number;
  title: string;
  content: string;
  wordCount: number;
  sourceKind?: "original" | "rewrite" | "continue";
  sourceVersion?: number;
  contentHash?: string;
}

/** 章节摘要（Phase 1 批量摘要阶段产出） */
export interface ChapterSummary {
  index: number;
  title: string;
  summary: string;       // 2-3 句情节摘要
  emotionalBeat: string; // 情感节奏，如 "平静→冲突→解决"
  sourceHash?: string;
  features?: LocalFeaturePack;
  keyExcerpts?: string[];
}

/**
 * 分析草稿（断点续跑用）
 *
 * 每完成一个步骤就增量保存，中断后可从草稿恢复，绝不重来。
 * 最终分析完成后草稿会被清除。
 */
export interface AnalysisDraft {
  /** Step 1：全局分析结果（风格/世界观/人设） */
  globalAnalysis?: { style: StyleInfo; world: WorldInfo; characters: CharacterInfo[]; overallComment: string };
  /** Step 2：分类判定结果 */
  categoryDetection?: CategoryDetection;
  /** Phase 1：章节摘要（批量产出，增量追加） */
  chapterSummaries: ChapterSummary[];
  /** Phase 2：逐章评分（基于摘要，增量追加） */
  chapterScores: ChapterScore[];
  /** 评分中暂时失败的章节索引（网络恢复后补打） */
  failedIndices: number[];
  /** 评分失败详情；failedIndices 为兼容旧草稿继续保留 */
  failedChapters?: Array<{ index: number; title: string; error: string }>;
  /** Step 4：审稿结果（断点续跑时恢复） */
  review?: ReviewResult;
  /** 开始时间 */
  startedAt: string;
  /** 最后更新时间 */
  updatedAt: string;
}

export interface NovelProject {
  id: string;
  name: string;
  /** @deprecated 使用 platformId 代替。旧项目兼容字段。 */
  platform?: string;
  createdAt: string;
  chapters: Chapter[];
  analysis?: AnalysisResult;
  rewrites: Record<number, RewriteVersion[]>;
  continues: ContinueChapter[];
  /** 性别（分析时自动判定，写作时手动选择） */
  gender?: Gender;
  /** 配置包平台 id。决定用哪套基准权重与提示词。 */
  platformId?: string;
  /** 一级分类 id（词表内） */
  primaryCategory?: string;
  /** 二级分类（词表内） */
  secondaryCategory?: string;
  /** 分类判定完整结果 */
  categoryDetection?: CategoryDetection;
  /** 作者风格指纹（首次使用时提取并缓存） */
  styleProfile?: StyleProfile;
}

export interface RewriteVersion {
  version: number;
  content: string;
  scores: ScoreBlock;
  targetDimensions: string[];
  createdAt: string;
}

export interface ContinueChapter {
  index: number;
  title: string;
  plan: string;
  content: string;
  scores: ScoreBlock;
  createdAt: string;
}

/**
 * 维度显示名。运行时由激活配置包的 dimensions.json 填充，
 * 因此调用方必须按 key 查表并回退到 key 本身，不能假设某个键一定存在。
 */
export type DimensionLabelMap = Record<string, string>;
