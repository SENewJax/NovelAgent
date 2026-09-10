/**
 * 大纲主编 prompt 模板
 * 参考 AIEmployee "老墨"主编 agent 的方法论
 */

import type { AnalysisResult } from '@/features/novel-adaptation/types/adaptation'

interface OutlinePromptInput {
  analysis: AnalysisResult
  options?: {
    rewriteOptions?: string[]
    genre?: string
    customSettings?: string[]
    userPrompt?: string
  }
}

/**
 * 构建大纲主编的 system prompt
 */
export function buildOutlineSystemPrompt(): string {
  return `## 身份
你是「大纲主编」，负责将原作分析结果转化为一部**全新的改编小说大纲**。

## 核心原则
**改编 ≠ 翻译/润色/微调。改编 = 以原作为灵感素材，创作一个全新的故事。**

你必须做到：
- 世界观可以彻底重构（如现代→异世界、修仙→科幻）
- 角色身份可以完全改变（保留性格内核，但换了背景、职业、关系）
- 情节线必须有大量原创内容，不能只是"换皮重写"
- 节奏和结构应该服务于新故事，而非照搬原作节奏

## 方法论

### 第一步：理解原作核心要素
- 从分析结果中提取：核心冲突类型、角色性格内核、主题思想
- 区分"可移植的内核"（角色性格、情感模式、冲突类型）和"必须替换的外壳"（具体设定、场景、事件）

### 第二步：执行改编指令（最重要）
用户的改写方向和类型选择是**最高优先级指令**，必须充分体现：
- 如果用户选择"重生到异世界"，就必须构建全新的异世界设定，角色必须经历穿越/重生事件
- 如果用户选择"反派洗白"，就必须重新设计角色立场和阵营关系
- 改编幅度必须大到让读者觉得"这是一个新故事"，而不是"原作换了个名字"

### 第三步：设计全新的分卷结构
- 根据新世界观和新情节线设计 2-4 卷，不要照搬原作的分卷逻辑
- 每卷有独立的子冲突和阶段性目标
- 第一卷前 3 章必须完成"入坑三件套"：新世界观展示、新角色魅力、核心冲突铺开

### 第四步：规划章节
- 每章设定明确的"章核"（本章要推进的核心信息或事件）
- 控制单章信息密度：不超过 2 个新信息点 + 1 个情绪转折
- 章末设置微钩子（疑问、反转、伏笔），维持阅读动力
- 根据内容复杂度动态分配字数：关键章节加长，过渡章节精简

### 第五步：输出约束
- 为每个章节生成"写作约束"：节奏要求、视角限制、伏笔提醒
- 为整部小说设定"全局约束"：文风基调、字数目标、禁止元素

## 禁止事项
- 不输出章节正文内容，只输出大纲结构
- 不使用过于笼统的章节描述（如"主角经历了冒险"）
- **禁止照搬原作情节线**——原作仅供参考，新故事必须有独立的情节走向
- **禁止只做表面修改**——只换名字、换地点但情节走向雷同是不合格的

## 输出格式
严格输出 JSON，不要添加任何 markdown 包装或额外文本：
{
  "title": "改编小说标题（必须是新标题，不能是原作标题加前缀后缀）",
  "type": "网络小说",
  "volumes": [
    {
      "name": "卷名",
      "description": "本卷核心冲突和走向",
      "chapters": [
        {
          "name": "章节名",
          "summary": "本章要推进的核心内容（50-150字）",
          "targetWords": 5000,
          "chapterHook": "章末钩子描述",
          "writingConstraints": "写作约束"
        }
      ]
    }
  ],
  "globalConstraints": ["全局约束1", "全局约束2"],
  "estimatedTotalWords": 50000
}`
}

/**
 * 构建大纲主编的 user prompt
 */
export function buildOutlineUserPrompt({ analysis, options }: OutlinePromptInput): string {
  const parts: string[] = []

  // 原作分析
  parts.push('## 原作分析结果')
  parts.push('')
  parts.push('### 故事背景')
  parts.push(analysis.background)
  parts.push('')
  parts.push('### 剧情走向')
  parts.push(analysis.plotTrend)
  parts.push('')
  parts.push('### 整体摘要')
  parts.push(analysis.summary)

  // 角色信息（优先用 details 中的结构化数据）
  const details = analysis._details
  if (details?.stage2?.mainCharacters?.length) {
    parts.push('')
    parts.push('### 角色图谱')
    for (const c of details.stage2.mainCharacters) {
      parts.push(`- **${c.name}**（${c.role}）：${c.personality}；动机：${c.motivation}；与他人关系：${c.relationships?.join('、') || '无'}`)
    }
  } else if (analysis.characters.length > 0) {
    parts.push('')
    parts.push('### 主要角色')
    parts.push(analysis.characters.join('\n'))
  }

  // 主题风格（优先用 details）
  if (details?.stage3?.themes?.length) {
    parts.push('')
    parts.push('### 主题与风格')
    parts.push(`核心主题：${details.stage3.themes.join('、')}`)
    if (details.stage3.writingStyle) {
      parts.push(`写作风格：${details.stage3.writingStyle}`)
    }
    if (details.stage3.foreshadowing?.length) {
      parts.push(`伏笔清单：${details.stage3.foreshadowing.join('；')}`)
    }
  }

  // 结构信息（优先用 details）
  if (details?.stage1?.conflictStructure) {
    parts.push('')
    parts.push('### 冲突结构')
    parts.push(details.stage1.conflictStructure)
  }

  // 原始大纲
  if (analysis.originalOutline) {
    parts.push('')
    parts.push('### 原始大纲')
    parts.push(analysis.originalOutline)
  }

  // 改编指令（最高优先级）
  if (options) {
    parts.push('')
    parts.push('## ⚠️ 改编指令（最高优先级，必须充分体现）')

    if (options.rewriteOptions?.length) {
      parts.push('')
      parts.push('### 改写方向（必须全部体现）')
      for (const opt of options.rewriteOptions) {
        parts.push(`- 【必须执行】${opt}`)
      }
      parts.push('')
      parts.push('以上改写方向是硬性要求，不是建议。新大纲必须让读者明显感受到每个改写方向的影响。')
    }
    if (options.genre) {
      parts.push('')
      parts.push(`### 目标类型：${options.genre}`)
      parts.push(`新故事必须完全符合「${options.genre}」类型的特征和套路，包括该类型的经典桥段、节奏模式、爽点设计。`)
    }
    if (options.customSettings?.length) {
      parts.push('')
      parts.push('### 自定义设定')
      for (const s of options.customSettings) {
        parts.push(`- ${s}`)
      }
    }
    if (options.userPrompt) {
      parts.push('')
      parts.push(`### 用户补充要求：${options.userPrompt}`)
    }
  }

  parts.push('')
  parts.push('## 输出要求')
  parts.push('请根据以上原作分析（仅作为灵感素材）和改编指令（必须充分体现），设计一个全新的改编大纲。')
  parts.push('新故事必须与原作有明显差异——读者应该觉得这是一个"受原作启发的新故事"，而不是"原作的复述"。')
  parts.push('输出严格 JSON 格式。')

  return parts.join('\n')
}
