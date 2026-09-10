/**
 * 按维度表生成 rubric。
 *
 * 原来 rubric.ts 把「（权重20%）」写在散文里 —— 那是给模型看的文本，不是可读取的数据。
 * 包下发权重后两者会立刻矛盾：模型看到 20%，加权时用的却是包里的值。
 * 这里改为「维度表定顺序与名称，权重表渲染百分比」，同一个数字只有一个来源。
 */
import { DimensionSpec } from "@/lib/config-pack-protocol";

/** 各维度的分档描述。key 与 studio 维度表一致，缺失时退回通用档位。 */
const SCALE_HINTS: Record<string, string[]> = {
  satisfaction: [
    "9-10: 每章至少2个明确爽点，层层递进",
    "7-8: 每2章1-2个爽点，节奏流畅",
    "5-6: 爽点间隔较长但质量尚可",
    "3-4: 爽点稀薄或套路感重",
    "1-2: 几乎没有爽感，平铺直叙",
  ],
  emotion: [
    "9-10: 通过具体行为/细节传递情感，有泪点/燃点",
    "7-8: 能感受到主角情绪，有代入感",
    "5-6: 有共鸣但不够深入，偶尔出戏",
    "3-4: 情感表达流于表面",
    "1-2: 无法产生情感连接",
  ],
  character: [
    "9-10: 一句话可概括，有标志性台词/行为",
    "7-8: 人设清晰有辨识度，对话风格有差异",
    "5-6: 人设存在但不突出",
    "3-4: 人设模糊，角色对话风格雷同",
    "1-2: 无明确人设",
  ],
  characterization: [
    "9-10: 塑造手法多样，人物弧光完整且有说服力",
    "7-8: 动机与行为一致，有成长轨迹",
    "5-6: 塑造可辨但手法单一",
    "3-4: 人物靠标签支撑，缺少行为佐证",
    "1-2: 塑造失效，人物随剧情漂移",
  ],
  tension: [
    "9-10: 章尾有强烈悬念，读者不忍放下",
    "7-8: 大部分章节有推进感，偶有强钩子",
    "5-6: 有起伏但悬念不足",
    "3-4: 剧情平淡，容易走神",
    "1-2: 无继续读下去的欲望",
  ],
  conflict: [
    "9-10: 冲突聚焦且逐级升级，代价明确",
    "7-8: 冲突清晰，推进有力",
    "5-6: 有冲突但强度不足",
    "3-4: 冲突分散或轻易化解",
    "1-2: 几乎无有效冲突",
  ],
  hook: [
    "9-10: 三秒内抓人，钩子直指核心矛盾",
    "7-8: 开篇利落，很快给出看点",
    "5-6: 铺垫偏长但能读下去",
    "3-4: 开篇拖沓，看点出现过晚",
    "1-2: 开篇无钩子",
  ],
  growth: [
    "9-10: 成长路径清晰，天花板高且可持续",
    "7-8: 有明确上升空间",
    "5-6: 成长空间有限但未见天花板",
    "3-4: 成长线模糊或过早封顶",
    "1-2: 无成长空间",
  ],
  pace: [
    "9-10: 张弛有度，信息密度稳定",
    "7-8: 节奏流畅，少量冗余",
    "5-6: 局部拖沓或过快",
    "3-4: 节奏明显失衡",
    "1-2: 节奏混乱",
  ],
  emotional: [
    "9-10: 情绪输出强烈且有层次",
    "7-8: 情绪表达到位",
    "5-6: 情绪平稳，缺少高点",
    "3-4: 情绪表达生硬",
    "1-2: 无情绪感染力",
  ],
  structure: [
    "9-10: 主线清晰，伏笔与回收成体系",
    "7-8: 结构完整，推进合理",
    "5-6: 结构基本成立，局部松散",
    "3-4: 结构混乱，主线漂移",
    "1-2: 无可辨结构",
  ],
  theme: [
    "9-10: 主题贯穿全篇且有表达深度",
    "7-8: 主题明确，与剧情契合",
    "5-6: 主题可辨但表达浅",
    "3-4: 主题模糊",
    "1-2: 无主题表达",
  ],
  marketFit: [
    "9-10: 精准命中目标读者的核心期待",
    "7-8: 契合赛道主流偏好",
    "5-6: 部分契合，定位略摇摆",
    "3-4: 与赛道期待有明显偏差",
    "1-2: 定位错位",
  ],
  worldbuilding: [
    "9-10: 自洽且有深度，设定服务于剧情",
    "7-8: 完整自洽，设定合理",
    "5-6: 基本自洽有小漏洞",
    "3-4: 设定随意，前后矛盾",
    "1-2: 严重矛盾，设定崩塌",
  ],
  writing: [
    "9-10: 有表现力，金句频出，有个人风格",
    "7-8: 流畅自然有特色",
    "5-6: 基本流畅，不拖后腿",
    "3-4: 偶有生硬，AI味重",
    "1-2: 表达混乱，语法错误多",
  ],
  originality: [
    "9-10: 题材/设定/叙事方式全新",
    "7-8: 旧瓶装新酒但酒很香",
    "5-6: 微创新但主体常规",
    "3-4: 纯套路，随处可见的模板",
    "1-2: 过度模仿，无新意",
  ],
  accuracy: ["9-10: 结论均有原文依据", "7-8: 基本准确", "5-6: 局部推断缺依据", "3-4: 多处与原文不符", "1-2: 结论不可信"],
  completeness: ["9-10: 该覆盖的都覆盖了", "7-8: 少量遗漏", "5-6: 明显遗漏但主干完整", "3-4: 大量缺失", "1-2: 基本未覆盖"],
  consistency: ["9-10: 前后完全一致", "7-8: 无实质冲突", "5-6: 局部口径不一", "3-4: 多处自相矛盾", "1-2: 结论互斥"],
  readability: ["9-10: 结论清晰可直接使用", "7-8: 表述清楚", "5-6: 需要二次理解", "3-4: 表述含混", "1-2: 无法阅读"],
  setting: ["9-10: 设定特征明确可判定", "7-8: 特征清楚", "5-6: 特征偏弱", "3-4: 特征混杂", "1-2: 无从判断"],
  evidence: ["9-10: 依据充分且可回溯原文", "7-8: 依据足够", "5-6: 依据偏少", "3-4: 依据薄弱", "1-2: 无依据"],
  confidence: ["9-10: 判定几乎无歧义", "7-8: 判定明确", "5-6: 存在次优候选", "3-4: 多个候选难分", "1-2: 无法判定"],
};

