/**
 * PromptRegistry — Prompt 配置包版本管理核心服务
 * 
 * 负责：
 * 1. 加载/管理配置包（prompt 模板 + few-shot 样本 + 权重 + 参数）
 * 2. 为各 Agent 提供渲染后的 prompt（模板 + few-shot 注入）
 * 3. 提供权重配置
 * 4. 无激活包时回退到硬编码 prompt
 */

import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import { renderTemplate } from "./prompt-template";
import { Gender, ScoringContext } from "@/scoring/types";
import {
  SCORING_RUBRIC,
  ANALYST_SYSTEM_PROMPT,
  WRITER_SYSTEM_PROMPT,
  PLANNER_SYSTEM_PROMPT,
} from "@/scoring/rubric";
import {
  ROLE_ATTENTION,
  buildDefaultPackWeights,
  pickRoleWeights,
} from "@/scoring/attention";
import type {
  RoleWeights,
  RoleGenderWeights,
  PackWeights,
} from "@/scoring/attention";
import {
  CONFIG_PACK_FORMAT_VERSION,
  PackContents,
  PackPlatform,
  PIPELINES,
  PipelineName,
  packManifestSchema,
  validatePackDirectory,
} from "./config-pack-protocol";
import { ResolveTarget, resolvePrompt, resolveWeights } from "./pack-resolver";
import { FALLBACK_DIMENSIONS, FALLBACK_PLATFORM, FALLBACK_TAXONOMY, fallbackWeights } from "./fallback-pack";
import { savePackContents, ensureTaxonomy, ensureWeightTables } from "./pack-writer";

export type { RoleWeights, RoleGenderWeights, PackWeights };

const NOVEL_DIR = path.join(process.cwd(), ".novel");
const CONFIG_PACKS_DIR = path.join(NOVEL_DIR, "config-packs");
const ACTIVE_PACK_FILE = path.join(CONFIG_PACKS_DIR, "active-pack.json");

// ──────────────────────────────────────
// 类型定义
// ──────────────────────────────────────

export interface PackManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  isDefault?: boolean;
  formatVersion?: string;
  minimumAnalyzerVersion?: string;
  tasks?: string[];
}

export interface FewShotSample {
  id: string;
  text: string;
  track?: string;
  quality: "good" | "bad";
  label: string;
  reason: string;
}

