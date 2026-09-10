// 角色注意力维度 Schema
//
// 设计理念：权重 = 角色偏好（注意力点），按"权责关系"逐角色列举、互不通用。
// - 权重会被注入到每个角色的提示词中（注意力块）。
// - 角色执行后输出 JSON，系统校验输出是否符合注意力权重，不符则重试。
// - 权重支持自动训练（基于 few-shot 区分度）与手动微调。
// - 提供"均衡默认值"：每个注意力维度等权。

/** 所有角色的 Agent 名称 */
export type AgentName =
  | "scorer"
  | "analyst"
  | "writer"
  | "planner"
  | "type-detector"
  | "reviewer"
  | "deai"
  | "chat"
  | "extract"
  | "refine"
  | "generate";

/** 单个注意力维度 */
export interface AttentionDim {
  key: string;        // 权重键（JSON 中的字段名）
  label: string;      // 中文标签
  description: string; // 该注意力点对本角色的含义
}

/** 一个角色在某一性别下的注意力权重表（各键之和应为 1） */
export type RoleWeights = Record<string, number>;

/** 一个角色的三套权重：default / male / female */
export interface RoleGenderWeights {
  default: RoleWeights;
  male?: RoleWeights;
  female?: RoleWeights;
}

/** 配置包的权重：每个角色一套 */
export type PackWeights = Record<string, RoleGenderWeights>;

/**
 * 每个角色的注意力维度（按权责列举，互不通用）
 */
export const ROLE_ATTENTION: Record<AgentName, AttentionDim[]> = {
  scorer: [
    { key: "satisfaction_density", label: "爽点密度", description: "力量展示/身份碾压/观众震惊等爽点的密度与兑现" },
    { key: "emotional_resonance", label: "情感共鸣", description: "情感线的代入感与共鸣强度" },
    { key: "character_appeal", label: "人设魅力", description: "主角/配角人设的吸引力与立体度" },
    { key: "plot_tension", label: "剧情张力", description: "冲突强度与悬念钩子" },
    { key: "worldbuilding", label: "世界观", description: "世界观设定的完整度与自洽性" },
    { key: "writing_quality", label: "文笔质量", description: "文字表达、台词、描写的质量" },
    { key: "originality", label: "创新性", description: "情节与人设的原创性、反套路程度" },
  ],
  analyst: [
    { key: "style", label: "风格敏锐", description: "对原作叙事风格、语言节奏的识别准确度" },
    { key: "world", label: "世界观提炼", description: "世界观规则/设定提炼的完整性" },
    { key: "character", label: "人设洞察", description: "角色动机、关系、弧光的洞察深度" },
  ],
  writer: [
    { key: "satisfaction", label: "爽点", description: "章节爽点的铺设与兑现（越级战/打脸/身份揭晓）" },
    { key: "pacing", label: "节奏", description: "叙事节奏张弛，情绪起伏的编排" },
    { key: "hook", label: "章末钩子", description: "章末悬念钩子的强度" },
    { key: "dialogue", label: "台词", description: "台词的性格化与赛道风格贴合" },
    { key: "description", label: "描写", description: "场景/动作/情绪描写的画面感" },
  ],
  planner: [
    { key: "structure", label: "结构", description: "章节结构与主线推进的合理性" },
    { key: "foreshadowing", label: "伏笔", description: "伏笔的埋设与回收" },
    { key: "conflict", label: "冲突", description: "冲突设计与升级曲线" },
    { key: "rhythm", label: "章节节奏", description: "爽点/舒缓在章节间的分布" },
  ],
  "type-detector": [
    { key: "gender_signal", label: "性别信号", description: "主角性别/情感线/爽感来源等性别判定依据" },
    { key: "type_signal", label: "型信号", description: "变强/亮身份/预知等型判定依据" },
    { key: "track_signal", label: "赛道信号", description: "题材、设定等赛道判定依据" },
  ],
  reviewer: [
    { key: "fatal", label: "命门", description: "赛道命门/致命缺陷的检出" },
    { key: "track_rules", label: "赛道规则", description: "赛道价值观与反面清单的符合度" },
    { key: "logic", label: "逻辑自洽", description: "剧情逻辑与人设行为的一致性" },
  ],
  deai: [
    { key: "naturalness", label: "自然度", description: "去机器味后的表达自然程度" },
    { key: "diversity", label: "表达多样", description: "句式/用词的多样性，避免模板化" },
    { key: "rhythm", label: "句式节奏", description: "长短句交错的节奏感" },
  ],
  chat: [
    { key: "understanding", label: "理解", description: "对用户创作意图的理解准确度" },
    { key: "guidance", label: "引导", description: "主动引导补全关键设定的能力" },
  ],
  extract: [
    { key: "completeness", label: "完整", description: "设定信息提取的完整性" },
    { key: "accuracy", label: "准确", description: "性别/型/赛道判定的准确性" },
  ],
  refine: [
    { key: "responsiveness", label: "响应修改", description: "对用户修改要求的落实程度" },
    { key: "consistency", label: "一致性", description: "与前后文/赛道风格的一致性" },
  ],
  generate: [
    { key: "satisfaction", label: "爽点", description: "章节爽点的铺设与兑现" },
    { key: "pacing", label: "节奏", description: "叙事节奏张弛，情绪起伏的编排" },
    { key: "hook", label: "章末钩子", description: "章末悬念钩子的强度" },
    { key: "dialogue", label: "台词", description: "台词的性格化与赛道风格贴合" },
    { key: "description", label: "描写", description: "场景/动作/情绪描写的画面感" },
  ],
};

