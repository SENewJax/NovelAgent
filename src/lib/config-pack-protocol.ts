/**
 * 配置包协议 2.0 —— studio 是配置权威，analyzer 只消费。
 *
 * 本文件只做一件事：把 studio 实际产出的六个文件校验成可信任的结构，
 * 并在校验阶段就断言那些下游依赖的不变量（维度 key 集合、权重和为 100）。
 *
 * 不兼容 1.0（weights.json + prompts/*.txt）：1.0 把权重写在提示词散文里，
 * 与「权重由包下发」互相矛盾，保留两条路径只会让两份数字继续漂移。
 */
import fs from "fs/promises";
import path from "path";
import { z } from "zod";

export const CONFIG_PACK_FORMAT_VERSION = "2.0";

/** 与 studio 的 PIPELINES 一致。包里每个 pipeline 都必须齐全。 */
export const PIPELINES = ["scorer", "analyst", "reviewer", "writer", "type-detector"] as const;
export type PipelineName = (typeof PIPELINES)[number];

export const GENDERS = ["male", "female"] as const;
export type PackGender = (typeof GENDERS)[number];

/** 词表外内容一律归入这里，与 studio 的 OTHER_CATEGORY_ID 对齐。 */
export const OTHER_CATEGORY_ID = "other";
export const OTHER_LABEL = "其他";

const pipelineRecord = <T extends z.ZodTypeAny>(value: T) =>
  z.object(Object.fromEntries(PIPELINES.map((name) => [name, value])) as Record<PipelineName, T>);

// ── manifest.json ──

export const packManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/, "只能是小写字母、数字、点、下划线或连字符"),
  name: z.string().min(1).max(100),
  description: z.string().default(""),
  version: z.string().min(1).max(32),
  formatVersion: z.literal(CONFIG_PACK_FORMAT_VERSION),
  minimumAnalyzerVersion: z.string().default("0.3.0"),
  createdAt: z.string(),
  updatedAt: z.string(),
  author: z.string().min(1),
  selfContained: z.boolean().default(true),
  pipelines: z.array(z.string()).default([...PIPELINES]),
  files: z.array(z.string()).optional(),
  platformCount: z.number().int().nonnegative().optional(),
  categoryCount: z.number().int().nonnegative().optional(),
  isDefault: z.boolean().optional(),
});

export type PackManifest = z.infer<typeof packManifestSchema>;

// ── dimensions.json：维度表，权重键与 rubric 的唯一来源 ──

export const dimensionSpecSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
});

export type DimensionSpec = z.infer<typeof dimensionSpecSchema>;

export const packDimensionsSchema = pipelineRecord(z.array(dimensionSpecSchema).min(1));

export type PackDimensions = z.infer<typeof packDimensionsSchema>;

// ── taxonomy.json：受控分类词表 ──

export const primaryCategoryNodeSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  secondary: z.array(z.string().min(1).max(64)).min(1),
});

export type PrimaryCategoryNode = z.infer<typeof primaryCategoryNodeSchema>;

export const packTaxonomySchema = z.object({
  male: z.array(primaryCategoryNodeSchema),
  female: z.array(primaryCategoryNodeSchema),
});

export type CategoryTaxonomy = z.infer<typeof packTaxonomySchema>;

// ── platforms.json：基准层 ──

const weightMapSchema = z.record(z.number());

const channelPipelineSchema = z.object({
  weights: weightMapSchema,
  prompt: z.string().default(""),
});

export const packPlatformSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  code: z.string().default(""),
  genders: z.array(z.enum(GENDERS)).min(1),
  promptAppend: z.string().default(""),
  channels: z.record(pipelineRecord(channelPipelineSchema).partial()),
});

export type PackPlatform = z.infer<typeof packPlatformSchema>;

export const packPlatformsSchema = z.array(packPlatformSchema);

// ── categories.json：叶子层，继承已由 studio 解析为实际值 ──

export const packCategorySchema = z.object({
  id: z.string().min(1),
  platformId: z.string().min(1),
  gender: z.enum(GENDERS),
  primaryCategory: z.string().min(1),
  secondaryCategory: z.string().min(1),
  inheritsWeights: z.boolean().default(true),
  params: z
    .object({
      temperature: z.number().min(0).max(2),
      topP: z.number().min(0).max(1),
      maxTokens: z.number().int().positive(),
    })
    .partial()
    .default({}),
  pipelines: pipelineRecord(channelPipelineSchema).partial(),
});

