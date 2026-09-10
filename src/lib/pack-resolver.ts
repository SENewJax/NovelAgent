/**
 * 权重与提示词解析 —— 三层继承的消费端实现。
 *
 *   平台基准 (platforms.json → channels[gender][pipeline].weights)
 *     └── 分类覆盖 (categories.json → pipelines[pipeline].weights)
 *           └── 频道兜底 (defaults.json → [platform][gender][pipeline])
 *
 * 训练建议值（trainedWeights）不在包里，analyzer 看不到也不需要看到。
 * 本模块只读：任何路径都不回写平台基准，否则一次分析会让所有继承该基准的分类一起漂移。
 */
import {
  DimensionSpec,
  PackContents,
  PackGender,
  PipelineName,
} from "./config-pack-protocol";

export interface ResolveTarget {
  platformId?: string;
  gender?: PackGender;
  primaryCategory?: string;
  secondaryCategory?: string;
}

/** 权重解析结果。source 用于排查「这组数字从哪来」。 */
export interface ResolvedWeights {
  /** 归一化到 0-1，便于直接参与加权计算。 */
  weights: Record<string, number>;
  source: "category" | "platform" | "defaults" | "balanced";
  platformId?: string;
  categoryId?: string;
}

/** 找到与目标匹配的分类；平台或频道不匹配时返回 undefined。 */
function findCategory(contents: PackContents, target: ResolveTarget) {
  if (!target.gender || !target.primaryCategory) return undefined;
  return contents.categories.find(
    (category) =>
      category.gender === target.gender &&
      (target.platformId ? category.platformId === target.platformId : true) &&
      category.primaryCategory === target.primaryCategory &&
      (target.secondaryCategory ? category.secondaryCategory === target.secondaryCategory : true),
  );
}

/** 目标平台；未指定时返回 undefined，由调用方处理缺失情况。 */
function findPlatform(contents: PackContents, platformId?: string) {
  if (platformId) return contents.platforms.find((platform) => platform.id === platformId);
  return undefined;
}

const hasKeys = (map?: Record<string, number>) => !!map && Object.keys(map).length > 0;

/**
 * 解析某 pipeline 的生效权重。
 *
 * 分类层已由 studio 在导出时把继承解析为实际值，所以命中分类即可直接采用；
 * 未命中分类才逐级回退到平台基准与频道兜底。
 */
export function resolveWeights(
  contents: PackContents | null,
  pipeline: PipelineName,
  target: ResolveTarget = {},
): ResolvedWeights {
  const dimensions = contents?.dimensions[pipeline];
  if (!contents || !dimensions) {
    return { weights: {}, source: "balanced" };
  }

  const category = findCategory(contents, target);
  const categoryWeights = category?.pipelines[pipeline]?.weights;
  if (hasKeys(categoryWeights)) {
    return {
      weights: normalize(categoryWeights!, dimensions),
      source: "category",
      platformId: category!.platformId,
      categoryId: category!.id,
    };
  }

  const platform = findPlatform(contents, target.platformId || category?.platformId);
  const gender = target.gender || category?.gender;
  if (platform && gender) {
    const platformWeights = platform.channels[gender]?.[pipeline]?.weights;
    if (hasKeys(platformWeights)) {
      return { weights: normalize(platformWeights!, dimensions), source: "platform", platformId: platform.id };
    }
    const fallback = contents.defaults[platform.id]?.[gender]?.[pipeline];
    if (hasKeys(fallback)) {
      return { weights: normalize(fallback!, dimensions), source: "defaults", platformId: platform.id };
    }
  }

  return { weights: balancedWeights(dimensions), source: "balanced", platformId: platform?.id };
}

/**
 * 解析某 pipeline 的提示词。
 *
 * 包是自包含的：categories.json 里的 prompt 已含平台通用追加，拿到即可直接用。
 */
export function resolvePrompt(
  contents: PackContents | null,
  pipeline: PipelineName,
  target: ResolveTarget = {},
): string {
  if (!contents) return "";
  const category = findCategory(contents, target);
  const own = category?.pipelines[pipeline]?.prompt?.trim();
  if (own) return own;

  const platform = findPlatform(contents, target.platformId || category?.platformId);
  const gender = target.gender || category?.gender;
  const base = (platform && gender ? platform.channels[gender]?.[pipeline]?.prompt : "")?.trim() || "";
  const append = platform?.promptAppend?.trim();
  if (!base) return append || "";
  return append ? `${base}\n\n${append}` : base;
}

/** 解析该分类的生成参数（temperature 等）；未命中分类时返回空对象。 */
export function resolveParams(contents: PackContents | null, target: ResolveTarget = {}) {
  if (!contents) return {};
  return findCategory(contents, target)?.params || {};
}

/**
 * 把包里的 0-100 权重换算成 0-1，并按维度表补齐缺失键。
 *
 * 换算而不是直接除以 100：包侧总和允许 ±1 的舍入残差，
 * 按实际总和归一才能保证加权总分落在 1-10 量纲内。
 */
function normalize(weights: Record<string, number>, dimensions: readonly DimensionSpec[]): Record<string, number> {
  const total = dimensions.reduce((sum, dimension) => sum + (weights[dimension.key] || 0), 0);
  if (total <= 0) return balancedWeights(dimensions);
  const result: Record<string, number> = {};
  for (const dimension of dimensions) {
    result[dimension.key] = (weights[dimension.key] || 0) / total;
  }
  return result;
}

/** 各维度等权，总和恰为 1。 */
export function balancedWeights(dimensions: readonly DimensionSpec[]): Record<string, number> {
  const result: Record<string, number> = {};
  const count = Math.max(dimensions.length, 1);
  for (const dimension of dimensions) result[dimension.key] = 1 / count;
  return result;
}