const GENERIC_SCALE = [
  "9-10: 表现突出，明显优于同类",
  "7-8: 表现良好，达到发表水准",
  "5-6: 中等，可读但无亮点",
  "3-4: 明显不足，需要修复",
  "1-2: 严重缺陷",
];

/** 生成 rubric 的维度小节，顺序严格跟随维度表。 */
function renderDimensions(dimensions: readonly DimensionSpec[], weights: Record<string, number>): string {
  return dimensions
    .map((dimension) => {
      const percent = Math.round((weights[dimension.key] ?? 0) * 100);
      const scale = SCALE_HINTS[dimension.key] || GENERIC_SCALE;
      return `### ${dimension.label}（权重${percent}%，字段名 ${dimension.key}）\n${scale.map((line) => `- ${line}`).join("\n")}`;
    })
    .join("\n\n");
}

/** 生成输出格式示例，字段名与维度表一致，避免模型猜键名。 */
function renderOutputShape(dimensions: readonly DimensionSpec[]): string {
  const entries = dimensions
    .map((dimension) => `    "${dimension.key}": { "score": 7, "comment": "${dimension.label}的一句话点评..." }`)
    .join(",\n");
  return `{\n  "scores": {\n${entries}\n  },\n  "summary": "一句话总结整体评价",\n  "emotional_beat": "平静→冲突→爆发"\n}`;
}

/**
 * 生成评分 rubric。
 *
 * @param dimensions 该 pipeline 的维度表，决定小节顺序与字段名
 * @param weights 归一化到 0-1 的生效权重，渲染成「（权重N%）」
 */
export function buildRubric(
  dimensions: readonly DimensionSpec[],
  weights: Record<string, number>,
): string {
  return `你是一个严格的小说评分员。你必须参照以下评分标准进行打分，输出严格JSON格式。

## 评分维度与标准

${renderDimensions(dimensions, weights)}

## 评分输出格式（严格JSON）
${renderOutputShape(dimensions)}

字段名必须与上表的 key 完全一致，不得增删维度。`;
}

/** 渲染「本次生效权重」块，供非评分角色的提示词声明注意力分配。 */
export function buildWeightBlock(
  dimensions: readonly DimensionSpec[],
  weights: Record<string, number>,
): string {
  if (dimensions.length === 0) return "";
  const lines = [...dimensions]
    .sort((a, b) => (weights[b.key] ?? 0) - (weights[a.key] ?? 0))
    .map((dimension) => `- ${dimension.label}（${Math.round((weights[dimension.key] ?? 0) * 100)}%）`);
  return `## 本次生效的注意力权重\n请按以下权重分配注意力：\n${lines.join("\n")}`;
}

/** 该 pipeline 的输出字段清单，用于在提示词里显式约束键名。 */
export function dimensionKeyList(dimensions: readonly DimensionSpec[]): string {
  return dimensions.map((dimension) => `${dimension.key}（${dimension.label}）`).join("、");
}
