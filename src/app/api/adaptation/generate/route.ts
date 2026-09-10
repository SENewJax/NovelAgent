import { NextRequest } from 'next/server'
import { getConfig } from '@/lib/config'
import { buildWriterSystemPrompt } from '@/lib/prompts/writer-prompts'
import { EmployeeClient } from 'employee-sdk'
import fs from 'fs/promises'
import path from 'path'

export async function POST(req: NextRequest) {
  try {
    const { planId, planFile, model, outlineId, analysis } = await req.json()

    if (!planId && !planFile) {
      return new Response(
        JSON.stringify({ error: '请提供计划 ID 或计划文件路径' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 使用项目统一的 AI 配置
    const config = getConfig()
    if (!config.ai.apiKey) {
      return new Response(
        JSON.stringify({ error: 'AI 服务未配置，请先在设置页面配置 API Key' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const selectedModel = model || config.ai.model

    // 查找计划文件
    let actualPlanFile = planFile
    if (!actualPlanFile && planId) {
      // 扫描 adaptation 目录查找 plan.json（EmployeeClient 兼容格式）
      const adaptationDir = path.join(process.cwd(), '.novel', 'adaptation')
      try {
        const dirs = await fs.readdir(adaptationDir)
        for (const dir of dirs) {
          // 优先查找 plan.json（EmployeeClient 兼容格式）
          const planCandidate = path.join(adaptationDir, dir, 'plan.json')
          try {
            await fs.access(planCandidate)
            if (!outlineId || dir.includes(outlineId.replace('outline_', ''))) {
              actualPlanFile = planCandidate
              break
            }
          } catch {
            continue
          }
        }
      } catch {
        // 目录不存在
      }
    }

    if (!actualPlanFile) {
      return new Response(
        JSON.stringify({ error: '未找到执行计划文件' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 确定输出目录
    const planDir = path.dirname(actualPlanFile)

    // 尝试加载分析数据
    let analysisData = analysis
    if (!analysisData) {
      const analysisFile = path.join(planDir, 'analysis.json')
      try {
        analysisData = JSON.parse(await fs.readFile(analysisFile, 'utf-8'))
      } catch {
        // 没有分析数据，继续
      }
    }

    // 创建 SSE 流
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (type: string, data: any) => {
          const event = `data: ${JSON.stringify({ type, data })}\n\n`
          controller.enqueue(encoder.encode(event))
        }

        try {
          sendEvent('status', { message: '正在初始化生成引擎...' })

          // 读取计划数据
          const planData = JSON.parse(await fs.readFile(actualPlanFile, 'utf-8'))

          // 构建详细的写手 system prompt
          const systemPrompt = buildWriterSystemPrompt(
            analysisData,
            planData.title,
            planData.type
          )

          console.log('[adaptation/generate] System prompt 长度:', systemPrompt.length)
          console.log('[adaptation/generate] 使用模型:', selectedModel)

          // 创建 EmployeeClient
          const client = new EmployeeClient({
            baseUrl: config.ai.baseUrl,
            apiKey: config.ai.apiKey,
            model: selectedModel,
            systemPrompt,
            outputDir: planDir
          })

          sendEvent('status', { message: '开始生成小说内容...' })

          // 构建参考文本
          const refParts: string[] = []
          refParts.push(`标题：${planData.title || '改编小说'}`)
          refParts.push(`类型：${planData.type || '网络小说'}`)
          if (planData.chapters?.length) {
            refParts.push(`章节数：${planData.chapters.length}`)
            refParts.push('章节列表：')
            for (const ch of planData.chapters) {
              refParts.push(`  ${ch.index + 1}. ${ch.name} - ${ch.summary || ''}`)
            }
          }
          if (planData.constraints?.length) {
            refParts.push('约束条件：')
            for (const c of planData.constraints) {
              refParts.push(`  - ${c}`)
            }
          }
          if (planData.volumes?.length) {
            refParts.push('卷结构：')
            for (const vol of planData.volumes) {
              refParts.push(`  【${vol.name}】${vol.description || ''}`)
            }
          }

          // 执行生成
          console.log('[adaptation/generate] 开始执行生成...')
          console.log('[adaptation/generate] API Base URL:', config.ai.baseUrl)
          console.log('[adaptation/generate] API Key 长度:', config.ai.apiKey?.length || 0)

          const result = await client.executeGeneration({
            reference: {
              text: refParts.join('\n'),
              file: actualPlanFile
            },
            prompt: '按照计划完整写出小说的每一章，确保内容完整、情节连贯。每章至少3000字。严格遵循大纲的章节结构，不要跳过或合并章节。',
            onEvent: (type: string, data: any) => {
              console.log('[adaptation/generate] 事件:', type, data)
              if (type === 'delta') {
                sendEvent('content', { text: data.text || '' })
              } else if (type === 'file_generation_progress') {
                // data.progress 是 {chapters, words, size, exists, matchedChapters} 对象
                // 需要从 validation.ratio 或 plan 状态计算百分比
                const plan = data.plan || []
                const completedCount = plan.filter((c: any) => c.status === 'done').length
                const totalCount = plan.length || planData.chapters?.length || 1
                const progressPercent = Math.round((completedCount / totalCount) * 100)

                sendEvent('progress', {
                  progress: progressPercent,
                  currentChapter: plan.find((c: any) => c.status !== 'done')?.name || '',
                  completedChapters: completedCount,
                  totalChapters: totalCount
                })
              } else if (type === 'file_generation_mode') {
                sendEvent('status', { message: '生成引擎已启动' })
              } else if (type === 'tool_result') {
                sendEvent('status', { message: `工具调用: ${data.tool || ''}` })
              } else if (type === 'generation_reset') {
                sendEvent('status', { message: '校准重置中...' })
              }
            }
          })

          console.log('[adaptation/generate] 生成完成:', result)

          // 读取生成的文件内容
          let generatedContent = ''
          if (result.file) {
            try {
              generatedContent = await fs.readFile(result.file, 'utf-8')
            } catch {
              // 文件可能不存在
            }
          }

          sendEvent('complete', {
            message: '小说生成完成！',
            filePath: result.file,
            summary: result.text,
            totalWords: generatedContent.length
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
    console.error('[adaptation/generate] Error:', error)
    return new Response(
      JSON.stringify({ error: error.message || '生成失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
