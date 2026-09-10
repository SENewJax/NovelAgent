'use client'

import { useReducer, useEffect, useCallback } from 'react'
import type {
  AdaptationState,
  AdaptationSettings,
  NovelInfo,
  Role,
  AnalysisResult,
  Outline,
  GenerationState,
  ChapterGeneration,
  DimensionType,
  DimensionState
} from '../types/adaptation'
import { DEFAULT_SETTINGS, createEmptyChapterGeneration } from '../types/adaptation'
import { saveSettings, loadSettings, type SaveResult, type LoadResult } from '../services/adaptation-service'

// Action 类型
type AdaptationAction =
  | { type: 'SET_NOVEL'; payload: NovelInfo | null }
  | { type: 'SET_ROLE'; payload: Role | null }
  | { type: 'SET_SETTINGS'; payload: Partial<AdaptationSettings> }
  | { type: 'SET_ANALYSIS'; payload: AnalysisResult | null }
  | { type: 'SET_OUTLINE'; payload: Outline | null }
  | { type: 'SET_CUSTOM_SETTINGS'; payload: string[] }
  | { type: 'ADD_CUSTOM_SETTING'; payload: string }
  | { type: 'REMOVE_CUSTOM_SETTING'; payload: number }
  | { type: 'SET_SELECTED_GENRE'; payload: string | null }
  | { type: 'UPDATE_GENERATION'; payload: Partial<GenerationState> }
  | { type: 'INIT_CHAPTER_GENERATIONS'; payload: ChapterGeneration[] }
  | { type: 'UPDATE_CHAPTER_STATUS'; payload: { index: number; status: ChapterGeneration['status'] } }
  | { type: 'UPDATE_CHAPTER_OUTLINE'; payload: { index: number; detailedOutline: ChapterGeneration['detailedOutline'] } }
  | { type: 'UPDATE_DIMENSION_STATUS'; payload: { index: number; dimension: DimensionType; status: DimensionState['status'] } }
  | { type: 'UPDATE_DIMENSION_SCORE'; payload: { index: number; dimension: DimensionType; score: number; maxScore: number; reason: string } }
  | { type: 'UPDATE_ORCHESTRATION'; payload: { index: number; round: number; totalScore: number; pass: boolean } }
  | { type: 'SET_CHAPTER_CONTENT'; payload: { index: number; content: string; words: number } }
  | { type: 'RESET' }

// 初始状态
const initialState: AdaptationState = {
  novel: null,
  role: null,
  settings: DEFAULT_SETTINGS,
  analysis: null,
  outline: null,
  customSettings: [],
  selectedGenre: null,
  generation: {
    isGenerating: false,
    progress: 0,
    currentChapter: '',
    content: '',
    totalChapters: 0,
    completedChapters: 0,
    totalWords: 0,
    generatedWords: 0
  },
  chapterGenerations: []
}

