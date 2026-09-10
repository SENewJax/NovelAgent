'use client'

import { useState, useEffect } from 'react'
import type { AdaptationSettings, RewriteOption, GenreOption, ModelConfig } from '../types/adaptation'
import { DEFAULT_EDITOR_PROMPT, DEFAULT_WRITER_PROMPT } from '../types/adaptation'

interface SettingsModalProps {
  isOpen: boolean
  settings: AdaptationSettings
  onClose: () => void
  onSave: (settings: AdaptationSettings) => Promise<{ success: boolean; error?: string }>
}

export function SettingsModal({ isOpen, settings, onClose, onSave }: SettingsModalProps) {
  const [localSettings, setLocalSettings] = useState<AdaptationSettings>(settings)
  const [newRewriteOption, setNewRewriteOption] = useState('')
  const [newGenreOption, setNewGenreOption] = useState('')
  const [activeTab, setActiveTab] = useState<'models' | 'prompts' | 'options'>('models')
  const [models, setModels] = useState<ModelConfig[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setLocalSettings(settings)
    setSaveError(null)
  }, [settings])

  // 获取模型列表
  const handleFetchModels = async () => {
    setLoadingModels(true)
    setModelsError(null)

    try {
      const response = await fetch('/api/adaptation/models')
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '获取模型失败')
      }

      const existingIds = models.filter(m => m.enabled).map(m => m.id)
      const newModels = data.models.map((m: any) => ({
        id: m.id,
        name: m.name,
        enabled: existingIds.includes(m.id) || existingIds.length === 0
      }))

      setModels(newModels)
    } catch (err: any) {
      setModelsError(err.message)
    } finally {
      setLoadingModels(false)
    }
  }

  // 切换模型启用状态
  const handleToggleModel = (id: string) => {
    setModels(models.map(m =>
      m.id === id ? { ...m, enabled: !m.enabled } : m
    ))
  }

  const handleAddRewriteOption = () => {
    if (newRewriteOption.trim()) {
      setLocalSettings({
        ...localSettings,
        rewriteOptions: [
          ...localSettings.rewriteOptions,
          { id: Date.now(), text: newRewriteOption.trim(), enabled: true }
        ]
      })
      setNewRewriteOption('')
    }
  }

  const handleRemoveRewriteOption = (id: number) => {
    setLocalSettings({
      ...localSettings,
      rewriteOptions: localSettings.rewriteOptions.filter(o => o.id !== id)
    })
  }

  const handleAddGenreOption = () => {
    if (newGenreOption.trim()) {
      setLocalSettings({
        ...localSettings,
        genreOptions: [
          ...localSettings.genreOptions,
          { id: Date.now(), text: newGenreOption.trim() }
        ]
      })
      setNewGenreOption('')
    }
  }

  const handleRemoveGenreOption = (id: number) => {
    setLocalSettings({
      ...localSettings,
      genreOptions: localSettings.genreOptions.filter(o => o.id !== id)
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const result = await onSave(localSettings)
      if (result.success) {
        onClose()
      } else {
        setSaveError(result.error || '保存失败，请重试')
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存异常')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-gray-800 to-gray-900 text-white px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-semibold">⚙️ 改编设置</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white bg-opacity-20 hover:bg-opacity-30 transition-colors flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6 pt-4">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'models'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('models')}
          >
            🤖 模型选择
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'prompts'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('prompts')}
          >
            📝 角色提示词
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'options'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('options')}
          >
            🎭 剧情选项
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* 模型选择 Tab */}
          {activeTab === 'models' && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
                AI 服务使用项目统一配置（在 <a href="/settings" className="underline font-medium">设置页面</a> 配置 API 地址和密钥）。
                在此选择改编功能使用的模型。
              </div>

              {/* 获取模型按钮 */}
              <div className="flex items-center gap-4">
                <button
                  onClick={handleFetchModels}
                  disabled={loadingModels}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    loadingModels
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                >
                  {loadingModels ? '⏳ 获取中...' : '🔄 获取可用模型'}
                </button>
                {models.length > 0 && (
                  <span className="text-sm text-gray-500">已加载 {models.length} 个模型</span>
                )}
              </div>

              {modelsError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {modelsError}
                </div>
              )}

              {/* 模型列表 */}
              {models.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">可用模型（点击启用/禁用）</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {models.map(model => (
                      <div
                        key={model.id}
                        onClick={() => handleToggleModel(model.id)}
                        className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-all text-sm ${
                          model.enabled
                            ? 'bg-blue-50 border-2 border-blue-300'
                            : 'bg-gray-50 border-2 border-transparent hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={model.enabled}
                          onChange={() => handleToggleModel(model.id)}
                          className="w-4 h-4 text-blue-600"
                        />
                        <span className="text-gray-700 truncate">{model.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 角色模型分配 */}
              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-base font-semibold text-gray-800 mb-4">👤 角色模型分配</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      📚 小说主编
                    </label>
                    <select
                      value={localSettings.roleModels.editor}
                      onChange={(e) => setLocalSettings({
                        ...localSettings,
                        roleModels: { ...localSettings.roleModels, editor: e.target.value }
                      })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                    >
                      <option value="">使用默认模型</option>
                      {models.filter(m => m.enabled).map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      ✍️ 小说写手
                    </label>
                    <select
                      value={localSettings.roleModels.writer}
                      onChange={(e) => setLocalSettings({
                        ...localSettings,
                        roleModels: { ...localSettings.roleModels, writer: e.target.value }
                      })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                    >
                      <option value="">使用默认模型</option>
                      {models.filter(m => m.enabled).map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 角色提示词 Tab */}
          {activeTab === 'prompts' && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
                角色提示词决定了 AI 的行为方式。主编负责分析和规划，写手负责执行生成。
              </div>

              {/* 主编提示词 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-base font-semibold text-gray-800">
                    📚 主编提示词
                  </label>
                  <button
                    className="text-xs text-gray-500 hover:text-blue-600"
                    onClick={() => setLocalSettings({
                      ...localSettings,
                      rolePrompts: { ...localSettings.rolePrompts, editor: DEFAULT_EDITOR_PROMPT }
                    })}
                  >
                    恢复默认
                  </button>
                </div>
                <textarea
                  value={localSettings.rolePrompts.editor}
                  onChange={(e) => setLocalSettings({
                    ...localSettings,
                    rolePrompts: { ...localSettings.rolePrompts, editor: e.target.value }
                  })}
                  className="w-full h-48 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm leading-relaxed"
                  placeholder="输入主编的提示词..."
                />
              </div>

              {/* 写手提示词 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-base font-semibold text-gray-800">
                    ✍️ 写手提示词
                  </label>
                  <button
                    className="text-xs text-gray-500 hover:text-blue-600"
                    onClick={() => setLocalSettings({
                      ...localSettings,
                      rolePrompts: { ...localSettings.rolePrompts, writer: DEFAULT_WRITER_PROMPT }
                    })}
                  >
                    恢复默认
                  </button>
                </div>
                <textarea
                  value={localSettings.rolePrompts.writer}
                  onChange={(e) => setLocalSettings({
                    ...localSettings,
                    rolePrompts: { ...localSettings.rolePrompts, writer: e.target.value }
                  })}
                  className="w-full h-48 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm leading-relaxed"
                  placeholder="输入写手的提示词..."
                />
              </div>
            </div>
          )}

          {/* 剧情选项 Tab */}
          {activeTab === 'options' && (
            <div className="space-y-6">
              {/* 剧情改写选项管理 */}
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-200">
                  📌 剧情改写选项管理 <span className="text-sm font-normal text-gray-500">(多选)</span>
                </h3>
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={newRewriteOption}
                    onChange={(e) => setNewRewriteOption(e.target.value)}
                    placeholder="添加新的剧情改写选项..."
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddRewriteOption()}
                  />
                  <button
                    onClick={handleAddRewriteOption}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    + 添加
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {localSettings.rewriteOptions.map(option => (
                    <div
                      key={option.id}
                      className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-full text-sm"
                    >
                      <span className="text-gray-700">{option.text}</span>
                      <button
                        onClick={() => handleRemoveRewriteOption(option.id)}
                        className="w-5 h-5 rounded-full bg-gray-300 hover:bg-red-400 hover:text-white transition-colors flex items-center justify-center text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 剧情选项管理 */}
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-200">
                  🎭 剧情选项管理 <span className="text-sm font-normal text-gray-500">(单选)</span>
                </h3>
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={newGenreOption}
                    onChange={(e) => setNewGenreOption(e.target.value)}
                    placeholder="添加新的剧情选项..."
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddGenreOption()}
                  />
                  <button
                    onClick={handleAddGenreOption}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    + 添加
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {localSettings.genreOptions.map(option => (
                    <div
                      key={option.id}
                      className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-full text-sm"
                    >
                      <span className="text-gray-700">{option.text}</span>
                      <button
                        onClick={() => handleRemoveGenreOption(option.id)}
                        className="w-5 h-5 rounded-full bg-gray-300 hover:bg-red-400 hover:text-white transition-colors flex items-center justify-center text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
          {saveError && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              ⚠️ {saveError}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`px-6 py-2 rounded-lg text-white font-medium transition-colors ${
                saving
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {saving ? '⏳ 保存中...' : '💾 保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