export type PackCategory = z.infer<typeof packCategorySchema>;

export const packCategoriesSchema = z.array(packCategorySchema);

// ── defaults.json：平台 × 频道 × pipeline 的兜底权重 ──

export const packDefaultsSchema = z.record(z.record(z.record(weightMapSchema)));

export type PackDefaults = z.infer<typeof packDefaultsSchema>;

// ──────────────────────────────────────
// 包内容与校验
// ──────────────────────────────────────

export interface PackContents {
  manifest: PackManifest;
  dimensions: PackDimensions;
  taxonomy: CategoryTaxonomy;
  platforms: PackPlatform[];
  categories: PackCategory[];
  defaults: PackDefaults;
}

export interface PackValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: PackManifest;
  contents?: PackContents;
}

/** 权重容差：studio 侧按整数分摊到 100，读取时允许 ±1 的舍入残差。 */
const WEIGHT_SUM_TOLERANCE = 1;

const PACK_FILES = {
  manifest: "manifest.json",
  dimensions: "dimensions.json",
  taxonomy: "taxonomy.json",
  platforms: "platforms.json",
  categories: "categories.json",
  defaults: "defaults.json",
} as const;

/**
 * 校验配置包目录。
 *
 * 报错必须指出「哪个文件的哪个字段」—— 只说「包无效」的话，
 * 调校者拿到一个 20 MB 的 zip 无从下手。
 */
export async function validatePackDirectory(dir: string): Promise<PackValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = {
    manifest: await parseFile(dir, PACK_FILES.manifest, packManifestSchema, errors),
    dimensions: await parseFile(dir, PACK_FILES.dimensions, packDimensionsSchema, errors),
    taxonomy: await parseFile(dir, PACK_FILES.taxonomy, packTaxonomySchema, errors),
    platforms: await parseFile(dir, PACK_FILES.platforms, packPlatformsSchema, errors),
    categories: await parseFile(dir, PACK_FILES.categories, packCategoriesSchema, errors),
    defaults: await parseFile(dir, PACK_FILES.defaults, packDefaultsSchema, errors),
  };

  if (errors.length > 0) return { valid: false, errors, warnings, manifest: parsed.manifest };

  const contents = parsed as PackContents;
  errors.push(...checkDimensionInvariants(contents.dimensions));
  errors.push(...checkWeightInvariants(contents));
  warnings.push(...collectWarnings(contents));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest: contents.manifest,
    contents: errors.length === 0 ? contents : undefined,
  };
}

async function parseFile<T extends z.ZodTypeAny>(
  dir: string,
  file: string,
  schema: T,
  errors: string[],
): Promise<z.infer<T> | undefined> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(path.join(dir, file), "utf-8"));
  } catch (error: any) {
    errors.push(error?.code === "ENOENT" ? `缺少 ${file}` : `${file} 不是合法 JSON: ${message(error)}`);
    return undefined;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    errors.push(`${file} 字段不合法: ${formatZodError(result.error)}`);
    return undefined;
  }
  return result.data;
}

/** 不变量 1：维度 key 全局语义唯一 —— 这里能查的是 key 不得同名异义（同 key 不同 label）。 */
function checkDimensionInvariants(dimensions: PackDimensions): string[] {
  const errors: string[] = [];
  const seen = new Map<string, { label: string; pipeline: string }>();
  for (const pipeline of PIPELINES) {
    const keys = new Set<string>();
    for (const dimension of dimensions[pipeline]) {
      if (keys.has(dimension.key)) {
        errors.push(`dimensions.json 的 ${pipeline} 内维度 key 重复: ${dimension.key}`);
      }
      keys.add(dimension.key);
      const previous = seen.get(dimension.key);
      if (previous && previous.label !== dimension.label) {
        errors.push(
          `dimensions.json 的维度 key「${dimension.key}」语义不唯一：` +
            `${previous.pipeline} 里是「${previous.label}」，${pipeline} 里是「${dimension.label}」。` +
            `含义不同必须换 key。`,
        );
      }
      if (!previous) seen.set(dimension.key, { label: dimension.label, pipeline });
    }
  }
  return errors;
}