// Reducer
function adaptationReducer(state: AdaptationState, action: AdaptationAction): AdaptationState {
  switch (action.type) {
    case 'SET_NOVEL':
      return { ...state, novel: action.payload }

    case 'SET_ROLE':
      return { ...state, role: action.payload }

    case 'SET_SETTINGS':
      return {
        ...state,
        settings: { ...state.settings, ...action.payload }
      }

    case 'SET_ANALYSIS':
      return { ...state, analysis: action.payload }

    case 'SET_OUTLINE':
      return { ...state, outline: action.payload }

    case 'SET_CUSTOM_SETTINGS':
      return { ...state, customSettings: action.payload }

    case 'ADD_CUSTOM_SETTING':
      return { ...state, customSettings: [...state.customSettings, action.payload] }

    case 'REMOVE_CUSTOM_SETTING':
      return {
        ...state,
        customSettings: state.customSettings.filter((_, i) => i !== action.payload)
      }

    case 'SET_SELECTED_GENRE':
      return { ...state, selectedGenre: action.payload }

    case 'UPDATE_GENERATION':
      return {
        ...state,
        generation: { ...state.generation, ...action.payload }
      }

    case 'RESET':
      return initialState

    case 'INIT_CHAPTER_GENERATIONS':
      return { ...state, chapterGenerations: action.payload }

    case 'UPDATE_CHAPTER_STATUS':
      return {
        ...state,
        chapterGenerations: state.chapterGenerations.map(ch =>
          ch.index === action.payload.index
            ? { ...ch, status: action.payload.status }
            : ch
        )
      }

    case 'UPDATE_CHAPTER_OUTLINE':
      return {
        ...state,
        chapterGenerations: state.chapterGenerations.map(ch =>
          ch.index === action.payload.index
            ? { ...ch, detailedOutline: action.payload.detailedOutline, status: 'generating' }
            : ch
        )
      }

    case 'UPDATE_DIMENSION_STATUS':
      return {
        ...state,
        chapterGenerations: state.chapterGenerations.map(ch =>
          ch.index === action.payload.index
            ? {
              ...ch,
              dimensions: {
                ...ch.dimensions,
                [action.payload.dimension]: {
                  ...ch.dimensions[action.payload.dimension],
                  status: action.payload.status
                }
              }
            }
            : ch
        )
      }

    case 'UPDATE_DIMENSION_SCORE':
      return {
        ...state,
        chapterGenerations: state.chapterGenerations.map(ch =>
          ch.index === action.payload.index
            ? {
              ...ch,
              dimensions: {
                ...ch.dimensions,
                [action.payload.dimension]: {
                  ...ch.dimensions[action.payload.dimension],
                  score: action.payload.score,
                  maxScore: action.payload.maxScore,
                  scoreReason: action.payload.reason
                }
              }
            }
            : ch
        )
      }

    case 'UPDATE_ORCHESTRATION':
      return {
        ...state,
        chapterGenerations: state.chapterGenerations.map(ch =>
          ch.index === action.payload.index
            ? {
              ...ch,
              orchestration: {
                ...ch.orchestration,
                round: action.payload.round,
                totalScore: action.payload.totalScore,
                pass: action.payload.pass
              },
              status: action.payload.pass ? 'done' : 'orchestrating'
            }
            : ch
        )
      }

    case 'SET_CHAPTER_CONTENT':
      return {
        ...state,
        chapterGenerations: state.chapterGenerations.map(ch =>
          ch.index === action.payload.index
            ? { ...ch, content: action.payload.content, words: action.payload.words, status: 'done' }
            : ch
        )
      }

    default:
      return state
  }
}

