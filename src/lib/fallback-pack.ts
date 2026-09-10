/**
 * 内置 2.0 默认配置 —— analyzer 不打包也能跑的兜底。
 *
 * 数据面、维度表与 studio 的 src/lib/pipelines.ts 对齐；分类词表与 studio 的
 * defaultTaxonomy() 对齐。包下发了任何内容都优先用包的，这里只在没有
 * 可消费的 2.0 包时生效。
 *
 * 注意：旧的 v0-default 包是 1.0 形状（weights.json + prompts/*.txt），
 * 已被新协议拒绝。这个文件就是切断 1.0 后的默认来源。
 */
import { CategoryTaxonomy, DimensionSpec, PIPELINES, PipelineName } from "./config-pack-protocol";
import { OTHER_CATEGORY_ID, OTHER_LABEL } from "./config-pack-protocol";

export const FALLBACK_DIMENSIONS: Record<PipelineName, readonly DimensionSpec[]> = {
  scorer: [
    { key: "satisfaction", label: "爽点密度" },
    { key: "emotion", label: "情感共鸣" },
    { key: "character", label: "人设吸引力" },
    { key: "tension", label: "剧情张力" },
    { key: "hook", label: "开篇吸引力" },
    { key: "growth", label: "成长空间" },
    { key: "pace", label: "节奏感" },
  ],
  analyst: [
    { key: "structure", label: "故事结构" },
    { key: "theme", label: "主题表达" },
    { key: "characterization", label: "人物塑造" },
    { key: "marketFit", label: "市场适配度" },
    { key: "worldbuilding", label: "世界观完整度" },
    { key: "writing", label: "文笔表达" },
    { key: "originality", label: "创新性" },
  ],
  reviewer: [
    { key: "accuracy", label: "准确性" },
    { key: "completeness", label: "完整性" },
    { key: "consistency", label: "一致性" },
    { key: "readability", label: "可读性" },
  ],
  writer: [
    { key: "hook", label: "开篇吸引力" },
    { key: "conflict", label: "冲突强度" },
    { key: "emotional", label: "情绪感染力" },
    { key: "pace", label: "节奏感" },
  ],
  "type-detector": [
    { key: "setting", label: "世界/背景设定" },
    { key: "theme", label: "主题表达" },
    { key: "evidence", label: "依据充分度" },
    { key: "confidence", label: "判断可信度" },
  ],
};

/** 等权兜底：每个维度权重相同，总和恰为 1。 */
export function fallbackWeights(pipeline: PipelineName): Record<string, number> {
  const dims = FALLBACK_DIMENSIONS[pipeline];
  const weight = 1 / dims.length;
  return Object.fromEntries(dims.map((d) => [d.key, weight]));
}

export const FALLBACK_TAXONOMY: CategoryTaxonomy = {
  male: [
    { id: "counterattack", label: "逆袭", secondary: ["扮猪吃虎", "草根崛起", "打脸虐渣", "赘婿逆袭", "战神归来"] },
    { id: "cultivation", label: "玄幻修仙", secondary: ["凡人修仙", "宗门传承", "升级流", "御兽", "剑修"] },
    { id: "rebirth", label: "重生", secondary: ["重回巅峰", "复仇改命", "预知先机"] },
    { id: "isekai_a", label: "穿越降维", secondary: ["异界称霸", "穿越回古代", "系统流"] },
    { id: "urban", label: "都市", secondary: ["兵王归来", "神医下山", "商战风云", "教师医者"] },
    { id: "fan", label: "同人衍生", secondary: ["游戏竞技", "直播", "娱乐明星"] },
    { id: OTHER_CATEGORY_ID, label: OTHER_LABEL, secondary: [OTHER_LABEL] },
  ],
  female: [
    { id: "ancient_romance", label: "古代言情", secondary: ["宅斗", "宫斗", "种田", "宅斗种田", "权谋", "探案"] },
    { id: "modern_romance", label: "现代言情", secondary: ["都市甜宠", "豪门婚恋", "都市系统", "青梅竹马", "破镜重圆"] },
    { id: "rebirth", label: "穿越重生", secondary: ["系统", "空间", "重生逆袭", "双洁", "带球跑"] },
    { id: "xianxia_romance", label: "仙侠情缘", secondary: ["师徒情缘", "修真历劫", "仙门大比", "虐恋"] },
    { id: "campus", label: "青春校园", secondary: ["学霸", "暗恋", "救赎", "成长"] },
    { id: "workplace", label: "职场人生", secondary: ["升职记", "商战", "复仇爽文", "女性成长"] },
    { id: OTHER_CATEGORY_ID, label: OTHER_LABEL, secondary: [OTHER_LABEL] },
  ],
};

/** 无包时的默认平台坐标。categoryDetection 未命中任何真实平台时按此回退。 */
export const FALLBACK_PLATFORM = {
  id: "fallback",
  name: "默认",
  code: "default",
  genders: ["male", "female"] as const,
};
