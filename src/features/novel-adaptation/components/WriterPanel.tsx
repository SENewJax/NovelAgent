'use client'

import type { GenerationState } from '../types/adaptation'

interface WriterPanelProps {
  generation: GenerationState
  onPause: () => void
  onResume: () => void
  onRegenerate: () => void
  onExport: () => void
}

export function WriterPanel({
  generation,
  onPause,
  onResume,
  onRegenerate,
  onExport
}: WriterPanelProps) {
  const {
    isGenerating,
    progress,
    currentChapter,
    content,
    totalChapters,
    completedChapters,
    totalWords,
    generatedWords
  } = generation

  return (
    <div className="space-y-6">
      {/* 生成进度 */}
      <div className="bg-white rounded-lg p-5 border border-gray-200">
        <h3 className="text-base font-semibold text-gray-800 mb-4">
          📊 生成进度
        </h3>
        <div className="flex justify-between text-sm text-gray-600 mb-3">
          <span>进度: {completedChapters}/{totalChapters} 章</span>
          <span>已生成: 约{Math.round(generatedWords / 10000)}万字 / {Math.round(totalWords / 10000)}万字</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-5 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-600 to-purple-600 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-right text-sm text-gray-500 mt-1">
          {progress}%
        </div>
      </div>

      {/* 当前章节 */}
      {currentChapter && (
        <div className="bg-white rounded-lg p-5 border border-gray-200">
          <h3 className="text-base font-semibold text-gray-800 mb-2">
            📝 当前章节
          </h3>
          <p className="text-blue-600 font-medium">{currentChapter}</p>
        </div>
      )}

      {/* 生成内容 */}
      <div className="bg-white rounded-lg p-5 border border-gray-200">
        <h3 className="text-base font-semibold text-gray-800 mb-4">
          📖 生成内容
        </h3>
        <div className="bg-gray-50 rounded-lg p-6 min-h-[300px] max-h-[500px] overflow-y-auto leading-relaxed text-gray-700">
          {content ? (
            <div className="whitespace-pre-wrap">{content}</div>
          ) : (
            <div className="text-center text-gray-400 py-12">
              {isGenerating ? '正在生成中...' : '等待开始生成'}
            </div>
          )}
        </div>
      </div>

      {/* 控制按钮 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          onClick={isGenerating ? onPause : onResume}
          className={`py-3 rounded-lg font-medium transition-colors ${
            isGenerating
              ? 'bg-yellow-100 text-yellow-700 border-2 border-yellow-300 hover:bg-yellow-200'
              : 'bg-green-100 text-green-700 border-2 border-green-300 hover:bg-green-200'
          }`}
        >
          {isGenerating ? '⏸ 暂停' : '▶️ 继续'}
        </button>
        <button
          onClick={onRegenerate}
          className="py-3 rounded-lg font-medium bg-gray-100 text-gray-700 border-2 border-gray-300 hover:bg-gray-200 transition-colors"
        >
          🔄 重新生成
        </button>
        <button
          onClick={onExport}
          className="py-3 rounded-lg font-medium bg-blue-100 text-blue-700 border-2 border-blue-300 hover:bg-blue-200 transition-colors"
        >
          📥 导出
        </button>
        <button
          onClick={() => window.location.href = '/'}
          className="py-3 rounded-lg font-medium bg-gray-100 text-gray-700 border-2 border-gray-300 hover:bg-gray-200 transition-colors"
        >
          🏠 返回首页
        </button>
      </div>
    </div>
  )
}