/**
 * 均衡权重：每个注意力维度等权，且总和恰为 1
 */
export function balancedWeights(dims: AttentionDim[]): RoleWeights {
  const w: RoleWeights = {};
  const n = Math.max(dims.length, 1);
  const base = Math.floor(100 / n);
  let remainder = 100 - base * n;
  for (const d of dims) {
    let pct = base;
    if (remainder > 0) {
      pct += 1;
      remainder -= 1;
    }
    w[d.key] = pct / 100;
  }
  return w;
}

/** 评分员的男频权重：提升爽点、降低情感（沿用既有性别化策略，总和为 1） */
export const SCORER_MALE_WEIGHTS: RoleWeights = {
  satisfaction_density: 0.25,
  emotional_resonance: 0.15,
  character_appeal: 0.15,
  plot_tension: 0.15,
  worldbuilding: 0.1,
  writing_quality: 0.1,
  originality: 0.1,
};

/** 评分员的女频权重：提升情感、降低爽点（沿用既有性别化策略，总和为 1） */
export const SCORER_FEMALE_WEIGHTS: RoleWeights = {
  satisfaction_density: 0.15,
  emotional_resonance: 0.25,
  character_appeal: 0.15,
  plot_tension: 0.15,
  worldbuilding: 0.1,
  writing_quality: 0.1,
  originality: 0.1,
};

/**
 * 默认权重（均衡）：
 * - default：所有角色每个注意力维度等权
 * - male/female：仅评分员做爽点/情感倾斜，其余角色与 default 一致
 */
export function buildDefaultPackWeights(): PackWeights {
  const result: PackWeights = {};
  for (const name of Object.keys(ROLE_ATTENTION) as AgentName[]) {
    const balanced = balancedWeights(ROLE_ATTENTION[name]);
    if (name === "scorer") {
      result[name] = {
        default: balanced,
        male: { ...SCORER_MALE_WEIGHTS },
        female: { ...SCORER_FEMALE_WEIGHTS },
      };
    } else {
      result[name] = { default: balanced };
    }
  }
  return result;
}

/**
 * 获取某角色在某性别下的权重（从 roleGenderWeights 中选取，回退 default）
 */
export function pickRoleWeights(
  roleWeights: RoleGenderWeights | undefined,
  gender?: "male" | "female"
): RoleWeights {
  if (!roleWeights) return {};
  if (gender === "male" && roleWeights.male) return roleWeights.male;
  if (gender === "female" && roleWeights.female) return roleWeights.female;
  return roleWeights.default || {};
}
