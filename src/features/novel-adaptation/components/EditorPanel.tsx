'use client'

import { useState } from 'react'
import type { RewriteOption, GenreOption, Outline, AnalysisResult } from '../types/adaptation'
import { OutlineOptions } from './OutlineOptions'

interface EditorPanelProps {
  rewriteOptions: RewriteOption[]
  genreOptions: GenreOption[]
  selectedGenre: string | null
  customSettings: string[]
  outline: Outline | null
  analysis: AnalysisResult | null
  analyzing?: boolean
  analyzingStage?: string
  generatingOutline?: boolean
  onToggleRewrite: (id: number) => void
  onSelectGenre: (genre: string) => void
  onAddCustomSetting: (text: string) => void
  onRemoveCustomSetting: (index: number) => void
  onGenerateOutline: () => void
  onExecutePlan: () => void
  onResetOptions: () => void
}

export function EditorPanel({
  rewriteOptions,
  genreOptions,
  selectedGenre,
  customSettings,
  outline,
  analysis,
  analyzing = false,
  analyzingStage = '',
  generatingOutline = false,
  onToggleRewrite,
  onSelectGenre,
  onAddCustomSetting,
  onRemoveCustomSetting,
  onGenerateOutline,
  onExecutePlan,
  onResetOptions
}: EditorPanelProps) {
  const [activeTab, setActiveTab] = useState<'outline' | 'plan'>('outline')
  const [outlineSubTab, setOutlineSubTab] = useState<'original' | 'generated' | 'details'>('original')

  const isLoading = analyzing || generatingOutline

  return (
    <div className="bg-gray-50 rounded-xl p-6">
      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'outline'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          onClick={() => setActiveTab('outline')}
        >
          📋 大纲分析
        </button>
        <button
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'plan'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          onClick={() => setActiveTab('plan')}
        >
          📄 执行计划
        </button>
      </div>

      {/* Loading 状态 */}
      {isLoading && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="animate-spin text-xl">⏳</div>
            <span className="text-blue-700">
              {analyzing
                ? (analyzingStage || '正在分析小说...')
                : '正在生成大纲...'
              }
            </span>
          </div>
        </div>
      )}

      {/* 大纲分析 Tab */}
      {activeTab === 'outline' && (
        <div className="space-y-6">
          <OutlineOptions
            rewriteOptions={rewriteOptions}
            genreOptions={genreOptions}
            selectedGenre={selectedGenre}
            customSettings={customSettings}
            onToggleRewrite={onToggleRewrite}
            onSelectGenre={onSelectGenre}
            onAddCustomSetting={onAddCustomSetting}
            onRemoveCustomSetting={onRemoveCustomSetting}
          />

          {/* 操作按钮 */}
          <div className="flex gap-4">
            <button
              onClick={onGenerateOutline}
              disabled={isLoading}
              className={`flex-1 py-3 rounded-lg font-semibold transition-all ${
                isLoading
                  ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-lg'
              }`}
            >
              {isLoading ? '⏳ 处理中...' : '🚀 执行分析大纲'}
            </button>
            <button
              onClick={onResetOptions}
              disabled={isLoading}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors disabled:opacity-50"
            >
              🔄 重置选项
            </button>
          </div>

          {/* 大纲展示区域 */}
          {(analysis || outline) && (
            <div className="bg-white rounded-lg border border-gray-200">
              {/* 大纲子标签 */}
              <div className="flex border-b border-gray-200">
                <button
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    outlineSubTab === 'original'
                      ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  onClick={() => setOutlineSubTab('original')}
                >
                  📖 原本小说大纲
                </button>
                <button
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    outlineSubTab === 'generated'
                      ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  onClick={() => setOutlineSubTab('generated')}
                >
                  ✨ 分析生成的大纲
                </button>
                {analysis?._details && (
                  <button
                    className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                      outlineSubTab === 'details'
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                    onClick={() => setOutlineSubTab('details')}
                  >
                    🔍 分析详情
                  </button>
                )}
              </div>

              {/* 原本大纲 */}
              {outlineSubTab === 'original' && (
                <div className="p-4">
                  {analysis?.originalOutline ? (
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 bg-gray-50 p-4 rounded-lg max-h-[400px] overflow-y-auto leading-relaxed">
                      {analysis.originalOutline}
                    </pre>
                  ) : (
                    <div className="text-center py-8 text-gray-400">
                      {analysis ? '未提取到原始大纲' : '请先执行分析'}
                    </div>
                  )}
                </div>
              )}

              {/* 生成的大纲 */}
              {outlineSubTab === 'generated' && (
                <div className="p-4">
                  {outline ? (
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 bg-gray-50 p-4 rounded-lg max-h-[400px] overflow-y-auto leading-relaxed">
                      {formatOutline(outline)}
                    </pre>
                  ) : (
                    <div className="text-center py-8 text-gray-400">
                      请先执行分析生成大纲
                    </div>
                  )}
                </div>
              )}

              {/* 分析详情 */}
              {outlineSubTab === 'details' && analysis?._details && (
                <div className="p-4 space-y-4 max-h-[500px] overflow-y-auto">
                  <AnalysisDetails details={analysis._details} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 执行计划 Tab */}
      {activeTab === 'plan' && (
        <div className="space-y-6">
          {/* 大纲预览 */}
          <div className="bg-white rounded-lg p-5 border border-gray-200">
            <h3 className="text-base font-semibold text-gray-800 mb-4">
              📄 执行计划
            </h3>
            {outline ? (
              <div className="space-y-4">
                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 bg-gray-50 p-4 rounded-lg max-h-[300px] overflow-y-auto leading-relaxed">
                  {formatOutline(outline)}
                </pre>

                {/* 分析摘要 */}
                {analysis && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-blue-800 mb-2">📊 分析摘要</h4>
                    <p className="text-sm text-blue-700">{analysis.summary}</p>
                    {analysis.characters.length > 0 && (
                      <div className="mt-2">
                        <span className="text-xs text-blue-600">主要角色：</span>
                        <span className="text-xs text-blue-700">{analysis.characters.join('、')}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                请先在"大纲分析"标签页生成大纲
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-4">
            <button
              onClick={onExecutePlan}
              disabled={!outline || isLoading}
              className={`flex-1 py-3 rounded-lg font-semibold transition-all ${
                outline && !isLoading
                  ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:shadow-lg'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              ⚡ 执行计划生成小说
            </button>
            <button
              onClick={() => setActiveTab('outline')}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
            >
              ← 返回修改
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 分析详情展示组件 ──────────────────────────────────────

function AnalysisDetails({ details }: { details: NonNullable<AnalysisResult['_details']> }) {
  return (
    <div className="space-y-4">
      {/* 结构分析 */}
      {details.stage1 && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-purple-800 mb-2">🏗️ 结构分析</h4>
          {details.stage1.conflictStructure && (
            <div className="mb-2">
              <span className="text-xs font-medium text-purple-600">冲突结构：</span>
              <p className="text-sm text-purple-700 mt-1">{details.stage1.conflictStructure}</p>
            </div>
          )}
          {details.stage1.scenes && details.stage1.scenes.length > 0 && (
            <div className="mb-2">
              <span className="text-xs font-medium text-purple-600">关键场景：</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {details.stage1.scenes.map((s, i) => (
                  <span key={i} className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">{s}</span>
                ))}
              </div>
            </div>
          )}
          {details.stage1.hooks && details.stage1.hooks.length > 0 && (
            <div>
              <span className="text-xs font-medium text-purple-600">叙事钩子：</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {details.stage1.hooks.map((h, i) => (
                  <span key={i} className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">{h}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 角色图谱 */}
      {details.stage2?.mainCharacters && details.stage2.mainCharacters.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-green-800 mb-2">👥 角色图谱</h4>
          <div className="space-y-3">
            {details.stage2.mainCharacters.map((c, i) => (
              <div key={i} className="bg-white rounded-lg p-3 border border-green-100">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-green-800">{c.name}</span>
                  <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded">{c.role}</span>
                </div>
                <p className="text-xs text-green-700"><b>性格：</b>{c.personality}</p>
                <p className="text-xs text-green-700"><b>动机：</b>{c.motivation}</p>
                {c.relationships && c.relationships.length > 0 && (
                  <p className="text-xs text-green-700"><b>关系：</b>{c.relationships.join('；')}</p>
                )}
                {c.arc && (
                  <p className="text-xs text-green-700"><b>成长线：</b>{c.arc}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 主题风格 */}
      {details.stage3 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-amber-800 mb-2">🎨 主题与风格</h4>
          {details.stage3.themes && details.stage3.themes.length > 0 && (
            <div className="mb-2">
              <span className="text-xs font-medium text-amber-600">核心主题：</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {details.stage3.themes.map((t, i) => (
                  <span key={i} className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded">{t}</span>
                ))}
              </div>
            </div>
          )}
          {details.stage3.writingStyle && (
            <div className="mb-2">
              <span className="text-xs font-medium text-amber-600">写作风格：</span>
              <p className="text-sm text-amber-700 mt-1">{details.stage3.writingStyle}</p>
            </div>
          )}
          {details.stage3.foreshadowing && details.stage3.foreshadowing.length > 0 && (
            <div>
              <span className="text-xs font-medium text-amber-600">伏笔清单：</span>
              <div className="mt-1 space-y-1">
                {details.stage3.foreshadowing.map((f, i) => (
                  <div key={i} className="text-xs text-amber-700">• {f}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 大纲格式化 ──────────────────────────────────────

function formatOutline(outline: Outline): string {
  const lines: string[] = [
    `标题：${outline.title || '（未命名）'}`,
    `类型：${outline.type}`,
    `目标总字数：约${Math.round(outline.totalTargetWords / 1000)}千字`,
    `章节数：${outline.chapters.length}`
  ]

  // 如果有卷结构，按卷展示
  if (outline.volumes && outline.volumes.length > 0) {
    for (const vol of outline.volumes) {
      lines.push('')
      lines.push(`【${vol.name}】${vol.description || ''}`)
      for (const ch of vol.chapters) {
        lines.push(`  ${ch.index + 1}. ${ch.name} (约${Math.round(ch.targetWords / 1000)}千字)`)
        if (ch.summary) {
          lines.push(`     ${ch.summary}`)
        }
        if (ch.chapterHook) {
          lines.push(`     🎣 钩子：${ch.chapterHook}`)
        }
      }
    }
  } else {
    // 扁平展示
    lines.push('')
    lines.push('【章节结构】')
    for (const ch of outline.chapters) {
      lines.push(`${ch.index + 1}. ${ch.name} (约${Math.round(ch.targetWords / 1000)}千字)`)
      if (ch.summary) {
        lines.push(`   ${ch.summary}`)
      }
      if (ch.chapterHook) {
        lines.push(`   🎣 钩子：${ch.chapterHook}`)
      }
    }
  }

  if (outline.constraints.length > 0) {
    lines.push('')
    lines.push('【约束条件】')
    for (const c of outline.constraints) {
      lines.push(`  • ${c}`)
    }
  }

  return lines.join('\n')
}
