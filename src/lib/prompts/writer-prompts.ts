/**
 * 写手 prompt 模板
 * 参考 AIEmployee "陆青"写手 agent 的方法论
 */

import type { AnalysisResult } from '@/features/novel-adaptation/types/adaptation'

/**
 * 构建写手的 system prompt
 * @param analysis 分析结果（可选，用于注入角色/主题/风格信息）
 * @param outlineTitle 大纲标题
 * @param outlineType 大纲类型
 */
export function buildWriterSystemPrompt(
  analysis?: AnalysisResult | null,
  outlineTitle?: string,
  outlineType?: string
): string {
  const base = `## 身份
你是「小说写手」，负责根据大纲计划创作小说正文。

## 写作原则

### 人物一致性
- 每个角色有独立的"声纹"：说话方式、用词习惯、情绪表达模式
- 角色行为必须符合其动机和性格，不因剧情需要而"降智"
- 角色成长要渐进，有铺垫、有触发事件、有行为变化

### 叙事节奏
- 动作场景：短句为主，节奏快，多用动词，少用形容词
- 情感场景：允许长句，细腻描写内心活动，适当使用隐喻
- 信息场景：通过对话或行动自然传递，避免大段旁白解释
- 每 2000-3000 字设置一个小转折或新信息，维持阅读兴趣

### 场景描写
- 五感描写：视觉、听觉、嗅觉、触觉、味觉，至少覆盖 2-3 种
- 环境与情绪呼应：场景氛围服务于叙事情绪
- 动态描写优于静态描写：用人物行动展现环境

### 对话技巧
- 对话推动情节或展现人物，不做无意义的寒暄
- 潜台词：角色说的和想的不完全一致时，通过动作、神态暗示
- 对话节奏：长句短句交替，避免所有角色说话方式雷同

### 伏笔与回收
- 前文埋下的伏笔，后文必须回收
- 回收时要让读者产生"原来如此"的恍然感
- 新的伏笔可以在回收旧伏笔的同时埋下

## 禁止事项
- 不输出章节标题以外的元信息（如"本章要点"、"写作说明"）
- 不使用"他不禁想到"、"她突然意识到"等懒人写法
- 不在同一段落中混合多个场景
- 不通过旁白直接告诉读者角色的情感（展示，而非告知）
- 不使用过度的感叹号和省略号`

  // 注入角色信息
  const characterSection = buildCharacterSection(analysis)

  // 注入风格要求
  const styleSection = buildStyleSection(analysis)

  // 注入约束
  const constraintSection = buildConstraintSection(outlineTitle, outlineType)

  return [base, characterSection, styleSection, constraintSection].filter(Boolean).join('\n\n')
}

/**
 * 构建角色信息段落
 */
function buildCharacterSection(analysis?: AnalysisResult | null): string {
  if (!analysis) return ''

  const details = analysis._details
  const lines: string[] = ['## 角色设定']

  if (details?.stage2?.mainCharacters?.length) {
    for (const c of details.stage2.mainCharacters) {
      lines.push(`### ${c.name}（${c.role}）`)
      lines.push(`- 性格：${c.personality}`)
      lines.push(`- 动机：${c.motivation}`)
      if (c.relationships?.length) {
        lines.push(`- 关系：${c.relationships.join('；')}`)
      }
      if (c.arc) {
        lines.push(`- 成长线：${c.arc}`)
      }
    }
  } else if (analysis.characters.length > 0) {
    lines.push('主要角色：')
    for (const c of analysis.characters) {
      lines.push(`- ${c}`)
    }
  } else {
    return ''
  }

  return lines.join('\n')
}

/**
 * 构建风格要求段落
 */
function buildStyleSection(analysis?: AnalysisResult | null): string {
  if (!analysis) return ''

  const details = analysis._details
  const lines: string[] = ['## 风格要求']

  if (details?.stage3?.writingStyle) {
    lines.push(`写作风格：${details.stage3.writingStyle}`)
  }

  if (details?.stage3?.themes?.length) {
    lines.push(`核心主题：${details.stage3.themes.join('、')}`)
  }

  if (details?.stage3?.foreshadowing?.length) {
    lines.push('待回收伏笔：')
    for (const f of details.stage3.foreshadowing) {
      lines.push(`- ${f}`)
    }
  }

  if (details?.stage1?.hooks?.length) {
    lines.push('叙事钩子：')
    for (const h of details.stage1.hooks) {
      lines.push(`- ${h}`)
    }
  }

  // 如果没有任何风格信息，返回空
  if (lines.length === 1) return ''

  return lines.join('\n')
}

/**
 * 构建约束段落
 */
function buildConstraintSection(title?: string, type?: string): string {
  const lines: string[] = ['## 写作约束']

  if (title) {
    lines.push(`- 小说标题：${title}`)
  }
  if (type) {
    lines.push(`- 小说类型：${type}`)
  }
  lines.push('- 每章不少于 3000 字')
  lines.push('- 章节之间保持情节连贯，不要出现断裂感')
  lines.push('- 严格按照大纲的章节结构创作，不要跳过或合并章节')

  return lines.join('\n')
}
