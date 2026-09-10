import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { loadProject } from '@/lib/novel-store'
import {
  buildStructureExtractionPrompt,
  buildCharacterAnalysisPrompt,
  buildThemeStylePrompt,
  buildSynthesisPrompt
} from '@/lib/prompts/analysis-prompts'
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

// ── JSON 提取 + 验证 ────────────────────────────────────────

function extractJSON(text: string): any {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('未找到 JSON 格式')
  return JSON.parse(jsonMatch[0])
}

function validateNotEmpty(value: any, fieldName: string): void {
  if (!value || (typeof value === 'string' && value.trim().length < 10)) {
    throw new Error(`${fieldName} 内容过短或为空，AI 可能未正确分析`)
  }
}

// ── 单阶段执行（带重试） ─────────────────────────────────────

async function executeStage(
  stageName: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
  validate?: (result: any) => void
): Promise<any> {
  const MAX_RETRIES = 1

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const temp = attempt === 0 ? temperature : 0.1
    console.log(`[analyze] ${stageName} - 尝试 ${attempt + 1}, temperature=${temp}`)

    try {
      const raw = await callAI(
        baseUrl, apiKey, model,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temp,
        maxTokens
      )

      const result = extractJSON(raw)
      if (validate) validate(result)
      console.log(`[analyze] ${stageName} - 成功`)
      return result
    } catch (err: any) {
      console.error(`[analyze] ${stageName} - 失败 (attempt ${attempt + 1}):`, err.message)
      if (attempt === MAX_RETRIES) throw err
    }
  }
}

// ── 主路由 ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { novelId, filePath, userPrompt, model } = await req.json()

    if (!novelId && !filePath) {
      return NextResponse.json(
        { error: '请提供小说 ID 或文件路径' },
        { status: 400 }
      )
    }

    const config = getConfig()
    if (!config.ai.apiKey) {
      return NextResponse.json(
        { error: 'AI 服务未配置，请先在设置页面配置 API Key' },
        { status: 400 }
      )
    }

    // 读取小说内容
    let novelContent = ''
    let novelName = ''

    if (filePath) {
      const fs2 = await import('fs')
      const buffer = fs2.readFileSync(filePath)
      const content = buffer.toString('utf-8')
      novelContent = content.includes('�')
        ? buffer.toString('latin1')
        : content
      novelName = path.basename(filePath, path.extname(filePath))
    } else {
      const project = await loadProject(novelId)
      if (!project) {
        return NextResponse.json({ error: '小说不存在' }, { status: 404 })
      }
      const originalPath = path.join(process.cwd(), '.novel', novelId, 'original.txt')
      novelContent = await fs.readFile(originalPath, 'utf-8')
      novelName = project.name
    }

    // 采样：取前16000字（比原来的8000翻倍）
    const sampleContent = novelContent.slice(0, 16000)
    const selectedModel = model || config.ai.model
    const { baseUrl, apiKey } = config.ai

    console.log(`[analyze] 开始多阶段分析: ${novelName}, 模型=${selectedModel}, 内容长度=${sampleContent.length}`)

    // ── 阶段1：结构提取 ─────────────────────────────────────
    const stage1Prompts = buildStructureExtractionPrompt(novelName, sampleContent)
    const structureResult = await executeStage(
      '阶段1-结构提取',
      baseUrl, apiKey, selectedModel,
      stage1Prompts.system,
      stage1Prompts.user,
      0.3, 3000,
      (r) => {
        if (!r.scenes || !Array.isArray(r.scenes) || r.scenes.length === 0) {
          throw new Error('未提取到有效场景')
        }
      }
    )

    // ── 阶段2：人物图谱 ─────────────────────────────────────
    const stage2Prompts = buildCharacterAnalysisPrompt(
      novelName, sampleContent, JSON.stringify(structureResult, null, 2)
    )
    const characterResult = await executeStage(
      '阶段2-人物图谱',
      baseUrl, apiKey, selectedModel,
      stage2Prompts.system,
      stage2Prompts.user,
      0.3, 3000,
      (r) => {
        if (!r.characters || !Array.isArray(r.characters) || r.characters.length === 0) {
          throw new Error('未提取到有效角色')
        }
      }
    )

    // ── 阶段3：主题风格 ─────────────────────────────────────
    const stage3Prompts = buildThemeStylePrompt(
      novelName, sampleContent,
      JSON.stringify(structureResult, null, 2),
      JSON.stringify(characterResult, null, 2)
    )
    const themeResult = await executeStage(
      '阶段3-主题风格',
      baseUrl, apiKey, selectedModel,
      stage3Prompts.system,
      stage3Prompts.user,
      0.3, 2000,
      (r) => {
        if (!r.themes || !Array.isArray(r.themes) || r.themes.length === 0) {
          throw new Error('未提取到有效主题')
        }
      }
    )

    // ── 阶段4：综合分析 ─────────────────────────────────────
    const stage4Prompts = buildSynthesisPrompt(
      novelName,
      JSON.stringify(structureResult, null, 2),
      JSON.stringify(characterResult, null, 2),
      JSON.stringify(themeResult, null, 2)
    )
    const synthesisResult = await executeStage(
      '阶段4-综合分析',
      baseUrl, apiKey, selectedModel,
      stage4Prompts.system,
      stage4Prompts.user,
      0.5, 4000,
      (r) => {
        validateNotEmpty(r.background, '故事背景')
        validateNotEmpty(r.plotTrend, '剧情走向')
        validateNotEmpty(r.summary, '整体摘要')
      }
    )

    // ── 构造返回结果 ─────────────────────────────────────────
    const result = {
      analysisId: `analysis_${Date.now()}`,
      background: synthesisResult.background || '',
      characters: Array.isArray(synthesisResult.characters) ? synthesisResult.characters : [],
      plotTrend: synthesisResult.plotTrend || '',
      summary: synthesisResult.summary || '',
      originalOutline: synthesisResult.originalOutline || '',
      // 附加分析细节（供前端展示/调试）
      _details: {
        structure: structureResult,
        characters: characterResult,
        themes: themeResult
      }
    }

    console.log(`[analyze] 多阶段分析完成: ${novelName}`)
    return NextResponse.json({ success: true, data: result })
  } catch (error: any) {
    console.error('[adaptation/analyze] Error:', error)
    return NextResponse.json(
      { error: error.message || '分析失败' },
      { status: 500 }
    )
  }
}
