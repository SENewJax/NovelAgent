/**
 * 小说改编完整流程测试脚本
 *
 * 测试流程：读取小说 → 分析 → 生成大纲 → 执行生成 → 输出文件
 *
 * 使用方法：
 * 1. 确保 dev server 正在运行：npm run dev
 * 2. 运行：node test-adaptation.mjs
 */

import fs from 'fs'
import path from 'path'

const BASE_URL = 'http://localhost:3000'
const NOVEL_PATH = 'E:\\xwechat_files\\htrlq92_d8f1\\msg\\file\\2026-09\\全知读者视角 完结+番外.txt'
const ROUNDS = 5

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(color, ...args) {
  console.log(`${color}`, ...args, colors.reset)
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 步骤1：分析小说
async function analyzeNovel(filePath) {
  log(colors.blue, '\n📖 步骤1：分析小说...')

  const response = await fetch(`${BASE_URL}/api/adaptation/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filePath,
      userPrompt: '分析这个小说的故事背景、人物角色、剧情走向。'
    })
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`分析失败: ${err.error || response.status}`)
  }

  const data = await response.json()
  log(colors.green, `✅ 分析完成！ID: ${data.data.analysisId}`)
  log(colors.cyan, `   背景: ${data.data.background?.slice(0, 100)}...`)
  log(colors.cyan, `   角色: ${data.data.characters?.length || 0} 个`)
  log(colors.cyan, `   大纲: ${data.data.originalOutline?.length || 0} 字`)

  return data.data
}

// 步骤2：生成大纲
async function generateOutline(analysis) {
  log(colors.blue, '\n📋 步骤2：生成改编大纲...')

  const response = await fetch(`${BASE_URL}/api/adaptation/outline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      analysisId: analysis.analysisId,
      analysis,
      options: {
        rewriteOptions: ['角色名随机（中式姓氏）', '城市布局采用中国', '历史背景架空'],
        genre: '末世求生',
        customSettings: [],
        userPrompt: ''
      }
    })
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`生成大纲失败: ${err.error || response.status}`)
  }

  const data = await response.json()
  log(colors.green, `✅ 大纲生成完成！ID: ${data.data.outlineId}`)
  log(colors.cyan, `   标题: ${data.data.title}`)
  log(colors.cyan, `   章节: ${data.data.chapters?.length || 0} 章`)
  log(colors.cyan, `   目标字数: ${data.data.totalTargetWords || 0}`)

  return data.data
}

// 步骤3：执行生成
async function executeGeneration(outline) {
  log(colors.blue, '\n✍️  步骤3：执行小说生成...')

  const response = await fetch(`${BASE_URL}/api/adaptation/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      outlineId: outline.outlineId,
      planFile: outline.planFile
    })
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`执行生成失败: ${err.error || response.status}`)
  }

  // 读取 SSE 流
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lastProgress = 0
  let result = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6))

          if (data.type === 'progress') {
            const p = Math.round(data.data.progress || 0)
            if (p > lastProgress) {
              log(colors.yellow, `   进度: ${p}% | 章节: ${data.data.currentChapter || ''}`)
              lastProgress = p
            }
          } else if (data.type === 'content') {
            // 内容流，不打印
          } else if (data.type === 'status') {
            log(colors.cyan, `   状态: ${data.data.message}`)
          } else if (data.type === 'complete') {
            result = data.data
            log(colors.green, `✅ 生成完成！`)
            log(colors.cyan, `   文件: ${data.data.filePath}`)
            log(colors.cyan, `   总字数: ${data.data.totalWords || 0}`)
          } else if (data.type === 'error') {
            throw new Error(data.data.message)
          }
        } catch (e) {
          if (e.message) throw e
        }
      }
    }
  }

  return result
}

// 主测试流程
async function runTest() {
  log(colors.blue, '═══════════════════════════════════════════════')
  log(colors.blue, '  小说改编完整流程测试')
  log(colors.blue, '═══════════════════════════════════════════════')

  // 检查小说文件是否存在
  if (!fs.existsSync(NOVEL_PATH)) {
    log(colors.red, `❌ 小说文件不存在: ${NOVEL_PATH}`)
    process.exit(1)
  }

  const fileStats = fs.statSync(NOVEL_PATH)
  log(colors.cyan, `📁 小说文件: ${NOVEL_PATH}`)
  log(colors.cyan, `📊 文件大小: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`)

  const results = []

  for (let i = 1; i <= ROUNDS; i++) {
    log(colors.blue, `\n═══════════════════════════════════════════════`)
    log(colors.blue, `  第 ${i} 轮测试`)
    log(colors.blue, `═══════════════════════════════════════════════`)

    const startTime = Date.now()

    try {
      // 步骤1：分析
      const analysis = await analyzeNovel(NOVEL_PATH)

      // 步骤2：生成大纲
      const outline = await generateOutline(analysis)

      // 步骤3：执行生成
      const result = await executeGeneration(outline)

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

      results.push({
        round: i,
        success: true,
        filePath: result?.filePath || '未知',
        totalWords: result?.totalWords || 0,
        elapsed
      })

      log(colors.green, `\n✅ 第 ${i} 轮完成！耗时: ${elapsed}s`)
      log(colors.green, `   输出文件: ${result?.filePath || '未知'}`)

    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      results.push({
        round: i,
        success: false,
        error: err.message,
        elapsed
      })
      log(colors.red, `\n❌ 第 ${i} 轮失败: ${err.message}`)
    }

    // 轮次间隔
    if (i < ROUNDS) {
      log(colors.yellow, '\n等待 5 秒后开始下一轮...')
      await sleep(5000)
    }
  }

  // 输出汇总
  log(colors.blue, '\n═══════════════════════════════════════════════')
  log(colors.blue, '  测试结果汇总')
  log(colors.blue, '═══════════════════════════════════════════════')

  for (const r of results) {
    if (r.success) {
      log(colors.green, `✅ 第 ${r.round} 轮: 成功 | 字数: ${r.totalWords} | 耗时: ${r.elapsed}s`)
      log(colors.cyan, `   文件: ${r.filePath}`)
    } else {
      log(colors.red, `❌ 第 ${r.round} 轮: 失败 | ${r.error} | 耗时: ${r.elapsed}s`)
    }
  }

  const successCount = results.filter(r => r.success).length
  log(colors.blue, `\n总计: ${successCount}/${ROUNDS} 轮成功`)

  // 输出所有成功生成的文件路径
  log(colors.blue, '\n📄 生成的小说文件:')
  for (const r of results) {
    if (r.success && r.filePath) {
      console.log(r.filePath)
    }
  }
}

runTest().catch(err => {
  log(colors.red, `\n💥 测试脚本异常: ${err.message}`)
  console.error(err)
  process.exit(1)
})
