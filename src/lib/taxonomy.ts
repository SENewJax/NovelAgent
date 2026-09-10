/**
 * 分类归一 —— 规则与 studio 的 src/lib/taxonomy.ts 逐条对齐。
 *
 * studio 是词表权威，analyzer 只按同一套规则归一：
 * 1. 一级按 id 或 label 匹配词表；未命中 → 其他 / 其他。
 * 2. 一级命中后，二级必须在该一级的 secondary 清单内；否则 → 该一级 / 其他。
 * 3. 词表外内容一律归入其他，不静默接受新标签。
 *
 * 改这里的判定逻辑前先改 studio，两边必须同时改。
 */
import {
  CategoryTaxonomy,
  OTHER_CATEGORY_ID,
  OTHER_LABEL,
  PackGender,
  PrimaryCategoryNode,
} from "./config-pack-protocol";

/** 包里没有词表时的兜底节点，保证归一函数永远有结果可返。 */
const OTHER_NODE: PrimaryCategoryNode = {
  id: OTHER_CATEGORY_ID,
  label: OTHER_LABEL,
  secondary: [OTHER_LABEL],
};

export interface ResolvedCategory {
  primaryId: string;
  primaryLabel: string;
  secondary: string;
  /** 是否命中词表。false 表示被归入「其他」，供调用方决定是否降低置信度。 */
  inTaxonomy: boolean;
}

/** 按词表归一一组一级/二级分类。 */
export function resolveCategory(
  taxonomy: CategoryTaxonomy | undefined,
  gender: PackGender,
  primary: string,
  secondary: string,
): ResolvedCategory {
  const nodes = taxonomy?.[gender] || [];
  const primaryName = (primary || "").trim();
  const secondaryName = (secondary || "").trim();
  const fallback = nodes.find((node) => node.id === OTHER_CATEGORY_ID) || OTHER_NODE;

  const node = nodes.find((item) => item.id === primaryName || item.label === primaryName);
  if (!node) {
    return { primaryId: fallback.id, primaryLabel: fallback.label, secondary: OTHER_LABEL, inTaxonomy: false };
  }
  if (!node.secondary.includes(secondaryName)) {
    return { primaryId: node.id, primaryLabel: node.label, secondary: OTHER_LABEL, inTaxonomy: false };
  }
  return { primaryId: node.id, primaryLabel: node.label, secondary: secondaryName, inTaxonomy: true };
}

/** 该一级分类的显示名；找不到时回退原值，避免界面出现空白。 */
export function primaryLabel(
  taxonomy: CategoryTaxonomy | undefined,
  gender: PackGender,
  primaryId: string,
): string {
  const node = taxonomy?.[gender]?.find((item) => item.id === primaryId || item.label === primaryId);
  return node?.label || primaryId;
}

/**
 * 渲染成提示词里的候选清单。
 *
 * 只渲染当前频道 —— 把另一个频道的候选一起塞进去会让模型跨频道选错分类。
 */
export function taxonomyPrompt(taxonomy: CategoryTaxonomy | undefined, gender?: PackGender): string {
  if (!taxonomy) return "";
  const genders: PackGender[] = gender ? [gender] : ["male", "female"];
  const lines: string[] = [];
  for (const item of genders) {
    const nodes = taxonomy[item] || [];
    if (nodes.length === 0) continue;
    lines.push(`【${item === "male" ? "男频" : "女频"}】一级分类只能从下列 id 中选一个：`);
    for (const node of nodes) {
      lines.push(`- ${node.id}（${node.label}）：二级分类限 ${node.secondary.join("、")}`);
    }
    lines.push("");
  }
  if (lines.length === 0) return "";
  lines.push("禁止自创分类名称。无法归入任何一项时，一级填 other、二级填其他。");
  return lines.join("\n");
}
