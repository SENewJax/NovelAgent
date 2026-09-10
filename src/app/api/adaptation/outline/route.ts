import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import {
  buildOutlineSystemPrompt,
  buildOutlineUserPrompt
} from '@/lib/prompts/outline-prompts'
import fs from 'fs/promises'
import path from 'path'

// ── AI 调用封装 ──────────────────────────────────────────────

interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

async function callAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: AIMessage[],
  temperature: number,
  maxTokens: number
): Promise<string> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`AI API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

// ── JSON 提取 ──────────────────────────────────────────────

function extractJSON(text: string): any {
  // 先尝试直接解析
  try {
    return JSON.parse(text)
  } catch {
    // 尝试提取 JSON 块
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('未找到 JSON 格式')
    return JSON.parse(jsonMatch[0])
  }
}

// ── 大纲验证 ──────────────────────────────────────────────

interface OutlineChapter {
  name: string
  summary: string
  targetWords: number
  chapterHook?: string
  writingConstraints?: string
}

interface OutlineVolume {
  name: string
  description: string
  chapters: OutlineChapter[]
}

interface OutlineResult {
  title: string
  type: string
  volumes: OutlineVolume[]
  globalConstraints: string[]
  estimatedTotalWords: number
}

function validateOutline(data: any): OutlineResult {
  if (!data.title || typeof data.title !== 'string') {
    throw new Error('大纲缺少标题')
  }
  if (!data.volumes || !Array.isArray(data.volumes) || data.volumes.length === 0) {
    throw new Error('大纲缺少卷结构或卷为空')
  }

  const chapters: OutlineChapter[] = []
  for (const vol of data.volumes) {
    if (!vol.chapters || !Array.isArray(vol.chapters) || vol.chapters.length === 0) {
      throw new Error(`卷"${vol.name || '未知'}"缺少章节`)
    }
    for (const ch of vol.chapters) {
      if (!ch.name) {
        throw new Error('存在缺少名称的章节')
      }
      chapters.push({
        name: ch.name,
        summary: ch.summary || '',
        targetWords: ch.targetWords || 5000,
        chapterHook: ch.chapterHook || '',
        writingConstraints: ch.writingConstraints || ''
      })
    }
  }

  if (chapters.length < 2) {
    throw new Error(`章节数过少（${chapters.length}章），至少需要 2 章`)
  }

  return {
    title: data.title,
    type: data.type || '网络小说',
    volumes: data.volumes,
    globalConstraints: data.globalConstraints || [],
    estimatedTotalWords: data.estimatedTotalWords || chapters.reduce((s, c) => s + c.targetWords, 0)
  }
}

// ── 主流程 ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { analysisId, analysis, options, model } = await req.json()

    if (!analysisId) {
      return NextResponse.json(
        { error: '请提供分析 ID' },
        { status: 400 }
      )
    }

    if (!analysis) {
      return NextResponse.json(
        { error: '请提供分析结果' },
        { status: 400 }
      )
    }

    // 使用项目统一的 AI 配置
    const config = getConfig()
    if (!config.ai.apiKey) {
      return NextResponse.json(
        { error: 'AI 服务未配置，请先在设置页面配置 API Key' },
        { status: 400 }
      )
    }

    const selectedModel = model || config.ai.model
    const baseUrl = config.ai.baseUrl

    // 创建输出目录
    const outputDir = path.join(process.cwd(), '.novel', 'adaptation', analysisId)
    await fs.mkdir(outputDir, { recursive: true })

    // 保存分析数据
    await fs.writeFile(
      path.join(outputDir, 'analysis.json'),
      JSON.stringify(analysis, null, 2),
      'utf-8'
    )

    // 构建 prompt
    const systemPrompt = buildOutlineSystemPrompt()
    const userPrompt = buildOutlineUserPrompt({ analysis, options })

    console.log('[adaptation/outline] 开始生成大纲...')
    console.log('[adaptation/outline] System prompt 长度:', systemPrompt.length)
    console.log('[adaptation/outline] User prompt 长度:', userPrompt.length)

    // 调用 AI（带重试）
    let rawResult = ''
    let parsed: OutlineResult | null = null
    const maxRetries = 2

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        rawResult = await callAI(
          baseUrl,
          config.ai.apiKey,
          selectedModel,
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          0.4,
          8000
        )

        console.log('[adaptation/outline] AI 返回长度:', rawResult.length)

        const jsonData = extractJSON(rawResult)
        parsed = validateOutline(jsonData)
        break // 成功则退出重试
      } catch (err: any) {
        console.warn(`[adaptation/outline] 第 ${attempt + 1} 次尝试失败:`, err.message)
        if (attempt === maxRetries) {
          throw new Error(`大纲生成失败（已重试 ${maxRetries} 次）: ${err.message}`)
        }
      }
    }

    if (!parsed) {
      throw new Error('大纲生成失败：无法解析 AI 返回结果')
    }

    // 保存大纲到文件
    await fs.writeFile(
      path.join(outputDir, 'outline.json'),
      JSON.stringify(parsed, null, 2),
      'utf-8'
    )

    // 生成扁平化的 chapters（用于 EmployeeClient 兼容的 plan.json）
    const flatChapters: OutlineChapter[] = []
    for (const vol of parsed.volumes) {
      for (const ch of vol.chapters) {
        flatChapters.push(ch)
      }
    }

    // 保存 EmployeeClient 兼容的 plan.json
    const planData = {
      title: parsed.title,
      type: parsed.type,
      chapters: flatChapters.map((ch, i) => ({
        index: i,
        name: ch.name,
        level: 2,
        summary: ch.summary || null,
        targetWords: ch.targetWords || 5000,
        status: 'pending'
      })),
      totalTargetWords: parsed.estimatedTotalWords,
      constraints: parsed.globalConstraints || [],
      batchSize: 2
    }
    await fs.writeFile(
      path.join(outputDir, 'plan.json'),
      JSON.stringify(planData, null, 2),
      'utf-8'
    )

    // 映射为前端需要的格式（扁平化 chapters）
    const outline = {
      outlineId: `outline_${Date.now()}`,
      title: parsed.title,
      type: parsed.type,
      chapters: flatChapters.map((ch, i) => ({
        index: i,
        name: ch.name,
        summary: ch.summary,
        targetWords: ch.targetWords,
        chapterHook: ch.chapterHook,
        writingConstraints: ch.writingConstraints
      })),
      totalTargetWords: parsed.estimatedTotalWords,
      constraints: parsed.globalConstraints,
      volumes: parsed.volumes,
      planFile: path.join(outputDir, 'plan.json')
    }

    return NextResponse.json({ success: true, data: outline })
  } catch (error: any) {
    console.error('[adaptation/outline] Error:', error)
    return NextResponse.json(
      { error: error.message || '生成大纲失败' },
      { status: 500 }
    )
  }
}
