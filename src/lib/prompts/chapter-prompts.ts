/**
 * 章节生成 prompt 模板
 * 六维并行 + 故事编排
 */

import type { AnalysisResult } from '@/features/novel-adaptation/types/adaptation'

// ── 大纲细化 ──────────────────────────────────────────────

export function buildChapterOutlineSystemPrompt(): string {
  return `## 身份
你是「章节策划师」，负责将章节大纲细化为可执行的内容蓝图。

## 任务
根据章节大纲和前文上下文，输出本章的详细走向和六维权重。

## 章节类型判断
根据章节在故事中的位置和内容，判断类型：
- 开篇：故事开始，建立世界观和人物
- 发展：推进情节，深化冲突
- 高潮：冲突爆发，关键转折
- 转折：剧情反转，揭示真相
- 过渡：场景切换，节奏调整
- 结局：收束故事，回收伏笔

## 六维权重分配
根据章节类型，分配六维权重（总计100）：
- 主线剧情：情节推进、信息揭示
- 故事张力：悬念、冲突、吸引力
- 情感表现：角色情感、共鸣感
- 情景转换：场景衔接、节奏、视角
- 伏笔呼应：回收前文伏笔
- 伏笔：新埋伏笔、暗示

## 输出格式
严格输出 JSON：
{
  "chapterType": "高潮",
  "keyEvents": ["事件1", "事件2"],
  "emotionalArc": "情绪变化轨迹",
  "tensionCurve": "张力变化描述",
  "sceneFlow": "场景A → 场景B → 场景C",
  "newForeshadowing": ["新伏笔1"],
  "callbackForeshadowing": ["需回收的前文伏笔1"],
  "dimensionWeights": {
    "mainPlot": 20,
    "tension": 30,
    "emotion": 20,
    "sceneTransition": 10,
    "callback": 15,
    "foreshadowing": 5
  },
  "scoreThreshold": 75
}`
}

export function buildChapterOutlineUserPrompt(params: {
  chapter: { name: string; summary: string; targetWords: number }
  chapterIndex: number
  totalChapters: number
  previousSummary: string
  analysis: AnalysisResult
  constraints: string[]
}): string {
  const { chapter, chapterIndex, totalChapters, previousSummary, analysis, constraints } = params

  const parts: string[] = []

  parts.push('## 章节信息')
  parts.push(`章节：${chapter.name}`)
  parts.push(`位置：第${chapterIndex + 1}章 / 共${totalChapters}章`)
  parts.push(`目标字数：${chapter.targetWords}`)
  parts.push(`摘要：${chapter.summary}`)

  if (previousSummary) {
    parts.push('')
    parts.push('## 前文已生成内容摘要')
    parts.push(previousSummary)
  }

  if (analysis.characters.length > 0) {
    parts.push('')
    parts.push('## 角色')
    parts.push(analysis.characters.join('\n'))
  }

  if (constraints.length > 0) {
    parts.push('')
    parts.push('## 约束条件')
    parts.push(constraints.join('\n'))
  }

  parts.push('')
  parts.push('请输出本章的详细走向和六维权重。严格 JSON 格式。')

  return parts.join('\n')
}

// ── 六维生成 ──────────────────────────────────────────────

interface DimensionPromptParams {
  chapter: { name: string; summary: string; targetWords: number }
  detailedOutline: {
    keyEvents: string[]
    emotionalArc: string
    tensionCurve: string
    sceneFlow: string
    newForeshadowing: string[]
    callbackForeshadowing: string[]
  }
  previousSummary: string
  analysis: AnalysisResult
  dimensionWeights: Record<string, number>
}

const DIMENSION_DEFINITIONS: Record<string, { name: string; focus: string; prompt: string }> = {
  mainPlot: {
    name: '主线剧情',
    focus: '情节推进、关键事件、信息揭示、逻辑性',
    prompt: `聚焦于主线情节的推进。
- 按照 keyEvents 逐个展开关键事件
- 确保信息揭示节奏合理，不过载也不遗漏
- 情节逻辑自洽，因果关系清晰
- 与前文衔接自然`
  },
  tension: {
    name: '故事张力',
    focus: '悬念设置、冲突升级、节奏把控、吸引力',
    prompt: `聚焦于故事张力的构建。
- 按照 tensionCurve 设计张力起伏
- 悬念设置要自然，不刻意
- 冲突升级有层次感
- 章末留钩子，驱动阅读`
  },
  emotion: {
    name: '情感表现',
    focus: '角色内心、情绪变化、对话潜台词、共鸣感',
    prompt: `聚焦于情感的表现。
- 按照 emotionalArc 设计情绪变化
- 角色内心活动细腻但不冗长
- 对话有潜台词，言外之意
- 展示而非告知情感`
  },
  sceneTransition: {
    name: '情景转换',
    focus: '场景切换、时间线处理、视角转换、节奏流畅',
    prompt: `聚焦于场景的转换和衔接。
- 按照 sceneFlow 设计场景切换
- 场景转换自然，不断裂
- 时间线处理清晰
- 节奏张弛有度`
  },
  callback: {
    name: '伏笔呼应',
    focus: '回收前文伏笔、前后关联、恍然感、逻辑自洽',
    prompt: `聚焦于前文伏笔的回收。
- 按照 callbackForeshadowing 列表逐个回收
- 回收要自然，不生硬
- 让读者产生"原来如此"的恍然感
- 回收同时可埋下新伏笔`
  },
  foreshadowing: {
    name: '伏笔',
    focus: '新伏笔质量、自然度、必要性、暗示力度',
    prompt: `聚焦于新伏笔的埋设。
- 按照 newForeshadowing 列表埋设新伏笔
- 伏笔要自然，融入叙事
- 暗示力度适中：太明显失去悬念，太隐晦无法察觉
- 每个伏笔要有后续回收计划`
  }
}

