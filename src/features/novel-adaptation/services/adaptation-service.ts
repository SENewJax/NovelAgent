import type { AdaptationSettings, Outline, AnalysisResult } from '../types/adaptation'

// 保存结果
export interface SaveResult {
  success: boolean
  backendSaved: boolean
  localStorageSaved: boolean
  error?: string
}

// 加载结果
export interface LoadResult {
  settings: AdaptationSettings | null
  source: 'backend' | 'localStorage' | 'none'
  error?: string
}

// 保存设置到后端
export async function saveSettings(settings: AdaptationSettings): Promise<SaveResult> {
  const result: SaveResult = { success: false, backendSaved: false, localStorageSaved: false }

  try {
    const response = await fetch('/api/adaptation/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `保存失败 (HTTP ${response.status})`)
    }

    console.log('[adaptation] 设置已保存到后端')
    result.success = true
    result.backendSaved = true
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[adaptation] 后端保存失败，尝试 localStorage 降级:', msg)
    result.error = msg

    // 降级到 localStorage
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('novelAdaptationSettings', JSON.stringify(settings))
        result.localStorageSaved = true
        console.log('[adaptation] 设置已保存到 localStorage（降级）')
      } catch (e) {
        console.error('[adaptation] localStorage 保存也失败:', e)
      }
    }

    return result
  }
}

// 从后端加载设置
export async function loadSettings(): Promise<LoadResult> {
  try {
    const response = await fetch('/api/adaptation/settings')
    if (!response.ok) {
      throw new Error(`加载失败 (HTTP ${response.status})`)
    }

    const data = await response.json()
    if (data.success && data.data) {
      console.log('[adaptation] 从后端加载设置成功')
      return { settings: data.data, source: 'backend' }
    }

    // 后端没有设置，尝试从 localStorage 加载
    const local = loadSettingsFromLocalStorage()
    return { settings: local, source: local ? 'localStorage' : 'none' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[adaptation] 从后端加载设置失败:', msg)
    // 降级到 localStorage
    const local = loadSettingsFromLocalStorage()
    return { settings: local, source: local ? 'localStorage' : 'none', error: msg }
  }
}

// 从 localStorage 加载设置（降级方案）
function loadSettingsFromLocalStorage(): AdaptationSettings | null {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('novelAdaptationSettings')
      if (saved) {
        const parsed = JSON.parse(saved)
        console.log('[adaptation] 从 localStorage 加载设置（降级）')
        return parsed
      }
    } catch (err) {
      console.error('[adaptation] localStorage 加载失败:', err)
    }
  }
  return null
}

// 分析小说
export async function analyzeNovel(
  novelId: string,
  userPrompt: string,
  model?: string,
  filePath?: string
): Promise<AnalysisResult> {
  const response = await fetch('/api/adaptation/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novelId, userPrompt, model, filePath })
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || '分析失败')
  }

  const data = await response.json()
  return data.data
}

// 生成大纲
export async function generateOutline(
  analysisId: string,
  analysis: AnalysisResult | null,
  options: {
    rewriteOptions: string[]
    genre: string
    customSettings: string[]
    userPrompt: string
  },
  model?: string
): Promise<Outline> {
  const response = await fetch('/api/adaptation/outline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysisId, analysis, options, model })
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || '生成大纲失败')
  }

  const data = await response.json()
  return data.data
}

// 执行生成 (SSE)
export async function executeGeneration(
  outlineId: string,
  planFile: string | undefined,
  model: string,
  onProgress: (data: any) => void,
  onContent: (text: string) => void,
  onComplete?: (data: any) => void,
  signal?: AbortSignal,
  analysis?: AnalysisResult | null
): Promise<void> {
  const response = await fetch('/api/adaptation/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outlineId, planFile, model, analysis }),
    signal
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || '执行生成失败')
  }

  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

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
            onProgress(data.data)
          } else if (data.type === 'content') {
            onContent(data.data.text)
          } else if (data.type === 'complete') {
            onComplete?.(data.data)
          } else if (data.type === 'error') {
            throw new Error(data.data.message)
          }
        } catch (e: any) {
          if (e.message) throw e
        }
      }
    }
  }
}

// 上传小说
export async function uploadNovel(file: File): Promise<{ id: string; name: string }> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || '上传失败')
  }

  return response.json()
}
