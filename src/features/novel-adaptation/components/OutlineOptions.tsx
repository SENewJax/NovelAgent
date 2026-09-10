'use client'

import { useState } from 'react'
import type { RewriteOption, GenreOption } from '../types/adaptation'

interface OutlineOptionsProps {
  rewriteOptions: RewriteOption[]
  genreOptions: GenreOption[]
  selectedGenre: string | null
  customSettings: string[]
  onToggleRewrite: (id: number) => void
  onSelectGenre: (genre: string) => void
  onAddCustomSetting: (text: string) => void
  onRemoveCustomSetting: (index: number) => void
}

export function OutlineOptions({
  rewriteOptions,
  genreOptions,
  selectedGenre,
  customSettings,
  onToggleRewrite,
  onSelectGenre,
  onAddCustomSetting,
  onRemoveCustomSetting
}: OutlineOptionsProps) {
  const [newCustomSetting, setNewCustomSetting] = useState('')
  const [rewriteExpanded, setRewriteExpanded] = useState(true)
  const [genreExpanded, setGenreExpanded] = useState(true)

  const handleAddCustomSetting = () => {
    if (newCustomSetting.trim()) {
      onAddCustomSetting(newCustomSetting.trim())
      setNewCustomSetting('')
    }
  }

  return (
    <div className="space-y-4">
      {/* 剧情改写选项 (多选) */}
      <div className="bg-white rounded-lg border border-gray-200">
        <button
          onClick={() => setRewriteExpanded(!rewriteExpanded)}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
        >
          <h3 className="text-base font-semibold text-gray-800">
            📌 剧情改写选项 <span className="text-sm font-normal text-gray-500">(多选)</span>
          </h3>
          <span className="text-gray-400 text-sm">
            {rewriteExpanded ? '▼' : '▶'}
          </span>
        </button>
        {rewriteExpanded && (
          <div className="px-4 pb-4 border-t border-gray-100">
            <div className="flex flex-wrap gap-2 pt-3">
              {rewriteOptions.map(option => (
                <label
                  key={option.id}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-full cursor-pointer hover:bg-gray-100 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={option.enabled}
                    onChange={() => onToggleRewrite(option.id)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700">{option.text}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 剧情选项 (单选) */}
      <div className="bg-white rounded-lg border border-gray-200">
        <button
          onClick={() => setGenreExpanded(!genreExpanded)}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
        >
          <h3 className="text-base font-semibold text-gray-800">
            🎭 剧情选项 <span className="text-sm font-normal text-gray-500">(单选)</span>
          </h3>
          <span className="text-gray-400 text-sm">
            {genreExpanded ? '▼' : '▶'}
          </span>
        </button>
        {genreExpanded && (
          <div className="px-4 pb-4 border-t border-gray-100">
            <div className="flex flex-wrap gap-2 pt-3">
              {genreOptions.map(option => (
                <button
                  key={option.id}
                  onClick={() => onSelectGenre(option.text)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    selectedGenre === option.text
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {option.text}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 自定义设置 */}
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <h3 className="text-base font-semibold text-gray-800 mb-3">
          ✏️ 自定义补充
        </h3>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newCustomSetting}
            onChange={(e) => setNewCustomSetting(e.target.value)}
            placeholder="添加自定义设置..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleAddCustomSetting()}
          />
          <button
            onClick={handleAddCustomSetting}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            + 添加
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {customSettings.map((setting, index) => (
            <span
              key={index}
              className="flex items-center gap-1 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm"
            >
              {setting}
              <button
                onClick={() => onRemoveCustomSetting(index)}
                className="w-4 h-4 rounded-full bg-blue-200 hover:bg-blue-300 flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