export function buildDimensionSystemPrompt(dimension: string): string {
  const def = DIMENSION_DEFINITIONS[dimension]
  if (!def) throw new Error(`未知维度: ${dimension}`)

  return `## 身份
你是「${def.name}」维度的写手，专注于${def.focus}。

## 任务
${def.prompt}

## 输出要求
- 直接输出章节正文内容，不要输出元信息
- 内容要完整，不要用省略号或占位符
- 保持与其他维度的风格一致
- 目标字数约占全章的60-80%（编排阶段会融合调整）`
}

export function buildDimensionUserPrompt(dimension: string, params: DimensionPromptParams): string {
  const { chapter, detailedOutline, previousSummary, analysis, dimensionWeights } = params
  const def = DIMENSION_DEFINITIONS[dimension]

  const parts: string[] = []

  parts.push(`## 章节：${chapter.name}`)
  parts.push(`目标字数：${chapter.targetWords}`)
  parts.push(`本维度权重：${dimensionWeights[dimension]}/100`)
  parts.push('')

  parts.push('## 章节走向')
  parts.push(`关键事件：${detailedOutline.keyEvents.join(' → ')}`)
  parts.push(`情绪轨迹：${detailedOutline.emotionalArc}`)
  parts.push(`张力变化：${detailedOutline.tensionCurve}`)
  parts.push(`场景流程：${detailedOutline.sceneFlow}`)

  if (detailedOutline.newForeshadowing.length > 0) {
    parts.push(`新伏笔：${detailedOutline.newForeshadowing.join('；')}`)
  }
  if (detailedOutline.callbackForeshadowing.length > 0) {
    parts.push(`需回收伏笔：${detailedOutline.callbackForeshadowing.join('；')}`)
  }

  if (previousSummary) {
    parts.push('')
    parts.push('## 前文摘要')
    parts.push(previousSummary)
  }

  if (analysis.characters.length > 0) {
    parts.push('')
    parts.push('## 角色')
    parts.push(analysis.characters.join('\n'))
  }

  parts.push('')
  parts.push(`请聚焦「${def.name}」维度，输出本章的正文内容。`)

  return parts.join('\n')
}

// ── 故事编排 ──────────────────────────────────────────────

export function buildOrchestratorSystemPrompt(): string {
  return `## 身份
你是「故事编排师」，负责将六个维度的内容融合为连贯的章节正文，并进行质量评分。

## 任务
1. 评分：对每个维度的内容按权重打分
2. 融合：将六维内容整合为一篇连贯的叙事
3. 调整：确保内容符合章节走向和质量要求

## 评分标准
- 按照每个维度的权重和实际质量打分
- 评分要客观，不要给虚高分
- 如果某个维度质量差，给低分并说明原因

## 融合原则
- 以主线剧情为骨架，其他维度为血肉
- 去重：不同维度的重复内容只保留一份
- 衔接：维度之间要有自然过渡
- 节奏：整体节奏符合章节的情绪曲线
- 字数：目标 ${'{targetWords}'} 字

## 输出格式
严格输出 JSON：
{
  "scores": {
    "mainPlot": { "score": 22, "reason": "评分理由" },
    "tension": { "score": 18, "reason": "评分理由" },
    "emotion": { "score": 14, "reason": "评分理由" },
    "sceneTransition": { "score": 13, "reason": "评分理由" },
    "callback": { "score": 12, "reason": "评分理由" },
    "foreshadowing": { "score": 8, "reason": "评分理由" }
  },
  "totalScore": 87,
  "pass": true,
  "content": "融合后的完整章节正文",
  "words": 3500,
  "adjustments": "调整说明"
}`
}

export function buildOrchestratorUserPrompt(params: {
  chapter: { name: string; summary: string; targetWords: number }
  detailedOutline: any
  dimensionContents: Record<string, string>
  dimensionWeights: Record<string, number>
  scoreThreshold: number
  previousSummary: string
  fixDimension?: string
  fixReason?: string
}): string {
  const { chapter, detailedOutline, dimensionContents, dimensionWeights, scoreThreshold, previousSummary, fixDimension, fixReason } = params

  const parts: string[] = []

  parts.push(`## 章节：${chapter.name}`)
  parts.push(`目标字数：${chapter.targetWords}`)
  parts.push(`通过阈值：${scoreThreshold}分`)

  parts.push('')
  parts.push('## 章节走向')
  parts.push(`关键事件：${detailedOutline.keyEvents.join(' → ')}`)
  parts.push(`情绪轨迹：${detailedOutline.emotionalArc}`)
  parts.push(`张力变化：${detailedOutline.tensionCurve}`)

  if (previousSummary) {
    parts.push('')
    parts.push('## 前文摘要')
    parts.push(previousSummary)
  }

  parts.push('')
  parts.push('## 六维内容')
  for (const [dim, content] of Object.entries(dimensionContents)) {
    parts.push(`### ${DIMENSION_DEFINITIONS[dim]?.name || dim}（权重：${dimensionWeights[dim]}）`)
    parts.push(content)
    parts.push('')
  }

  if (fixDimension) {
    parts.push('')
    parts.push(`## 修复要求`)
    parts.push(`「${DIMENSION_DEFINITIONS[fixDimension]?.name || fixDimension}」维度需要重新融合，原因：${fixReason}`)
  }

  parts.push('')
  parts.push('请对六维内容评分并融合为最终章节正文。严格 JSON 格式。')

  return parts.join('\n')
}
