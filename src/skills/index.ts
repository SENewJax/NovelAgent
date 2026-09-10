// Skill 知识库统一导出 + 性别路由

import { Gender } from "@/scoring/types";
import { MALE_TYPE_CHARACTERS } from "./male/type-and-characters";
import { MALE_STRUCTURE } from "./male/structure";
import { MALE_SATISFACTION } from "./male/satisfaction";
import { MALE_REVIEW_CHECKLIST } from "./male/review-checklist";
import { FEMALE_TYPE_CHARACTERS } from "./female/type-and-characters";
import { FEMALE_STRUCTURE } from "./female/structure";
import { FEMALE_SATISFACTION } from "./female/satisfaction";
import { FEMALE_REVIEW_CHECKLIST } from "./female/review-checklist";

export { MALE_TYPE_CHARACTERS } from "./male/type-and-characters";
export { MALE_STRUCTURE } from "./male/structure";
export { MALE_SATISFACTION } from "./male/satisfaction";
export { MALE_REVIEW_CHECKLIST } from "./male/review-checklist";
export { FEMALE_TYPE_CHARACTERS } from "./female/type-and-characters";
export { FEMALE_STRUCTURE } from "./female/structure";
export { FEMALE_SATISFACTION } from "./female/satisfaction";
export { FEMALE_REVIEW_CHECKLIST } from "./female/review-checklist";

/** 按性别获取对应的知识库 */
export interface SkillKnowledge {
  typeAndCharacters: string;
  structure: string;
  satisfaction: string;
  reviewChecklist: string;
}

export function getSkillKnowledge(gender: Gender): SkillKnowledge {
  if (gender === "male") {
    return {
      typeAndCharacters: MALE_TYPE_CHARACTERS,
      structure: MALE_STRUCTURE,
      satisfaction: MALE_SATISFACTION,
      reviewChecklist: MALE_REVIEW_CHECKLIST,
    };
  }
  return {
    typeAndCharacters: FEMALE_TYPE_CHARACTERS,
    structure: FEMALE_STRUCTURE,
    satisfaction: FEMALE_SATISFACTION,
    reviewChecklist: FEMALE_REVIEW_CHECKLIST,
  };
}

/** 合并两套知识库用于型判定（分析时自动反推） */
export function getMergedTypeKnowledge(): string {
  return `
=== 男频知识库 ===
${MALE_TYPE_CHARACTERS}

=== 女频知识库 ===
${FEMALE_TYPE_CHARACTERS}
`;
}

/** 获取赛道路由表（用于型判定 Agent） */
export const TRACK_ROUTING_TABLE = `
## 男频赛道路由
| 型 | 赛道 | 关键词 |
|----|------|--------|
| 成长型 | 逆袭 | 都市底层、赘婿、扮猪吃虎、金手指、打脸逆袭 |
| 成长型 | 修仙 | 修真、灵根、宗门、功法、境界、丹器 |
| 成长型 | 玄幻 | 战力体系、越级、神兽、秘境、天界 |
| 身份型 | 战神 | 兵王、龙王、殿主、军团、归来、护短 |
| 身份型 | 赘婿 | 上门女婿、护妻、入赘、被看不起 |
| 身份型 | 霸总 | 商战、财团、资本、做空、马甲 |
| 预知型 | 重生 | 前世、惨死、重生、清算、复仇 |
| 预知型 | 穿越A(降维流) | 现代穿古代、系统商城、文明降维、火器 |
| 预知型 | 穿越B(穿书流) | 穿书、天命、白莲花、截胡、蝴蝶效应 |

## 女频赛道路由
| 型 | 赛道 | 关键词 |
|----|------|--------|
| 实力逆袭型 | 职场 | 职场、升职、创业、商战、被排挤 |
| 实力逆袭型 | 学霸 | 竞赛、学术、被顶替、智商碾压 |
| 实力逆袭型 | 医生 | 医术、手术、疑难杂症、神医 |
| 身份反转型 | 穿越修仙 | 穿修仙、金手指、马甲、宗门 |
| 身份反转型 | 真千金 | 真假千金、DNA、豪门、假千金 |
| 身份反转型 | 马甲 | 多重身份、隐藏技能、马甲掉落 |
| 情感关系型 | 虐文言情 | 前世、替身、渣男、追悔、双向奔赴 |
`;

/** 男频型列表 */
export const MALE_TYPES = [
  { value: "growth", label: "成长型" },
  { value: "identity", label: "身份型" },
  { value: "precognition", label: "预知型" },
] as const;

/** 女频型列表 */
export const FEMALE_TYPES = [
  { value: "strength_reversal", label: "实力逆袭型" },
  { value: "identity_reversal", label: "身份反转型" },
  { value: "emotional", label: "情感关系型" },
] as const;

/** 男频赛道列表 */
export const MALE_TRACKS = [
  { value: "counterattack", label: "逆袭" },
  { value: "cultivation", label: "修仙" },
  { value: "fantasy", label: "玄幻" },
  { value: "war_god", label: "战神" },
  { value: "son_in_law", label: "赘婿" },
  { value: "ceo", label: "霸总" },
  { value: "rebirth", label: "重生" },
  { value: "isekai_a", label: "穿越(降维流)" },
  { value: "isekai_b", label: "穿越(穿书流)" },
] as const;

/** 女频赛道列表 */
export const FEMALE_TRACKS = [
  { value: "workplace", label: "职场" },
  { value: "scholar", label: "学霸" },
  { value: "doctor", label: "医生" },
  { value: "cultivation_isekai", label: "穿越修仙" },
  { value: "true_heiress", label: "真千金" },
  { value: "vest", label: "马甲" },
  { value: "angst_romance", label: "虐文言情" },
] as const;

/** 根据型获取对应赛道列表 */
export function getTracksByType(type: string): readonly { value: string; label: string }[] {
  const maleTypeTrackMap: Record<string, string[]> = {
    growth: ["counterattack", "cultivation", "fantasy"],
    identity: ["war_god", "son_in_law", "ceo"],
    precognition: ["rebirth", "isekai_a", "isekai_b"],
  };
  const femaleTypeTrackMap: Record<string, string[]> = {
    strength_reversal: ["workplace", "scholar", "doctor"],
    identity_reversal: ["cultivation_isekai", "true_heiress", "vest"],
    emotional: ["angst_romance"],
  };

  if (type in maleTypeTrackMap) {
    const allowed = maleTypeTrackMap[type];
    return MALE_TRACKS.filter((t) => allowed.includes(t.value));
  }
  if (type in femaleTypeTrackMap) {
    const allowed = femaleTypeTrackMap[type];
    return FEMALE_TRACKS.filter((t) => allowed.includes(t.value));
  }
  return [];
}

/** 根据赛道值获取标签 */
export function getTrackLabel(trackValue: string): string {
  const allTracks = [...MALE_TRACKS, ...FEMALE_TRACKS];
  const found = allTracks.find((t) => t.value === trackValue);
  return found?.label ?? trackValue;
}

/** 根据型值获取标签 */
export function getTypeLabel(typeValue: string): string {
  const allTypes = [...MALE_TYPES, ...FEMALE_TYPES];
  const found = allTypes.find((t) => t.value === typeValue);
  return found?.label ?? typeValue;
}