/** 不变量 2：权重 key 集合 == 该 pipeline 的维度 key 集合，且总和为 100。 */
function checkWeightInvariants(contents: PackContents): string[] {
  const errors: string[] = [];
  const { dimensions, platforms, categories, defaults } = contents;

  for (const platform of platforms) {
    for (const [gender, channel] of Object.entries(platform.channels)) {
      for (const pipeline of PIPELINES) {
        const weights = channel[pipeline]?.weights;
        if (!weights) continue;
        errors.push(
          ...checkWeightMap(weights, dimensions[pipeline], `platforms.json[${platform.id}].channels.${gender}.${pipeline}.weights`),
        );
      }
    }
  }

  for (const category of categories) {
    for (const pipeline of PIPELINES) {
      const weights = category.pipelines[pipeline]?.weights;
      if (!weights) continue;
      errors.push(
        ...checkWeightMap(weights, dimensions[pipeline], `categories.json[${category.id}].pipelines.${pipeline}.weights`),
      );
    }
  }

  for (const [platformId, genders] of Object.entries(defaults)) {
    for (const [gender, byPipeline] of Object.entries(genders)) {
      for (const [pipeline, weights] of Object.entries(byPipeline)) {
        if (!PIPELINES.includes(pipeline as PipelineName)) {
          errors.push(`defaults.json[${platformId}][${gender}] 含未知 pipeline: ${pipeline}`);
          continue;
        }
        errors.push(
          ...checkWeightMap(weights, dimensions[pipeline as PipelineName], `defaults.json[${platformId}][${gender}][${pipeline}]`),
        );
      }
    }
  }

  return errors;
}

function checkWeightMap(weights: Record<string, number>, dimensions: DimensionSpec[], where: string): string[] {
  const errors: string[] = [];
  const expected = new Set(dimensions.map((dimension) => dimension.key));
  const actual = Object.keys(weights);
  // 空权重表示该 pipeline 未配置，交由上层回退，不算错。
  if (actual.length === 0) return errors;

  const missing = [...expected].filter((key) => !(key in weights));
  const extra = actual.filter((key) => !expected.has(key));
  if (missing.length) errors.push(`${where} 缺少维度: ${missing.join("、")}`);
  if (extra.length) errors.push(`${where} 含维度表外的键: ${extra.join("、")}`);

  for (const [key, value] of Object.entries(weights)) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      errors.push(`${where}.${key} 必须是 0-100 的数字，实际为 ${value}`);
    }
  }

  const sum = Object.values(weights).reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  if (Math.abs(sum - 100) > WEIGHT_SUM_TOLERANCE) {
    errors.push(`${where} 权重总和为 ${sum}，必须为 100`);
  }
  return errors;
}

function collectWarnings(contents: PackContents): string[] {
  const warnings: string[] = [];
  const { taxonomy, platforms, categories } = contents;

  for (const gender of GENDERS) {
    if (!taxonomy[gender].some((node) => node.id === OTHER_CATEGORY_ID)) {
      warnings.push(`taxonomy.json 的 ${gender} 频道没有「${OTHER_LABEL}」兜底分类，词表外内容会退回内置兜底`);
    }
  }

  const platformIds = new Set(platforms.map((platform) => platform.id));
  for (const category of categories) {
    if (!platformIds.has(category.platformId)) {
      warnings.push(`categories.json[${category.id}] 指向不存在的平台 ${category.platformId}，该分类不会被命中`);
    }
    const node = taxonomy[category.gender]?.find(
      (item) => item.id === category.primaryCategory || item.label === category.primaryCategory,
    );
    if (!node) {
      warnings.push(`categories.json[${category.id}] 的一级分类「${category.primaryCategory}」不在词表内`);
    } else if (!node.secondary.includes(category.secondaryCategory)) {
      warnings.push(
        `categories.json[${category.id}] 的二级分类「${category.secondaryCategory}」不在「${node.label}」的清单内`,
      );
    }
  }

  if (platforms.length === 0) warnings.push("platforms.json 为空，所有分析都会退回内置默认权重");
  return warnings;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
