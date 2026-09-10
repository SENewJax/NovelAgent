'use client'

import { useState, useCallback } from 'react'
import { useAdaptation } from '../hooks/useAdaptation'
import { DropZone } from './DropZone'
import { OutlineOptions } from './OutlineOptions'
import { SettingsModal } from './SettingsModal'
import { uploadNovel, analyzeNovel, generateOutline } from '../services/adaptation-service'
import type { AnalysisResult, Outline, ChapterGeneration, DimensionType } from '../types/adaptation'
import { createEmptyChapterGeneration } from '../types/adaptation'

const DIMENSION_LABELS: Record<DimensionType, string> = {
  mainPlot: '主线剧情',
  tension: '故事张力',
  emotion: '情感表现',
  sceneTransition: '情景转换',
  callback: '伏笔呼应',
  foreshadowing: '伏笔'
}

const DIMENSION_COLORS: Record<DimensionType, string> = {
  mainPlot: 'bg-blue-500',
  tension: 'bg-red-500',
  emotion: 'bg-pink-500',
  sceneTransition: 'bg-amber-500',
  callback: 'bg-purple-500',
  foreshadowing: 'bg-teal-500'
}

export function AdaptationWorkbench() {
  const { state, actions } = useAdaptation()
  const [showSettings, setShowSettings] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzingStage, setAnalyzingStage] = useState('')
  const [generatingOutline, setGeneratingOutline] = useState(false)
  const [generatingChapter, setGeneratingChapter] = useState<number | null>(null)
  const [analysisTab, setAnalysisTab] = useState<'original' | 'details'>('original')

  // 处理文件上传
  const handleFileSelect = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const result = await uploadNovel(file)
      actions.setNovel({
        id: result.id,
        name: result.name,
        chapters: 0,
        words: '计算中...',
        date: new Date().toISOString().split('T')[0]
      })
    } catch (err: any) {
      alert('上传失败: ' + err.message)
    } finally {
      setUploading(false)
    }
  }, [actions])

  // 移除小说
  const handleRemoveNovel = useCallback(() => {
    actions.setNovel(null)
    actions.setAnalysis(null)
    actions.setOutline(null)
    actions.initChapterGenerations([])
  }, [actions])

  // ① 分析小说（主编）
  const handleAnalyze = useCallback(async () => {
    if (!state.novel) return
    setAnalyzing(true)
    setAnalyzingStage('正在分析小说结构（1/4）...')
    try {
      const result = await analyzeNovel(state.novel.id, '分析小说的故事背景、人物角色、剧情走向')
      actions.setAnalysis(result)
    } catch (err: any) {
      alert('分析失败: ' + err.message)
    } finally {
      setAnalyzing(false)
      setAnalyzingStage('')
    }
  }, [state.novel, actions])

  // ② 生成新大纲（主编）
  const handleGenerateOutline = useCallback(async () => {
    if (!state.analysis) return
    const selectedRewrite = state.settings.rewriteOptions.filter(o => o.enabled)
    if (selectedRewrite.length === 0) {
      alert('请至少选择一个剧情改写选项')
      return
    }
    if (!state.selectedGenre) {
      alert('请选择一个剧情类型')
      return
    }
    setGeneratingOutline(true)
    try {
      const outline = await generateOutline(
        state.analysis.analysisId,
        state.analysis,
        {
          rewriteOptions: selectedRewrite.map(o => o.text),
          genre: state.selectedGenre,
          customSettings: state.customSettings,
          userPrompt: ''
        }
      )
      actions.setOutline(outline)
      // 初始化章节生成状态
      actions.initChapterGenerations(
        outline.chapters.map(ch => createEmptyChapterGeneration(ch.index, ch.name, ch.targetWords))
      )
    } catch (err: any) {
      alert('生成大纲失败: ' + err.message)
    } finally {
      setGeneratingOutline(false)
    }
  }, [state.analysis, state.settings.rewriteOptions, state.selectedGenre, state.customSettings, actions])

  // ③ 生成单个章节（写手）
  const handleGenerateChapter = useCallback(async (chapterIndex: number) => {
    if (!state.outline?.planFile) return

    setGeneratingChapter(chapterIndex)
    actions.updateChapterStatus(chapterIndex, 'outlining')

    try {
      // 获取前文内容（用于上下文）
      const previousContent = state.chapterGenerations
        .filter(ch => ch.index < chapterIndex && ch.status === 'done')
        .map(ch => ch.content)
        .join('\n\n')

      const response = await fetch('/api/adaptation/generate-chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planFile: state.outline.planFile,
          chapterIndex,
          previousContent,
          analysis: state.analysis
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法读取响应流')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            handleChapterEvent(chapterIndex, event)
          } catch {}
        }
      }
    } catch (err: any) {
      actions.updateChapterStatus(chapterIndex, 'failed')
      alert(`章节 ${chapterIndex + 1} 生成失败: ${err.message}`)
    } finally {
      setGeneratingChapter(null)
    }
  }, [state.outline, state.chapterGenerations, state.analysis, actions])

  // 处理章节生成事件
  const handleChapterEvent = useCallback((chapterIndex: number, event: { type: string; data: any }) => {
    const { type, data } = event

    switch (type) {
      case 'status':
        if (data.stage === 'outlining') {
          actions.updateChapterStatus(chapterIndex, 'outlining')
        } else if (data.stage === 'generating') {
          actions.updateChapterStatus(chapterIndex, 'generating')
        } else if (data.stage === 'orchestrating') {
          actions.updateChapterStatus(chapterIndex, 'orchestrating')
        }
        break

      case 'outline':
        actions.updateChapterOutline(chapterIndex, data)
        break

      case 'dimension_start':
        actions.updateDimensionStatus(chapterIndex, data.dimension, 'generating')
        break

      case 'dimension_done':
        actions.updateDimensionStatus(chapterIndex, data.dimension, 'done')
        break

      case 'dimension_error':
        actions.updateDimensionStatus(chapterIndex, data.dimension, 'failed')
        break

      case 'orchestration_result':
        actions.updateOrchestration(chapterIndex, data.round, data.totalScore, data.pass)
        // 更新各维度分数
        if (data.scores) {
          for (const [dim, scoreData] of Object.entries(data.scores)) {
            const { score, reason } = scoreData as { score: number; reason: string }
            const maxScore = data.dimensionWeights?.[dim] || 20
            actions.updateDimensionScore(chapterIndex, dim as DimensionType, score, maxScore, reason)
          }
        }
        break

      case 'complete':
        actions.setChapterContent(chapterIndex, data.content, data.words)
        break

      case 'error':
        actions.updateChapterStatus(chapterIndex, 'failed')
        break
    }
  }, [actions])

  // 生成所有章节
  const handleGenerateAll = useCallback(async () => {
    if (!state.outline) return
    for (const ch of state.chapterGenerations) {
      if (ch.status === 'pending' || ch.status === 'failed') {
        await handleGenerateChapter(ch.index)
      }
    }
  }, [state.outline, state.chapterGenerations, handleGenerateChapter])

  // 切换剧情改写选项
  const handleToggleRewrite = useCallback((id: number) => {
    actions.updateSettings({
      rewriteOptions: state.settings.rewriteOptions.map(o =>
        o.id === id ? { ...o, enabled: !o.enabled } : o
      )
    })
  }, [actions, state.settings.rewriteOptions])

  // 选择剧情类型
  const handleSelectGenre = useCallback((genre: string) => {
    actions.setSelectedGenre(genre)
  }, [actions])

  // 重置选项
  const handleResetOptions = useCallback(() => {
    actions.setSelectedGenre(null)
    actions.setCustomSettings([])
    actions.updateSettings({
      rewriteOptions: state.settings.rewriteOptions.map(o => ({ ...o, enabled: true }))
    })
  }, [actions, state.settings.rewriteOptions])

  // 保存设置
  const handleSaveSettings = useCallback(async (newSettings: typeof state.settings): Promise<{ success: boolean; error?: string }> => {
    actions.updateSettings(newSettings)
    try {
      const result = await actions.saveSettings(newSettings)
      if (result.backendSaved) return { success: true }
      if (result.localStorageSaved) return { success: false, error: '后端保存失败，设置仅保存在浏览器本地' }
      return { success: false, error: `保存失败: ${result.error}` }
    } catch (err) {
      return { success: false, error: `保存异常: ${err instanceof Error ? err.message : String(err)}` }
    }
  }, [actions])

  // 导出
  const handleExport = useCallback(() => {
    const cleanContent = (text: string) => {
      // 去掉开头可能的 "NaN." 或纯数字+标点 前缀
      return text.replace(/^(NaN\.|\d+\.)\s*/i, '').trim()
    }

    const allContent = state.chapterGenerations
      .filter(ch => ch.status === 'done')
      .map((ch, i) => `第${i + 1}章 ${ch.name}\n\n${cleanContent(ch.content)}`)
      .join('\n\n')

    if (!allContent) {
      alert('没有可导出的内容')
      return
    }

    const title = state.outline?.title || state.novel?.name || '改编小说'
    const blob = new Blob([`《${title}》\n\n${allContent}`], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [state.chapterGenerations, state.novel?.name])

  // 统计
  const completedChapters = state.chapterGenerations.filter(ch => ch.status === 'done').length
  const totalChapters = state.chapterGenerations.length
  const totalWords = state.chapterGenerations.reduce((sum, ch) => sum + ch.words, 0)

  const isStep1Done = !!state.analysis
  const isStep2Done = !!state.outline

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">📚 小说改编工作台</h1>
        <button
          onClick={() => setShowSettings(true)}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
        >
          ⚙️ 设置
        </button>
      </div>

      {/* 上传区域 */}
      {!state.novel && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {uploading ? (
            <div className="text-center py-12">
              <div className="animate-spin text-4xl mb-4">⏳</div>
              <p className="text-gray-600">上传中...</p>
            </div>
          ) : (
            <DropZone onFileSelect={handleFileSelect} />
          )}
        </div>
      )}

      {/* 小说信息 */}
      {state.novel && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">📖 {state.novel.name}</h2>
              {totalChapters > 0 && (
                <p className="text-sm text-gray-500 mt-1">
                  已完成 {completedChapters}/{totalChapters} 章，共 {totalWords} 字
                </p>
              )}
            </div>
            <button onClick={handleRemoveNovel} className="px-3 py-1 text-red-600 hover:bg-red-50 rounded-lg">
              ✕ 移除
            </button>
          </div>
        </div>
      )}

      {/* 流程面板 */}
      {state.novel && (
        <div className="space-y-4">

          {/* ── 步骤 ① 分析小说 ── */}
          <StepCard step={1} role="主编" title="分析小说" done={isStep1Done} active={!isStep1Done && !analyzing} loading={analyzing} loadingText={analyzingStage}>
            <button
              onClick={handleAnalyze}
              disabled={analyzing || isStep1Done}
              className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                isStep1Done ? 'bg-green-100 text-green-700 cursor-default' :
                analyzing ? 'bg-gray-300 text-gray-500 cursor-not-allowed' :
                'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {isStep1Done ? '✓ 已完成' : analyzing ? '分析中...' : '开始分析'}
            </button>
            {state.analysis && (
              <div className="mt-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex border-b border-gray-200">
                  <button
                    className={`flex-1 px-4 py-2 text-sm font-medium ${analysisTab === 'original' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50' : 'text-gray-500'}`}
                    onClick={() => setAnalysisTab('original')}
                  >
                    📖 原作大纲
                  </button>
                  <button
                    className={`flex-1 px-4 py-2 text-sm font-medium ${analysisTab === 'details' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50' : 'text-gray-500'}`}
                    onClick={() => setAnalysisTab('details')}
                  >
                    🔍 分析详情
                  </button>
                </div>
                <div className="p-4 max-h-[400px] overflow-y-auto">
                  {analysisTab === 'original' ? (
                    state.analysis.originalOutline ? (
                      <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700">{state.analysis.originalOutline}</pre>
                    ) : (
                      <p className="text-gray-400 text-center py-4">未提取到原作大纲</p>
                    )
                  ) : (
                    <AnalysisDetailsView analysis={state.analysis} />
                  )}
                </div>
              </div>
            )}
          </StepCard>

          {/* ── 步骤 ② 生成新大纲 ── */}
          <StepCard step={2} role="主编" title="生成新大纲" done={isStep2Done} active={isStep1Done && !isStep2Done && !generatingOutline} loading={generatingOutline} loadingText="正在生成大纲..." disabled={!isStep1Done}>
            {isStep1Done && !isStep2Done && (
              <div className="mb-4">
                <OutlineOptions
                  rewriteOptions={state.settings.rewriteOptions}
                  genreOptions={state.settings.genreOptions}
                  selectedGenre={state.selectedGenre}
                  customSettings={state.customSettings}
                  onToggleRewrite={handleToggleRewrite}
                  onSelectGenre={handleSelectGenre}
                  onAddCustomSetting={actions.addCustomSetting}
                  onRemoveCustomSetting={actions.removeCustomSetting}
                />
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleGenerateOutline}
                disabled={!isStep1Done || generatingOutline || isStep2Done}
                className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                  isStep2Done ? 'bg-green-100 text-green-700 cursor-default' :
                  !isStep1Done || generatingOutline ? 'bg-gray-300 text-gray-500 cursor-not-allowed' :
                  'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isStep2Done ? '✓ 已完成' : generatingOutline ? '生成中...' : '生成大纲'}
              </button>
              {isStep1Done && !isStep2Done && (
                <button onClick={handleResetOptions} disabled={generatingOutline} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50">
                  重置选项
                </button>
              )}
            </div>
            {state.outline && (
              <div className="mt-4 bg-gray-50 rounded-lg border border-gray-200 p-4 max-h-[400px] overflow-y-auto">
                <OutlineView outline={state.outline} />
              </div>
            )}
          </StepCard>

          {/* ── 步骤 ③ 生成小说 ── */}
          <StepCard step={3} role="写手" title="生成小说" done={completedChapters === totalChapters && totalChapters > 0} active={isStep2Done} loading={generatingChapter !== null} loadingText={generatingChapter !== null ? `生成第${generatingChapter + 1}章...` : ''} disabled={!isStep2Done}>
            <div className="flex gap-3 mb-4">
              <button
                onClick={handleGenerateAll}
                disabled={!isStep2Done || generatingChapter !== null}
                className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                  !isStep2Done || generatingChapter !== null ? 'bg-gray-300 text-gray-500 cursor-not-allowed' :
                  'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {generatingChapter !== null ? '生成中...' : '全部生成'}
              </button>
              {totalChapters > 0 && (
                <button onClick={handleExport} className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200">
                  📥 导出
                </button>
              )}
            </div>

            {/* 章节列表 */}
            {totalChapters > 0 && (
              <div className="space-y-3">
                {/* 整体进度 */}
                <div>
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>整体进度</span>
                    <span>{completedChapters}/{totalChapters} 章 ({totalWords} 字)</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-500"
                      style={{ width: `${totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0}%` }}
                    />
                  </div>
                </div>

                {/* 各章节 */}
                {state.chapterGenerations.map(ch => (
                  <ChapterCard
                    key={ch.index}
                    chapter={ch}
                    onGenerate={() => handleGenerateChapter(ch.index)}
                    isGenerating={generatingChapter === ch.index}
                  />
                ))}
              </div>
            )}
          </StepCard>

        </div>
      )}

      {/* 设置弹窗 */}
      <SettingsModal
        isOpen={showSettings}
        settings={state.settings}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveSettings}
      />
    </div>
  )
}

