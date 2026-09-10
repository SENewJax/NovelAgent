'use client'

import { useState, useCallback } from 'react'

interface DropZoneProps {
  onFileSelect: (file: File) => void
}

export function DropZone({ onFileSelect }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.txt')) {
      onFileSelect(file)
    }
  }, [onFileSelect])

  const handleClick = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.txt'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        onFileSelect(file)
      }
    }
    input.click()
  }, [onFileSelect])

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
        dragOver
          ? 'border-blue-400 bg-blue-50'
          : 'border-gray-300 hover:border-gray-400'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <div className="text-5xl mb-4">📁</div>
      <p className="text-gray-600 text-lg">
        拖动小说到此处上传，或{' '}
        <span className="text-blue-600 underline">点击选择文件</span>
      </p>
      <p className="text-gray-400 text-sm mt-2">支持 .txt 格式的小说文件</p>
    </div>
  )
}
