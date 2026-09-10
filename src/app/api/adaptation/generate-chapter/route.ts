import { NextRequest } from 'next/server'
import { getConfig } from '@/lib/config'
import {
  buildChapterOutlineSystemPrompt,
  buildChapterOutlineUserPrompt,
  buildDimensionSystemPrompt,
  buildDimensionUserPrompt,
  buildOrchestratorSystemPrompt,
  buildOrchestratorUserPrompt
} from '@/lib/prompts/chapter-prompts'
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

function extractJSON(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('未找到 JSON 格式')
    return JSON.parse(jsonMatch[0])
  }
}

// ── 维度定义 ──────────────────────────────────────────────

const DIMENSIONS = [
  'mainPlot',
  'tension',
  'emotion',
  'sceneTransition',
  'callback',
  'foreshadowing'
] as const

type Dimension = typeof DIMENSIONS[number]

const DIMENSION_NAMES: Record<Dimension, string> = {
  mainPlot: '主线剧情',
  tension: '故事张力',
  emotion: '情感表现',
  sceneTransition: '情景转换',
  callback: '伏笔呼应',
  foreshadowing: '伏笔'
}

// ── 主流程 ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { planFile, chapterIndex, previousContent, analysis } = await req.json()

    if (!planFile || chapterIndex === undefined) {
      return new Response(
        JSON.stringify({ error: '请提供计划文件路径和章节索引' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const config = getConfig()
    if (!config.ai.apiKey) {
      return new Response(
        JSON.stringify({ error: 'AI 服务未配置' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const { baseUrl, apiKey, model } = config.ai

    // 创建 SSE 流
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (type: string, data: any) => {
          const event = `data: ${JSON.stringify({ type, data })}\n\n`
          controller.enqueue(encoder.encode(event))
        }

        try {
          // 读取计划
          const planData = JSON.parse(await fs.readFile(planFile, 'utf-8'))
          const chapter = planData.chapters[chapterIndex]

          if (!chapter) {
            sendEvent('error', { message: `章节 ${chapterIndex} 不存在` })
            controller.close()
            return
          }

          sendEvent('status', { stage: 'start', message: `开始生成「${chapter.name}」` })

          // ── ① 大纲细化 ──────────────────────────────────

          sendEvent('status', { stage: 'outlining', message: '细化大纲...' })

          const outlineSystemPrompt = buildChapterOutlineSystemPrompt()
          const outlineUserPrompt = buildChapterOutlineUserPrompt({
            chapter,
            chapterIndex,
            totalChapters: planData.chapters.length,
            previousSummary: previousContent ? previousContent.slice(-2000) : '',
            analysis: analysis || { characters: [], background: '', plotTrend: '', summary: '' },
            constraints: planData.constraints || []
          })

          const outlineRaw = await callAI(baseUrl, apiKey, model, [
            { role: 'system', content: outlineSystemPrompt },
            { role: 'user', content: outlineUserPrompt }
          ], 0.4, 4000)

          const detailedOutline = extractJSON(outlineRaw)
          sendEvent('outline', detailedOutline)

          // ── ② 六维并行生成 ──────────────────────────────

          sendEvent('status', { stage: 'generating', message: '六维并行生成...' })

          const dimensionWeights = detailedOutline.dimensionWeights || {
            mainPlot: 25, tension: 20, emotion: 15,
            sceneTransition: 15, callback: 15, foreshadowing: 10
          }

          const dimensionContents: Record<string, string> = {}

          // 并行调用六个维度
          const dimensionPromises = DIMENSIONS.map(async (dim) => {
            sendEvent('dimension_start', { dimension: dim, name: DIMENSION_NAMES[dim] })

            try {
              const sysPrompt = buildDimensionSystemPrompt(dim)
              const userPrompt = buildDimensionUserPrompt(dim, {
                chapter,
                detailedOutline,
                previousSummary: previousContent ? previousContent.slice(-2000) : '',
                analysis: analysis || { characters: [], background: '', plotTrend: '', summary: '' },
                dimensionWeights
              })

              const content = await callAI(baseUrl, apiKey, model, [
                { role: 'system', content: sysPrompt },
                { role: 'user', content: userPrompt }
              ], 0.7, 6000)

              dimensionContents[dim] = content
              sendEvent('dimension_done', { dimension: dim, name: DIMENSION_NAMES[dim] })
            } catch (err: any) {
              sendEvent('dimension_error', { dimension: dim, name: DIMENSION_NAMES[dim], error: err.message })
              dimensionContents[dim] = ''
            }
          })

          await Promise.all(dimensionPromises)

          // ── ③ 故事编排 ──────────────────────────────────

          sendEvent('status', { stage: 'orchestrating', message: '故事编排...' })

          const scoreThreshold = detailedOutline.scoreThreshold || 75
          let orchestrationResult: any = null
          let round = 0
          const maxRounds = 2

          while (round < maxRounds) {
            round++
            sendEvent('orchestration_round', { round, maxRounds })

            const orchSystemPrompt = buildOrchestratorSystemPrompt()
            const weakestDim = round > 1 ? findWeakestDimension(orchestrationResult?.scores, dimensionWeights) : undefined
            const orchUserPrompt = buildOrchestratorUserPrompt({
              chapter,
              detailedOutline,
              dimensionContents,
              dimensionWeights,
              scoreThreshold,
              previousSummary: previousContent ? previousContent.slice(-2000) : '',
              fixDimension: weakestDim,
              fixReason: weakestDim ? orchestrationResult?.scores?.[weakestDim]?.reason : undefined
            })

            const orchRaw = await callAI(baseUrl, apiKey, model, [
              { role: 'system', content: orchSystemPrompt },
              { role: 'user', content: orchUserPrompt }
            ], 0.5, 10000)

            orchestrationResult = extractJSON(orchRaw)

            sendEvent('orchestration_result', {
              round,
              scores: orchestrationResult.scores,
              totalScore: orchestrationResult.totalScore,
              pass: orchestrationResult.pass
            })

            // 检查是否通过
            if (orchestrationResult.pass && orchestrationResult.totalScore >= scoreThreshold) {
              break
            }

            // 检查是否有维度需要修复
            const weakest = findWeakestDimension(orchestrationResult.scores, dimensionWeights)
            if (!weakest) break

            sendEvent('status', {
              stage: 'fixing',
              message: `修复「${DIMENSION_NAMES[weakest]}」维度...`
            })

            // 重新生成最弱维度
            try {
              const sysPrompt = buildDimensionSystemPrompt(weakest)
              const userPrompt = buildDimensionUserPrompt(weakest, {
                chapter,
                detailedOutline,
                previousSummary: previousContent ? previousContent.slice(-2000) : '',
                analysis: analysis || { characters: [], background: '', plotTrend: '', summary: '' },
                dimensionWeights
              })

              const fixedContent = await callAI(baseUrl, apiKey, model, [
                { role: 'system', content: sysPrompt },
                { role: 'user', content: userPrompt }
              ], 0.6, 6000)

              dimensionContents[weakest] = fixedContent
              sendEvent('dimension_fixed', { dimension: weakest, name: DIMENSION_NAMES[weakest] })
            } catch (err: any) {
              sendEvent('dimension_fix_error', { dimension: weakest, error: err.message })
            }
          }

          // ── 输出最终结果 ────────────────────────────────

          const finalContent = orchestrationResult?.content || ''
          const finalWords = orchestrationResult?.words || finalContent.length

          sendEvent('complete', {
            content: finalContent,
            words: finalWords,
            scores: orchestrationResult?.scores,
            totalScore: orchestrationResult?.totalScore,
            rounds: round
          })

        } catch (error: any) {
          sendEvent('error', { message: error.message || '生成失败' })
        } finally {
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    })
  } catch (error: any) {
    console.error('[adaptation/generate-chapter] Error:', error)
    return new Response(
      JSON.stringify({ error: error.message || '生成失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// ── 工具函数 ──────────────────────────────────────────────

function findWeakestDimension(
  scores: Record<string, { score: number; reason: string }> | undefined,
  weights: Record<string, number>
): Dimension | undefined {
  if (!scores) return undefined

  let weakest: Dimension | undefined
  let lowestRatio = Infinity

  for (const dim of DIMENSIONS) {
    const score = scores[dim]?.score || 0
    const weight = weights[dim] || 20
    const ratio = score / weight

    if (ratio < lowestRatio && ratio < 0.6) {
      lowestRatio = ratio
      weakest = dim
    }
  }

  return weakest
}
