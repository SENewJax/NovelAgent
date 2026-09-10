/**
 * 2.0 包的写路径 —— 管理界面编辑平台/分类/词表后落盘。
 *
 * 读路径在 pack-resolver.ts（只读），本文件补上「写」。
 * 编辑时即校验不变量（权重 key 在维度表内、总和 100），保存前再复核一次，
 * 保证不产出与 validatePackDirectory 冲突的数据。
 */
import fs from "fs/promises";
import path from "path";
import { GENDERS, PIPELINES, PipelineName, PackGender } from "./config-pack-protocol";
import { packManifestSchema, PackManifest } from "./config-pack-protocol";
import {
  PackCategory,
  PackContents,
  PackDefaults,
  PackPlatform,
} from "./config-pack-protocol";
import { FALLBACK_DIMENSIONS, FALLBACK_TAXONOMY } from "./fallback-pack";

/** 把内容写回磁盘的 6 个文件。 */
export async function savePackContents(dir: string, contents: PackContents): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const files: Array<[string, unknown]> = [
    ["manifest.json", contents.manifest],
    ["dimensions.json", contents.dimensions as unknown],
    ["taxonomy.json", contents.taxonomy],
    ["platforms.json", contents.platforms],
    ["categories.json", contents.categories],
    ["defaults.json", contents.defaults],
  ];
  for (const [name, value] of files) {
    await fs.writeFile(path.join(dir, name), JSON.stringify(value, null, 2), "utf-8");
  }
}

/** 新建包的合法 manifest。没有 id/name 时补默认值，避免创建即失败。 */
export function emptyPackManifest(overrides: Partial<PackManifest> = {}): PackManifest {
  const now = new Date().toISOString();
  return packManifestSchema.parse({
    id: "pack-" + Date.now().toString(36),
    name: "新建配置包",
    description: "",
    version: "1.0.0",
    formatVersion: "2.0",
    minimumAnalyzerVersion: "0.3.0",
    createdAt: now,
    updatedAt: now,
    author: "user",
    selfContained: true,
    ...overrides,
  });
}

/** 空平台：一个基准层实例，频道与 pipeline 都等权待填。 */
export function emptyPlatform(overrides: Partial<PackPlatform> = {}): PackPlatform {
  return {
    id: "platform-" + Date.now().toString(36),
    name: "新小说平台",
    code: "",
    genders: ["male"],
    promptAppend: "",
    channels: {},
    ...overrides,
  };
}

/** 空分类：挂在指定平台与频道下的一个叶子。 */
export function emptyCategory(
  platformId: string,
  gender: PackGender,
  primaryId: string,
  secondary: string,
): PackCategory {
  return {
    id: "cat-" + Date.now().toString(36),
    platformId,
    gender,
    primaryCategory: primaryId,
    secondaryCategory: secondary,
    inheritsWeights: true,
    params: {},
    pipelines: {},
  };
}

/** 从 fallback 维度表生成该 pipeline 的等权权重（0-1）。 */
export function balancedWeightsFor(pipeline: PipelineName): Record<string, number> {
  const dims = FALLBACK_DIMENSIONS[pipeline];
  const weight = 1 / dims.length;
  return Object.fromEntries(dims.map((d) => [d.key, weight]));
}

/**
 * 保证分类/平台的每个「频道 × pipeline」都有合法的权重表。
 *
 * 内容里的 weights 保持 0-100 整型（与 studio 一致），
 * 缺 pipeline 或空表时用等权填，避免保存后权重和为 0。
 */
export function ensureWeightTables(contents: PackContents): PackContents {
  const dimensions = contents.dimensions;
  const ensure = (weights: Record<string, number> | undefined, pipeline: PipelineName): Record<string, number> => {
    const keys = dimensions[pipeline].map((d) => d.key);
    if (!weights || Object.keys(weights).length === 0) {
      // 等权填充，把 100 的余数逐个分摊到最早出现的维度，保证总和恰为 100。
      const base = Math.floor(100 / keys.length);
      let remainder = 100 - base * keys.length;
      const out: Record<string, number> = {};
      for (const k of keys) {
        out[k] = base;
        if (remainder > 0) { out[k] += 1; remainder -= 1; }
      }
      return out;
    }
    // 去维度表外的键，补缺失键为 0，并归一化到 100。
    const cleaned = Object.fromEntries(keys.map((k) => [k, weights[k] ?? 0]));
    const sum = Object.values(cleaned).reduce((a, b) => a + b, 0) || 1;
    return Object.fromEntries(keys.map((k) => [k, Math.round((cleaned[k] / sum) * 100)]));
  };

  const categories = contents.categories.map((category) => ({
    ...category,
    pipelines: Object.fromEntries(
      PIPELINES.map((pipeline) => [
        pipeline,
        {
          weights: ensure(category.pipelines?.[pipeline]?.weights, pipeline),
          prompt: category.pipelines?.[pipeline]?.prompt ?? "",
        },
      ]),
    ),
  }));

  const platforms = contents.platforms.map((platform) => ({
    ...platform,
    channels: Object.fromEntries(
      GENDERS.filter((g) => platform.genders.includes(g)).map((gender) => [
        gender,
        Object.fromEntries(
          PIPELINES.map((pipeline) => [
            pipeline,
            {
              weights: ensure(platform.channels?.[gender]?.[pipeline]?.weights, pipeline),
              prompt: platform.channels?.[gender]?.[pipeline]?.prompt ?? "",
            },
          ]),
        ),
      ]),
    ),
  }));

  // defaults 兜底：与平台基准同构。
  const defaults: PackDefaults = { ...contents.defaults };
  for (const platform of platforms) {
    for (const gender of GENDERS.filter((g) => platform.genders.includes(g))) {
      defaults[platform.id] ??= {};
      defaults[platform.id][gender] ??= {};
      for (const pipeline of PIPELINES) {
        defaults[platform.id][gender][pipeline] =
          platform.channels[gender][pipeline]?.weights ?? {};
      }
    }
  }

  return { ...contents, categories, platforms, defaults };
}

/** 重新用 fallback 词表兜底词表为空/缺主体的情况。 */
export function ensureTaxonomy(contents: PackContents): PackContents {
  const taxonomy = contents.taxonomy?.male?.length || contents.taxonomy?.female?.length
    ? contents.taxonomy
    : FALLBACK_TAXONOMY;
  return { ...contents, taxonomy };
}