export interface PackParams {
  few_shot_max: number;
  max_prompt_tokens: number;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

/** @deprecated 兼容旧引用：权重现按角色组织，等价于 RoleGenderWeights */
export type GenderWeights = RoleGenderWeights;

export interface ConfigPack {
  manifest: PackManifest;
  prompts: Record<string, string>;       // agent name -> template text
  fewShot: Record<string, FewShotSample[]>; // agent name -> samples
  weights: PackWeights;
  params: PackParams;
}

// Agent 名称列表
export const AGENT_NAMES = [
  "scorer",
  "analyst",
  "writer",
  "planner",
  "type-detector",
  "reviewer",
  "deai",
  "chat",
  "extract",
  "refine",
  "generate",
] as const;

export type AgentName = typeof AGENT_NAMES[number];

// 硬编码 prompt 回退映射（同时作为默认配置包的导出源，全部角色均有模板）
const HARDCODED_PROMPTS: Record<string, string> = {
  scorer: SCORING_RUBRIC,
  analyst: ANALYST_SYSTEM_PROMPT,
  writer: WRITER_SYSTEM_PROMPT,
  planner: PLANNER_SYSTEM_PROMPT,

  "type-detector": `你是一位资深网文编辑，精通男频和女频小说的"型"判定体系。

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

## 赛道路由表
{{routingTable}}

## 输出要求
返回严格的JSON，包含以下字段：
- gender: "male" 或 "female"
- type: 型的英文值（growth/identity/precognition/strength_reversal/identity_reversal/emotional）
- type_label: 型的中文标签
- track: 赛道的英文值
- track_label: 赛道的中文标签
- confidence: 0-1之间的置信度
- reasoning: 判定理由（2-3句话）`,

  reviewer: `你是一位严格的网文审稿编辑，精通{{genderLabel}}小说的审稿标准。

当前小说的型判定结果：
- 性别: {{genderLabel}}
- 型: {{typeLabel}}
- 赛道: {{trackLabel}}
- 判定理由: {{reasoning}}

## 审稿知识库（该性别的完整审稿标准）
{{reviewChecklist}}

## 审稿任务
请根据上述审稿标准，对以下章节进行逐条检查：

### 检查层次
1. **通用检查**：3秒钩子、单集爽点、情绪螺旋、反派质量、冲突聚焦、逻辑自洽
2. **型审稿口诀**：根据型执行对应口诀检查
3. **型级清单**：该型共通的常见问题
4. **赛道反面清单**：该赛道的专属常见问题
5. **命门校验**：该赛道的命门是否被触碰

### 输出要求
- severity 为 "fatal" 表示致命问题（命门级），"warning" 表示警告，"info" 表示建议
- category 为 "型级"、"赛道级" 或 "通用"
- passed: 如果有 fatal 级别问题则为 false
- mnemonic: 当前型对应的审稿口诀（如 "依·渐·越·分"）
- fatal_flaws: 命门命中的具体问题描述

返回严格JSON格式。`,

  deai: `你是一个专业的小说润色编辑，擅长消除AI生成文本的"机器味"。

你需要识别并修正以下AI常见痕迹：

1. **过度使用排比/对称句式** → 打破节奏，长短句交错
2. **千篇一律的描写套路** → 用更具体、独特的细节替代
3. **过于工整的段落结构** → 让叙述更自然随意
4. **空洞的形容词堆砌** → 用动词和具体场景替代
5. **情感表达过于直白** → 用行为和细节暗示情感
6. **转折词过多**（然而/不过/但是）→ 减少或换用更自然的衔接
7. **总结性结尾太多** → 让场景自然收束
8. **过于均匀的段落长度** → 有长有短，模拟人类写作节奏

要求：
- 保持原文的核心剧情和信息不变
- 不添加新剧情，只做表达层面的优化
- 让文字读起来更像是人写的
- 保持作者原有的风格基调`,

  chat: `你是一个专业的小说创作助手。你的任务是通过聊天帮助用户整理出一部小说的完整设定。

## 必须首先确认的信息
1. **性别方向**：男频还是女频？这是创作的基础，必须在第一时间确认。
   - 男频：以男主为主，核心驱动=力量/权力/地位，爽感=力量展示×身份碾压×观众震惊
   - 女频：以女主为主，核心驱动=自我价值/尊严/情感独立，爽感=能力认可×尊严回收×价值实现

2. 小说标题和类型
3. 世界观设定（背景、规则）
4. 角色设定（主角、配角、龙套，性格/外貌/动机）
5. 主线剧情大纲
6. 剧情模式（升级流/甜宠/悬疑/复仇/无限流等）
7. 文风基调（轻松/热血/虐心/搞笑等）

## 型和赛道判定
根据用户描述，自动建议型和赛道：
- 男频：成长型（逆袭/修仙/玄幻） | 身份型（战神/赘婿/霸总） | 预知型（重生/穿越）
- 女频：实力逆袭型（职场/学霸/医生） | 身份反转型（穿越修仙/真千金/马甲） | 情感关系型（虐文言情）

## 你的回复风格
- 简短友好，像一个写作伙伴
- 主动追问缺失的关键信息
- 对用户提供的碎片信息进行确认和整理
- 当信息足够时，建议用户"可以开始写了"
- 如果用户还没提供某项信息，自然地引导他们，但不要一次性问太多`,

  extract: `你是一个信息提取助手。根据用户和AI的对话历史，提取并整理小说的完整设定。
如果某项信息尚未明确，用"待定"标记。
chapterPlan 规划3-5章，每章有标题和一句话摘要。

重要：根据对话内容判断性别方向（男频/女频）、型和赛道：
- gender: "male" 或 "female"
- type: 型的中文标签（成长型/身份型/预知型/实力逆袭型/身份反转型/情感关系型）
- track: 赛道的中文标签`,

  refine: `你是一个专业的小说编辑。用户会给你一段章节正文和修改要求，请按要求修改这段文字。

要求：
- 保持原文的核心剧情不变
- 只修改用户指出的部分
- 保持前后文连贯
- 输出完整的修改后章节（不要省略未修改部分）`,

  generate: `你是一位资深网文作者，擅长写节奏快、爽点密集的网文章节。

写作要求：
1. 严格按照规划的内容写，不要偏离主题
2. 节奏要快，不要拖泥带水
3. 对话要生动，符合角色性格
4. 每章结尾留悬念
5. 不要写章节编号，直接写正文
6. 输出约2500-3500字的完整章节`,
};

// 每角色均衡默认权重：default 全均衡；评分员 male/female 做爽点/情感倾斜
const DEFAULT_WEIGHTS: PackWeights = buildDefaultPackWeights();

const DEFAULT_PARAMS: PackParams = {
  few_shot_max: 3,
  max_prompt_tokens: 8000,
};

// ──────────────────────────────────────
// 缓存
// ──────────────────────────────────────

let cachedActivePack: ConfigPack | null = null;
let cachedActivePackId: string | null = null;

// ──────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────

async function ensureConfigPacksDir() {
  await fs.mkdir(CONFIG_PACKS_DIR, { recursive: true });
}

function packDir(packId: string): string {
  return path.join(CONFIG_PACKS_DIR, packId);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, data: any): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ──────────────────────────────────────
// 核心 Registry 函数
// ──────────────────────────────────────

/**
 * 获取当前激活的配置包 ID
 */
export async function getActivePackId(): Promise<string | null> {
  const data = await readJsonFile<{ packId: string; previousPackId?: string }>(ACTIVE_PACK_FILE);
  return data?.packId || null;
}

export async function getActivePackState(): Promise<{ packId: string | null; previousPackId: string | null }> {
  const data = await readJsonFile<{ packId: string; previousPackId?: string }>(ACTIVE_PACK_FILE);
  return { packId: data?.packId || null, previousPackId: data?.previousPackId || null };
}

/**
 * 设置激活的配置包
 */
export async function setActivePackId(packId: string): Promise<void> {
  await ensureConfigPacksDir();
  const validation = await validatePackDirectory(packDir(packId));
  if (!validation.valid) throw new Error(`配置包校验失败: ${validation.errors.join("；")}`);
  const current = await readJsonFile<{ packId: string; previousPackId?: string }>(ACTIVE_PACK_FILE);
  await writeJsonFile(ACTIVE_PACK_FILE, {
    packId,
    previousPackId: current?.packId && current.packId !== packId ? current.packId : current?.previousPackId,
  });
  // 清除缓存
  invalidatePackCache();
}

export async function rollbackActivePack(): Promise<string> {
  const current = await readJsonFile<{ packId: string; previousPackId?: string }>(ACTIVE_PACK_FILE);
  if (!current?.previousPackId) throw new Error("没有可回退的配置包");
  const previousPackId = current.previousPackId;
  const validation = await validatePackDirectory(packDir(previousPackId));
  if (!validation.valid) throw new Error(`回退配置包校验失败: ${validation.errors.join("；")}`);
  await writeJsonFile(ACTIVE_PACK_FILE, { packId: previousPackId, previousPackId: current.packId });
  invalidatePackCache();
  return previousPackId;
}

/**
 * 加载指定配置包
 */
export async function loadPack(packId: string): Promise<ConfigPack | null> {
  const dir = packDir(packId);
  const validation = await validatePackDirectory(dir);
  if (!validation.valid) return null;
  
  // 读取 manifest
  const rawManifest = await readJsonFile<PackManifest>(path.join(dir, "manifest.json"));
  const manifest = rawManifest ? packManifestSchema.parse({
    formatVersion: CONFIG_PACK_FORMAT_VERSION,
    minimumAnalyzerVersion: "0.2.0",
    ...rawManifest,
  }) : null;
  if (!manifest) return null;

  // 读取 prompts
  const prompts: Record<string, string> = {};
  const promptsDir = path.join(dir, "prompts");
  for (const agentName of AGENT_NAMES) {
    const content = await readTextFile(path.join(promptsDir, `${agentName}.txt`));
    if (content !== null) {
      prompts[agentName] = content;
    }
  }
  // 缺失的角色模板用硬编码默认补齐，保证每个包都暴露全部角色模板
  for (const agentName of AGENT_NAMES) {
    if (!prompts[agentName] && HARDCODED_PROMPTS[agentName]) {
      prompts[agentName] = HARDCODED_PROMPTS[agentName];
    }
  }

  // 读取 few-shot 样本
  const fewShot: Record<string, FewShotSample[]> = {};
  const fewShotDir = path.join(dir, "few-shot");
  for (const agentName of AGENT_NAMES) {
    const samples = await readJsonFile<FewShotSample[]>(
      path.join(fewShotDir, agentName, "samples.json")
    );
    if (samples) {
      fewShot[agentName] = samples;
    }
  }

  // 读取权重（兼容旧格式，迁移为每角色结构）
  const rawWeights = await readJsonFile<Record<string, any>>(path.join(dir, "weights.json"));
  const weights = rawWeights ? migrateWeights(rawWeights) : DEFAULT_WEIGHTS;

  // 读取参数
  const params = (await readJsonFile<PackParams>(path.join(dir, "params.json"))) || DEFAULT_PARAMS;

  return { manifest, prompts, fewShot, weights, params };
}

/**
 * 获取当前激活的配置包（带缓存）
 */
let cachedContents: PackContents | null = null;
let cachedContentsPackId: string | null = null;

/** 切换/改写包后清空两份缓存：prompt 侧与 2.0 打分契约侧必须同时失效。 */
export function invalidatePackCache(): void {
  cachedActivePack = null;
  cachedActivePackId = null;
  cachedContents = null;
  cachedContentsPackId = null;
}

/**
 * 读取激活包的 2.0 结构化内容（维度表 / 词表 / 平台 / 分类 / 兜底）。
 *
 * 与 {@link getActivePack} 并存：后者面向 prompt 与 few-shot，本函数面向
 * 打分契约。包不是 2.0 或校验失败时返回 null，调用方回退到内置默认值。
 */
export async function loadActivePack(): Promise<PackContents | null> {
  const packId = await getActivePackId();
  if (!packId) return null;
  if (cachedContents && cachedContentsPackId === packId) return cachedContents;

  const validation = await validatePackDirectory(packDir(packId));
  if (!validation.valid || !validation.contents) {
    console.warn(`[registry] 包 ${packId} 不满足 2.0 契约，打分回退默认值`);
    return null;
  }
  cachedContents = validation.contents;
  cachedContentsPackId = packId;
  return cachedContents;
}

/**
 * 读取指定包的 2.0 结构化内容（不要求是激活包，供管理界面编辑）。
 */
export async function loadPackContents(packId: string): Promise<PackContents | null> {
  const validation = await validatePackDirectory(packDir(packId));
  if (!validation.valid || !validation.contents) return null;
  return validation.contents;
}

export async function getActivePack(): Promise<ConfigPack | null> {
  const packId = await getActivePackId();
  if (!packId) return null;

  // 缓存命中
  if (cachedActivePack && cachedActivePackId === packId) {
    return cachedActivePack;
  }

  const pack = await loadPack(packId);
  if (pack) {
    cachedActivePack = pack;
    cachedActivePackId = packId;
  }
  return pack;
}

/** prompt 解析目标：与 studio 的分类坐标一致（平台 + 频道 + 一二级分类）。 */
export interface PromptTarget {
  gender?: Gender;
  platform?: string;
  primaryCategory?: string;
  secondaryCategory?: string;
}

const isPipelineName = (name: string): name is PipelineName =>
  (PIPELINES as readonly string[]).includes(name);

/** 用解析后的维度权重渲染注意力块，标签取自包的维度表。 */
function renderResolvedAttention(
  contents: PackContents,
  pipeline: PipelineName,
  target: ResolveTarget,
): string {
  const { weights } = resolveWeights(contents, pipeline, target);
  const dimensions = contents.dimensions[pipeline] || [];
  const lines = dimensions
    .map((dimension) => {
      const percent = Math.round((weights[dimension.key] || 0) * 100);
      return `- ${dimension.label}：${percent}%`;
    })
    .join("\n");
  return lines ? `本次评估的维度权重：\n${lines}` : "";
}

/**
 * 获取指定 agent 的渲染后 prompt
 *
 * 流程:
 * 1. 检查是否有激活的配置包
 * 2. 有: 加载模板 + few-shot → renderTemplate
 * 3. 无: 返回硬编码的 prompt
 */
export async function getPrompt(
  agentName: string,
  context: Record<string, any> = {},
  options?: PromptTarget
): Promise<string> {
  const pack = await getActivePack();
  const gender = options?.gender;
  const target: ResolveTarget = {
    platformId: options?.platform,
    gender: gender === "male" || gender === "female" ? gender : undefined,
    primaryCategory: options?.primaryCategory,
    secondaryCategory: options?.secondaryCategory,
  };

  // 2.0 包按「平台基准 → 分类覆盖 → 频道兜底」解析；旧包无 contents，退回包级模板。
  const contents = await loadActivePack();
  const pipeline = isPipelineName(agentName) ? agentName : undefined;

  const attentionBlock = pipeline && contents
    ? renderResolvedAttention(contents, pipeline, target)
    : renderAttentionBlock(
        agentName,
        pickRoleWeights(
          (pack?.weights || DEFAULT_WEIGHTS)[agentName],
          target.gender,
        ),
      );

  let template: string | undefined;
  let fewShotExamples: FewShotSample[] | undefined;

  if (pipeline && contents) {
    template = resolvePrompt(contents, pipeline, target) || undefined;
  }
  if (pack) {
    template = template || pack.prompts[agentName];
    const samples = pack.fewShot[agentName] || [];
    fewShotExamples = samples.slice(0, pack.params?.few_shot_max || 3);
  }
  if (!template) {
    template = HARDCODED_PROMPTS[agentName] || "";
  }
  if (!template) return "";

  const fullContext = {
    ...context,
    attention: attentionBlock,
    fewShotExamples: fewShotExamples && fewShotExamples.length > 0 ? fewShotExamples : undefined,
  };

  let result = renderTemplate(template, fullContext);

  // 若模板未显式使用 {{attention}}，则在末尾追加，保证注意力偏好一定注入
  if (attentionBlock && !template.includes("{{attention}}")) {
    result += `\n\n${attentionBlock}`;
  }

  // 若模板未显式使用 fewShotExamples，则追加 few-shot 示例块，保证所有角色都能注入样本
  const fewShotBlock = renderFewShotBlock(fewShotExamples || []);
  if (fewShotBlock && !template.includes("fewShotExamples")) {
    result += `\n\n${fewShotBlock}`;
  }

  return result;
}

function mergePackWeights(base: PackWeights, override: Record<string, unknown>): PackWeights {
  const merged = { ...base } as PackWeights;
  for (const [agent, value] of Object.entries(override)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const current = merged[agent] || { default: {} };
    const incoming = value as Record<string, Record<string, number>>;
    merged[agent] = {
      ...current,
      ...incoming,
      default: { ...current.default, ...(incoming.default || {}) },
      ...(incoming.male ? { male: { ...(current.male || {}), ...incoming.male } } : {}),
      ...(incoming.female ? { female: { ...(current.female || {}), ...incoming.female } } : {}),
    };
  }
  return merged;
}

/**
 * 渲染 few-shot 示例块（若模板未使用 {{#each fewShotExamples}}，则追加此块）
 */
function renderFewShotBlock(samples: FewShotSample[]): string {
  if (!samples || samples.length === 0) return "";
  const blocks = samples.map((s, i) => {
    const tag = s.quality === "good" ? "好示例" : "坏示例";
    let text = `【${tag} ${i + 1}】${s.label || ""}\n${s.text}`;
    if (s.reason) {
      text += `\n（${s.quality === "good" ? "好" : "坏"}在哪里：${s.reason}）`;
    }
    return text;
  });
  return `## 参考示例（few-shot）\n以下是 ${samples.length} 个写作示例，请对照学习其标准：\n\n${blocks.join("\n\n---\n\n")}`;
}

/**
 * 获取评分员的 7 维权重（兼容旧接口）—— 已废弃。
 * 权重由配置包解析，见 getScoringContext。
 */

/**
 * 构建评分上下文：一次拿到生效权重 + 维度表 + 命中来源。
 *
 * 报告渲染要的维度 label 和打分要的权重来自同一次解析，
 * 分开取会在包切换时错配（权重按新包、label 按旧包）。
 * 包不可用时返回 null，调用方按等权兜底。
 */
export async function getScoringContext(
  pipeline: PipelineName = "scorer",
  target: PromptTarget = {},
): Promise<ScoringContext | null> {
  const contents = await loadActivePack();

  // 没有可消费的 2.0 包时，用内置默认维度与等权兜底，绝不返回空权重。
  // 空权重会让加权总分恒为 0，表现成「一本都不及格」，比兜底更误导人。
  if (!contents) {
    return {
      packId: "builtin",
      packVersion: "0",
      platformId: FALLBACK_PLATFORM.id,
      primaryCategory: target.primaryCategory || "",
      secondaryCategory: target.secondaryCategory,
      dimensions: FALLBACK_DIMENSIONS[pipeline].map((d) => ({ key: d.key, label: d.label })),
      weights: fallbackWeights(pipeline),
      weightSource: "fallback",
    };
  }

  const resolveTarget: ResolveTarget = {
    platformId: target.platform,
    gender: target.gender === "male" || target.gender === "female" ? target.gender : undefined,
    primaryCategory: target.primaryCategory,
    secondaryCategory: target.secondaryCategory,
  };
  const resolved = resolveWeights(contents, pipeline, resolveTarget);

  return {
    packId: contents.manifest.id,
    packVersion: contents.manifest.version,
    platformId: resolved.platformId || "",
    primaryCategory: target.primaryCategory || "",
    secondaryCategory: target.secondaryCategory,
    dimensions: contents.dimensions[pipeline].map((d) => ({ key: d.key, label: d.label })),
    weights: resolved.weights,
    weightSource: resolved.source,
  };
}

/**
 * 获取某角色在某性别下的注意力权重
 * 优先从激活包获取，否则使用均衡默认值
 */
export async function getRoleWeights(
  agentName: string,
  gender?: Gender
): Promise<RoleWeights> {
  const pack = await getActivePack();
  const source: PackWeights = pack?.weights || DEFAULT_WEIGHTS;
  return pickRoleWeights(source[agentName], gender === "male" || gender === "female" ? gender : undefined);
}

/**
 * 渲染"本角色注意力权重"块（按权重降序）
 */
function renderAttentionBlock(agentName: string, roleWeights: RoleWeights): string {
  const dims = ROLE_ATTENTION[agentName as keyof typeof ROLE_ATTENTION];
  if (!dims || dims.length === 0 || Object.keys(roleWeights).length === 0) return "";
  const sorted = [...dims].sort(
    (a, b) => (roleWeights[b.key] || 0) - (roleWeights[a.key] || 0)
  );
  const lines = sorted.map((d) => {
    const pct = Math.round((roleWeights[d.key] || 0) * 100);
    return `- ${d.label}（${pct}%）：${d.description}`;
  });
  return `## 本角色注意力权重（偏好）\n你在执行任务时应将注意力按以下权重分配：\n${lines.join("\n")}`;
}

/**
 * 权重迁移：把旧格式（顶层 default/male/female 七维）迁移为每角色结构
 */
function migrateWeights(raw: Record<string, any>): PackWeights {
  // 已是新格式（含 scorer 角色且有 default）
  if (raw && raw.scorer && typeof raw.scorer === "object" && raw.scorer.default) {
    return fillMissingRoles(raw as PackWeights);
  }
  // 旧格式：顶层 default/male/female，是评分员的 7 维权重
  if (raw && raw.default && typeof raw.default === "object" && "satisfaction_density" in raw.default) {
    const base = buildDefaultPackWeights();
    base.scorer = {
      default: raw.default,
      male: raw.male || base.scorer.male,
      female: raw.female || base.scorer.female,
    };
    return base;
  }
  // 无法识别，使用均衡默认值
  return buildDefaultPackWeights();
}

/**
 * 补齐缺失角色的权重（保证每个角色都有 default）
 */
function fillMissingRoles(w: PackWeights): PackWeights {
  const base = buildDefaultPackWeights();
  for (const name of Object.keys(base)) {
    if (!w[name]) {
      w[name] = base[name];
    } else if (!w[name].default) {
      w[name].default = base[name].default;
    }
  }
  return w;
}

// ──────────────────────────────────────
// 包管理（CRUD）
// ──────────────────────────────────────

/**
 * 列出所有配置包
 */
export async function listPacks(): Promise<PackManifest[]> {
  await ensureConfigPacksDir();
  
  const dirs = await fs.readdir(CONFIG_PACKS_DIR);
  const packs: PackManifest[] = [];

  for (const dir of dirs) {
    const manifest = await readJsonFile<PackManifest>(
      path.join(CONFIG_PACKS_DIR, dir, "manifest.json")
    );
    if (manifest) {
      packs.push(manifest);
    }
  }

  return packs.sort((a, b) => 
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function validatePack(packId: string) {
  return validatePackDirectory(packDir(packId));
}

/**
 * 安全导入配置包 ZIP。压缩包只能包含声明式 JSON/TXT 文件，且必须先通过
 * 协议校验才会安装到 config-packs 目录。
 */
export async function importPackArchive(buffer: Buffer): Promise<PackContents> {
  const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
  const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
  const MAX_FILES = 500;
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error("配置包不能超过 20 MB");

  await ensureConfigPacksDir();
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  if (entries.length === 0 || entries.length > MAX_FILES) throw new Error("配置包文件数量无效");

  const normalized = entries.map((entry) => {
    const name = entry.entryName.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!name || name.startsWith("/") || name.includes("../") || path.posix.isAbsolute(name)) {
      throw new Error(`配置包包含不安全路径: ${entry.entryName}`);
    }
    if (!/\.(json|txt)$/i.test(name)) throw new Error(`配置包包含不允许的文件: ${name}`);
    return { entry, name };
  });

  const totalSize = normalized.reduce((sum, item) => sum + item.entry.header.size, 0);
  if (totalSize > MAX_UNPACKED_BYTES) throw new Error("配置包解压后不能超过 50 MB");

  // 同时支持 ZIP 根目录直接放文件，以及外层包一层同名目录。
  const manifestEntry = normalized.find((item) => item.name === "manifest.json")
    || normalized.find((item) => item.name.split("/").length === 2 && item.name.endsWith("/manifest.json"));
  if (!manifestEntry) throw new Error("配置包缺少 manifest.json");
  const rootPrefix = manifestEntry.name.slice(0, -"manifest.json".length);

  let manifest: PackManifest;
  try {
    const rawManifest = JSON.parse(manifestEntry.entry.getData().toString("utf-8"));
    if (rawManifest.formatVersion !== CONFIG_PACK_FORMAT_VERSION) {
      throw new Error(`不支持的配置包协议版本: ${rawManifest.formatVersion || "未声明"}`);
    }
    manifest = packManifestSchema.parse(rawManifest);
  } catch (error: any) {
    throw new Error(`manifest.json 无效: ${error.message}`);
  }
  const destination = packDir(manifest.id);
  try {
    await fs.access(destination);
    throw new Error(`配置包 ${manifest.id} 已存在，请先删除或使用新的版本 ID`);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }

  const tempDir = path.join(CONFIG_PACKS_DIR, `.import-${manifest.id}-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  try {
    for (const item of normalized) {
      if (!item.name.startsWith(rootPrefix)) continue;
      const relative = item.name.slice(rootPrefix.length);
      if (!relative) continue;
      const target = path.join(tempDir, ...relative.split("/"));
      const resolved = path.resolve(target);
      if (!resolved.startsWith(path.resolve(tempDir) + path.sep)) throw new Error(`配置包路径越界: ${relative}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, item.entry.getData());
    }

    const validation = await validatePackDirectory(tempDir);
    if (!validation.valid) throw new Error(`配置包校验失败: ${validation.errors.join("；")}`);
    await fs.rename(tempDir, destination);

    // 安装后直接返回 2.0 内容，不再走 1.0 的 loadPack —— 2.0 包没有 weights.json / prompts/*.txt。
    const installed = await validatePackDirectory(destination);
    if (!installed.valid || !installed.contents) {
      throw new Error(`配置包安装后校验失败: ${installed.errors.join("；")}`);
    }
    return installed.contents;
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * 创建新配置包（2.0 形状）。
 *
 * 复制来源包时按 2.0 内容复制；无来源则用内置维度表 + 词表初始化一个空包。
 */
export async function createPack(
  manifest: PackManifest,
  options?: { copyFrom?: string }
): Promise<PackContents> {
  await ensureConfigPacksDir();
  const dir = packDir(manifest.id);
  await fs.mkdir(dir, { recursive: true });

  // 传入的 manifest 可能缺 2.0 必填字段，走 schema 补全（formatVersion/selfContained 等）。
  const normalizedManifest = packManifestSchema.parse({
    formatVersion: CONFIG_PACK_FORMAT_VERSION,
    minimumAnalyzerVersion: "0.3.0",
    ...manifest,
  });

  let contents: PackContents;
  if (options?.copyFrom) {
    const source = await loadPackContents(options.copyFrom);
    if (!source) throw new Error(`复制来源配置包无效: ${options.copyFrom}`);
    contents = {
      ...source,
      manifest: { ...source.manifest, ...normalizedManifest, id: manifest.id, updatedAt: new Date().toISOString(), createdAt: source.manifest.createdAt },
    };
  } else {
    contents = {
      manifest: normalizedManifest,
      dimensions: JSON.parse(JSON.stringify(FALLBACK_DIMENSIONS)),
      taxonomy: JSON.parse(JSON.stringify(FALLBACK_TAXONOMY)),
      platforms: [],
      categories: [],
      defaults: {},
    };
  }

  contents = ensureTaxonomy(ensureWeightTables(contents));
  await savePackContents(dir, contents);

  // 校验并返回新包内容
  const validation = await validatePackDirectory(dir);
  if (!validation.valid || !validation.contents) {
    throw new Error(`新配置包校验失败: ${validation.errors.join("；")}`);
  }
  return validation.contents;
}

/**
 * 更新配置包
 */
export async function updatePack(
  packId: string,
  updates: {
    manifest?: Partial<PackManifest>;
    contents?: PackContents;
  }
): Promise<PackContents> {
  const dir = packDir(packId);

  const validation = await validatePackDirectory(dir);
  if (!validation.valid || !validation.contents) {
    throw new Error(`配置包当前不合法: ${validation.errors.join("；")}`);
  }
  let contents = validation.contents;

  // 更新 manifest
  if (updates.manifest) {
    contents = {
      ...contents,
      manifest: packManifestSchema.parse({
        ...contents.manifest,
        ...updates.manifest,
        id: packId, // id 不可改
        formatVersion: CONFIG_PACK_FORMAT_VERSION,
        updatedAt: new Date().toISOString(),
      }),
    };
  }

  // 整体替换内容（2.0 编辑区保存时传完整 contents）
  if (updates.contents) {
    contents = {
      ...updates.contents,
      manifest: {
        ...updates.contents.manifest,
        id: packId,
        formatVersion: CONFIG_PACK_FORMAT_VERSION,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  // 保存前复核不变量，防止写出非法包
  await savePackContents(dir, contents);
  const recheck = await validatePackDirectory(dir);
  if (!recheck.valid) {
    throw new Error(`保存的配置包不合法: ${recheck.errors.join("；")}`);
  }

  // 清除缓存，让新内容立即生效
  invalidatePackCache();

  return recheck.contents!;
}

/**
 * 删除配置包
 */
export async function deletePack(packId: string): Promise<void> {
  const dir = packDir(packId);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // 忽略
  }

  // 同步清理当前包或回退指针，避免留下无法回退的悬空引用。
  const state = await readJsonFile<{ packId: string; previousPackId?: string }>(ACTIVE_PACK_FILE);
  if (state?.packId === packId) {
    try {
      await fs.unlink(ACTIVE_PACK_FILE);
    } catch {
      // 忽略
    }
    cachedActivePack = null;
    cachedActivePackId = null;
  } else if (state?.previousPackId === packId) {
    await writeJsonFile(ACTIVE_PACK_FILE, { packId: state.packId });
  }
}

// ──────────────────────────────────────
// Few-shot 样本管理
// ──────────────────────────────────────

/**
 * 获取指定 agent 的 few-shot 样本
 */
export async function getSamples(
  packId: string,
  agentName: string
): Promise<FewShotSample[]> {
  const samples = await readJsonFile<FewShotSample[]>(
    path.join(packDir(packId), "few-shot", agentName, "samples.json")
  );
  return samples || [];
}

/**
 * 添加 few-shot 样本
 */
export async function addSample(
  packId: string,
  agentName: string,
  sample: FewShotSample
): Promise<void> {
  const sampleDir = path.join(packDir(packId), "few-shot", agentName);
  await fs.mkdir(sampleDir, { recursive: true });

  const samples = await getSamples(packId, agentName);
  samples.push(sample);
  await writeJsonFile(path.join(sampleDir, "samples.json"), samples);

  // 清除缓存
  if (cachedActivePackId === packId) {
    cachedActivePack = null;
    cachedActivePackId = null;
  }
}

/**
 * 删除 few-shot 样本
 */
export async function removeSample(
  packId: string,
  agentName: string,
  sampleId: string
): Promise<void> {
  const sampleDir = path.join(packDir(packId), "few-shot", agentName);
  const samples = await getSamples(packId, agentName);
  const filtered = samples.filter((s) => s.id !== sampleId);
  await writeJsonFile(path.join(sampleDir, "samples.json"), filtered);

  // 清除缓存
  if (cachedActivePackId === packId) {
    cachedActivePack = null;
    cachedActivePackId = null;
  }
}

// ──────────────────────────────────────
// 初始化工具
// ──────────────────────────────────────

/**
 * 创建一个含内置默认平台的 2.0 配置包，并激活。
 */
export async function generateDefaultPack(): Promise<PackContents> {
  const manifest: PackManifest = {
    id: "v0-default",
    name: "默认配置包",
    description: "初始版本，基于内置维度表与词表导出",
    version: "1.0.0",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author: "system",
    isDefault: true,
  };

  // 用内置维度表 + 词表初始化空包，再补一个默认平台基准。
  let contents = await createPack(manifest);
  const platform = {
    id: "default",
    name: "默认平台",
    code: "default",
    genders: ["male", "female"] as const,
    promptAppend: "",
    channels: {},
  };
  contents = {
    ...contents,
    platforms: [platform as unknown as PackPlatform],
  };
  contents = ensureTaxonomy(ensureWeightTables(contents));
  await savePackContents(packDir(manifest.id), contents);

  // 设置为激活包
  await setActivePackId(manifest.id);
  invalidatePackCache();

  const validation = await validatePackDirectory(packDir(manifest.id));
  return validation.contents!;
}

/**
 * 确保有默认包存在（首次运行时调用）
 */
export async function ensureDefaultPack(): Promise<void> {
  const packs = await listPacks();
  if (packs.length === 0) {
    await generateDefaultPack();
  }
}