// Hook
export function useAdaptation() {
  const [state, dispatch] = useReducer(adaptationReducer, initialState)

  // 加载保存的设置
  useEffect(() => {
    console.log('[useAdaptation] 开始加载设置...')
    loadSettings().then((result: LoadResult) => {
      console.log('[useAdaptation] 加载结果:', result)
      if (result.settings) {
        const merged = {
          ...DEFAULT_SETTINGS,
          ...result.settings
        }
        console.log('[useAdaptation] 合并后的设置 (来源:', result.source, '):', merged)
        dispatch({
          type: 'SET_SETTINGS',
          payload: merged
        })
      } else {
        console.log('[useAdaptation] 没有保存的设置，使用默认设置')
        if (result.error) {
          console.warn('[useAdaptation] 加载时有错误:', result.error)
        }
      }
    }).catch(err => {
      console.error('[useAdaptation] 加载设置异常:', err)
    })
  }, [])

  // 保存设置（必须传入 payload，避免闭包捕获过时 state）
  const saveSettingsToStorage = useCallback(async (payload: AdaptationSettings): Promise<SaveResult> => {
    const result = await saveSettings(payload)
    if (result.backendSaved) {
      console.log('[useAdaptation] 设置已保存到后端')
    } else if (result.localStorageSaved) {
      console.warn('[useAdaptation] 后端保存失败，已降级保存到 localStorage')
    } else {
      console.error('[useAdaptation] 设置保存完全失败:', result.error)
    }
    return result
  }, [])

  // Actions
  const setNovel = useCallback((novel: NovelInfo | null) => {
    dispatch({ type: 'SET_NOVEL', payload: novel })
  }, [])

  const setRole = useCallback((role: Role | null) => {
    dispatch({ type: 'SET_ROLE', payload: role })
  }, [])

  const updateSettings = useCallback((updates: Partial<AdaptationSettings>) => {
    dispatch({ type: 'SET_SETTINGS', payload: updates })
  }, [])

  const setAnalysis = useCallback((analysis: AnalysisResult | null) => {
    dispatch({ type: 'SET_ANALYSIS', payload: analysis })
  }, [])

  const setOutline = useCallback((outline: Outline | null) => {
    dispatch({ type: 'SET_OUTLINE', payload: outline })
  }, [])

  const setCustomSettings = useCallback((settings: string[]) => {
    dispatch({ type: 'SET_CUSTOM_SETTINGS', payload: settings })
  }, [])

  const addCustomSetting = useCallback((text: string) => {
    dispatch({ type: 'ADD_CUSTOM_SETTING', payload: text })
  }, [])

  const removeCustomSetting = useCallback((index: number) => {
    dispatch({ type: 'REMOVE_CUSTOM_SETTING', payload: index })
  }, [])

  const setSelectedGenre = useCallback((genre: string | null) => {
    dispatch({ type: 'SET_SELECTED_GENRE', payload: genre })
  }, [])

  const updateGeneration = useCallback((updates: Partial<GenerationState>) => {
    dispatch({ type: 'UPDATE_GENERATION', payload: updates })
  }, [])

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' })
  }, [])

  // 章节级生成状态管理
  const initChapterGenerations = useCallback((chapters: ChapterGeneration[]) => {
    dispatch({ type: 'INIT_CHAPTER_GENERATIONS', payload: chapters })
  }, [])

  const updateChapterStatus = useCallback((index: number, status: ChapterGeneration['status']) => {
    dispatch({ type: 'UPDATE_CHAPTER_STATUS', payload: { index, status } })
  }, [])

  const updateChapterOutline = useCallback((index: number, detailedOutline: ChapterGeneration['detailedOutline']) => {
    dispatch({ type: 'UPDATE_CHAPTER_OUTLINE', payload: { index, detailedOutline } })
  }, [])

  const updateDimensionStatus = useCallback((index: number, dimension: DimensionType, status: DimensionState['status']) => {
    dispatch({ type: 'UPDATE_DIMENSION_STATUS', payload: { index, dimension, status } })
  }, [])

  const updateDimensionScore = useCallback((index: number, dimension: DimensionType, score: number, maxScore: number, reason: string) => {
    dispatch({ type: 'UPDATE_DIMENSION_SCORE', payload: { index, dimension, score, maxScore, reason } })
  }, [])

  const updateOrchestration = useCallback((index: number, round: number, totalScore: number, pass: boolean) => {
    dispatch({ type: 'UPDATE_ORCHESTRATION', payload: { index, round, totalScore, pass } })
  }, [])

  const setChapterContent = useCallback((index: number, content: string, words: number) => {
    dispatch({ type: 'SET_CHAPTER_CONTENT', payload: { index, content, words } })
  }, [])

  // 更新角色提示词
  const updateEditorPrompt = useCallback((prompt: string) => {
    dispatch({
      type: 'SET_SETTINGS',
      payload: {
        rolePrompts: { ...state.settings.rolePrompts, editor: prompt }
      }
    })
  }, [state.settings.rolePrompts])

  const updateWriterPrompt = useCallback((prompt: string) => {
    dispatch({
      type: 'SET_SETTINGS',
      payload: {
        rolePrompts: { ...state.settings.rolePrompts, writer: prompt }
      }
    })
  }, [state.settings.rolePrompts])

  return {
    state,
    actions: {
      setNovel,
      setRole,
      updateSettings,
      setAnalysis,
      setOutline,
      setCustomSettings,
      addCustomSetting,
      removeCustomSetting,
      setSelectedGenre,
      updateGeneration,
      updateEditorPrompt,
      updateWriterPrompt,
      reset,
      saveSettings: saveSettingsToStorage,
      // 章节级生成
      initChapterGenerations,
      updateChapterStatus,
      updateChapterOutline,
      updateDimensionStatus,
      updateDimensionScore,
      updateOrchestration,
      setChapterContent
    }
  }
}