// ── 步骤卡片组件 ──────────────────────────────────────

function StepCard({ step, role, title, done, active, loading, loadingText, disabled, children }: {
  step: number; role: string; title: string; done: boolean; active: boolean
  loading: boolean; loadingText?: string; disabled?: boolean; children: React.ReactNode
}) {
  const borderColor = done ? 'border-green-300' : loading ? 'border-blue-400' : active ? 'border-blue-300' : 'border-gray-200'
  const roleBadgeColor = role === '主编' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'

  return (
    <div className={`bg-white rounded-xl shadow-sm border-2 ${borderColor} p-6 transition-colors ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${done ? 'bg-green-500 text-white' : loading ? 'bg-blue-500 text-white' : 'bg-gray-300 text-gray-700'}`}>
          {done ? '✓' : step}
        </div>
        <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${roleBadgeColor}`}>{role}</span>
        {loading && (
          <span className="text-sm text-blue-600 ml-auto">
            <span className="animate-spin inline-block mr-1">⏳</span>
            {loadingText || '处理中...'}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

// ── 章节卡片组件 ──────────────────────────────────────

function ChapterCard({ chapter, onGenerate, isGenerating }: {
  chapter: ChapterGeneration; onGenerate: () => void; isGenerating: boolean
}) {
  const statusIcon = {
    pending: '○',
    outlining: '📝',
    generating: '⏳',
    orchestrating: '🎭',
    done: '✓',
    failed: '❌'
  }[chapter.status]

  const statusColor = {
    pending: 'text-gray-400',
    outlining: 'text-blue-500',
    generating: 'text-blue-500',
    orchestrating: 'text-purple-500',
    done: 'text-green-500',
    failed: 'text-red-500'
  }[chapter.status]

  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`bg-white rounded-lg border ${chapter.status === 'done' ? 'border-green-200' : chapter.status === 'failed' ? 'border-red-200' : 'border-gray-200'} p-4`}>
      {/* 章节头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-lg ${statusColor}`}>{statusIcon}</span>
          <div>
            <h4 className="font-medium text-gray-800">{chapter.name}</h4>
            <p className="text-xs text-gray-500">
              目标 {chapter.targetWords} 字
              {chapter.words > 0 && ` · 已生成 ${chapter.words} 字`}
              {chapter.orchestration.totalScore > 0 && ` · 评分 ${chapter.orchestration.totalScore}/${chapter.orchestration.passThreshold}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {(chapter.status === 'pending' || chapter.status === 'failed') && (
            <button
              onClick={onGenerate}
              disabled={isGenerating}
              className={`px-3 py-1 text-sm rounded-lg font-medium transition-colors ${
                chapter.status === 'failed'
                  ? 'bg-red-100 text-red-700 hover:bg-red-200'
                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
              }`}
            >
              {chapter.status === 'failed' ? '重新生成' : '开始生成'}
            </button>
          )}
          {(chapter.status !== 'pending') && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="px-2 py-1 text-sm text-gray-500 hover:text-gray-700"
            >
              {expanded ? '收起' : '展开'}
            </button>
          )}
        </div>
      </div>

      {/* 六维进度（展开时显示） */}
      {expanded && chapter.status !== 'pending' && (
        <div className="mt-4 space-y-2">
          {/* 六维状态 */}
          {Object.entries(chapter.dimensions).map(([dim, state]) => {
            const dimType = dim as DimensionType
            const label = DIMENSION_LABELS[dimType]
            const color = DIMENSION_COLORS[dimType]
            const weight = chapter.detailedOutline?.dimensionWeights?.[dimType] || 20

            return (
              <div key={dim} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-16">{label}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                  {state.status === 'generating' && (
                    <div className={`h-full ${color} rounded-full animate-pulse`} style={{ width: '60%' }} />
                  )}
                  {state.status === 'done' && (
                    <div className={`h-full ${color} rounded-full`} style={{ width: '100%' }} />
                  )}
                </div>
                <span className="text-xs text-gray-400 w-8">{weight}</span>
                {state.score !== undefined && (
                  <span className="text-xs text-gray-600 w-12">{state.score}/{state.maxScore}</span>
                )}
                {state.status === 'generating' && <span className="text-xs text-blue-500">生成中</span>}
                {state.status === 'done' && <span className="text-xs text-green-500">✓</span>}
                {state.status === 'failed' && <span className="text-xs text-red-500">❌</span>}
              </div>
            )
          })}

          {/* 编排状态 */}
          {chapter.status === 'orchestrating' && (
            <div className="mt-2 p-2 bg-purple-50 rounded-lg">
              <p className="text-xs text-purple-700">
                🎭 故事编排中... 第 {chapter.orchestration.round} 轮
                {chapter.orchestration.totalScore > 0 && ` (评分: ${chapter.orchestration.totalScore})`}
              </p>
            </div>
          )}

          {/* 评分详情 */}
          {chapter.status === 'done' && chapter.orchestration.totalScore > 0 && (
            <div className="mt-2 p-2 bg-green-50 rounded-lg">
              <p className="text-xs text-green-700">
                ✓ 生成完成 · 评分 {chapter.orchestration.totalScore}/{chapter.orchestration.passThreshold}
                {chapter.orchestration.round > 1 && ` · 经过 ${chapter.orchestration.round} 轮编排`}
              </p>
            </div>
          )}

          {/* 内容预览 */}
          {chapter.content && (
            <div className="mt-2 p-3 bg-gray-50 rounded-lg max-h-[200px] overflow-y-auto">
              <pre className="whitespace-pre-wrap font-sans text-xs text-gray-600">
                {chapter.content.replace(/^(NaN\.|\d+\.)\s*/i, '').slice(0, 500)}{chapter.content.length > 500 ? '...' : ''}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 分析详情视图 ──────────────────────────────────────

function AnalysisDetailsView({ analysis }: { analysis: AnalysisResult }) {
  const details = analysis._details
  if (!details) {
    return (
      <div className="space-y-3">
        <div><h4 className="text-sm font-semibold text-gray-700 mb-1">故事背景</h4><p className="text-sm text-gray-600">{analysis.background}</p></div>
        <div><h4 className="text-sm font-semibold text-gray-700 mb-1">剧情走向</h4><p className="text-sm text-gray-600">{analysis.plotTrend}</p></div>
        <div><h4 className="text-sm font-semibold text-gray-700 mb-1">主要角色</h4><ul className="text-sm text-gray-600 list-disc list-inside">{analysis.characters.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
        <div><h4 className="text-sm font-semibold text-gray-700 mb-1">整体摘要</h4><p className="text-sm text-gray-600">{analysis.summary}</p></div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {details.stage1 && (
        <div className="bg-purple-50 rounded-lg p-3">
          <h4 className="text-sm font-semibold text-purple-800 mb-2">🏗️ 结构分析</h4>
          {details.stage1.conflictStructure && <p className="text-sm text-purple-700 mb-2">{details.stage1.conflictStructure}</p>}
          {details.stage1.hooks && details.stage1.hooks.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {details.stage1.hooks.map((h, i) => <span key={i} className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">{h}</span>)}
            </div>
          )}
        </div>
      )}
      {details.stage2?.mainCharacters && details.stage2.mainCharacters.length > 0 && (
        <div className="bg-green-50 rounded-lg p-3">
          <h4 className="text-sm font-semibold text-green-800 mb-2">👥 角色图谱</h4>
          <div className="space-y-2">
            {details.stage2.mainCharacters.map((c, i) => (
              <div key={i} className="bg-white rounded p-2 border border-green-100">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-green-800 text-sm">{c.name}</span>
                  <span className="text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded">{c.role}</span>
                </div>
                <p className="text-xs text-green-700">{c.personality}</p>
                <p className="text-xs text-green-600">动机：{c.motivation}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {details.stage3 && (
        <div className="bg-amber-50 rounded-lg p-3">
          <h4 className="text-sm font-semibold text-amber-800 mb-2">🎨 主题与风格</h4>
          {details.stage3.themes && details.stage3.themes.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {details.stage3.themes.map((t, i) => <span key={i} className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded">{t}</span>)}
            </div>
          )}
          {details.stage3.writingStyle && <p className="text-sm text-amber-700">{details.stage3.writingStyle}</p>}
        </div>
      )}
    </div>
  )
}

// ── 大纲视图 ──────────────────────────────────────

function OutlineView({ outline }: { outline: Outline }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-sm text-gray-600">
        <span><b>标题：</b>{outline.title}</span>
        <span><b>类型：</b>{outline.type}</span>
        <span><b>目标：</b>约{Math.round(outline.totalTargetWords / 1000)}千字</span>
      </div>
      {outline.volumes && outline.volumes.length > 0 ? (
        outline.volumes.map((vol, vi) => (
          <div key={vi} className="bg-white rounded-lg border border-gray-200 p-3">
            <h4 className="font-semibold text-gray-800 text-sm mb-1">【{vol.name}】</h4>
            {vol.description && <p className="text-xs text-gray-500 mb-2">{vol.description}</p>}
            <div className="space-y-1.5">
              {vol.chapters.map((ch, ci) => (
                <div key={ci} className="text-sm">
                  <span className="text-gray-800 font-medium">{ch.index + 1}. {ch.name}</span>
                  <span className="text-gray-400 ml-2">({Math.round(ch.targetWords / 1000)}千字)</span>
                  {ch.summary && <p className="text-xs text-gray-500 ml-4 mt-0.5">{ch.summary}</p>}
                </div>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="space-y-1.5">
          {outline.chapters.map((ch, i) => (
            <div key={i} className="text-sm">
              <span className="text-gray-800 font-medium">{ch.index + 1}. {ch.name}</span>
              <span className="text-gray-400 ml-2">({Math.round(ch.targetWords / 1000)}千字)</span>
              {ch.summary && <p className="text-xs text-gray-500 ml-4 mt-0.5">{ch.summary}</p>}
            </div>
          ))}
        </div>
      )}
      {outline.constraints.length > 0 && (
        <div className="bg-yellow-50 rounded-lg p-3">
          <h4 className="text-xs font-semibold text-yellow-800 mb-1">约束条件</h4>
          <ul className="text-xs text-yellow-700 list-disc list-inside">
            {outline.constraints.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
