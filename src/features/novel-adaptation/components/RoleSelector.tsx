'use client'

import type { Role, RoleModels } from '../types/adaptation'

interface RoleSelectorProps {
  selectedRole: Role | null
  roleModels: RoleModels
  onSelect: (role: Role) => void
}

export function RoleSelector({ selectedRole, roleModels, onSelect }: RoleSelectorProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">👥 选择角色</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 小说主编 */}
        <div
          className={`border-2 rounded-xl p-6 cursor-pointer transition-all ${
            selectedRole === 'editor'
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 hover:border-blue-300 hover:shadow-md'
          }`}
          onClick={() => onSelect('editor')}
        >
          <div className="text-4xl mb-3">📚</div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">小说主编</h3>
          <p className="text-gray-600 text-sm leading-relaxed">
            分析原始小说，生成大纲，制定执行计划
            <br />
            • 分析故事背景、人物角色、剧情走向
            <br />
            • 补充剧情改写选项
            <br />
            • 生成执行计划
          </p>
          <div className="mt-4 pt-4 border-t border-gray-200 text-sm text-blue-600">
            🤖 模型: {roleModels.editor || '未设置'}
          </div>
        </div>

        {/* 小说写手 */}
        <div
          className={`border-2 rounded-xl p-6 cursor-pointer transition-all ${
            selectedRole === 'writer'
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 hover:border-blue-300 hover:shadow-md'
          }`}
          onClick={() => onSelect('writer')}
        >
          <div className="text-4xl mb-3">✍️</div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">小说写手</h3>
          <p className="text-gray-600 text-sm leading-relaxed">
            基于大纲和执行计划，执行小说生成
            <br />
            • 按章节逐步生成
            <br />
            • 流式输出内容
            <br />
            • 进度追踪
          </p>
          <div className="mt-4 pt-4 border-t border-gray-200 text-sm text-blue-600">
            🤖 模型: {roleModels.writer || '未设置'}
          </div>
        </div>
      </div>
    </div>
  )
}
