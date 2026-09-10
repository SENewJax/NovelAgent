// 角色类型
export type Role = 'editor' | 'writer'

// 模型配置
export interface ModelConfig {
  id: string
  name: string
  enabled: boolean
}

// 剧情改写选项
export interface RewriteOption {
  id: number
  text: string
  enabled: boolean
}

// 剧情选项
export interface GenreOption {
  id: number
  text: string
}

// 角色提示词配置
export interface RolePrompts {
  editor: string
  writer: string
}

// 角色模型分配
export interface RoleModels {
  editor: string
  writer: string
}

// 改编设置（不再包含独立的 API 配置）
export interface AdaptationSettings {
  roleModels: RoleModels
  rolePrompts: RolePrompts
  rewriteOptions: RewriteOption[]
  genreOptions: GenreOption[]
}

// 小说信息
export interface NovelInfo {
  id: string
  name: string
  chapters: number
  words: string
  date: string
  content?: string
}

// 分析结果
export interface AnalysisResult {
  analysisId: string
  background: string
  characters: string[]
  plotTrend: string
  summary: string
  originalOutline?: string  // 原本的小说大纲
  _details?: {
    stage1?: {
      scenes?: string[]
      conflicts?: string[]
      hooks?: string[]
      pacing?: string[]
      conflictStructure?: string
    }
    stage2?: {
      mainCharacters?: Array<{
        name: string
        role: string
        personality: string
        motivation: string
        relationships?: string[]
        arc?: string
      }>
      characterMap?: string
    }
    stage3?: {
      themes?: string[]
      writingStyle?: string
      foreshadowing?: string[]
      tone?: string
    }
    stage4?: any
  }
}

// 章节
export interface Chapter {
  index: number
  name: string
  summary: string
  targetWords: number
  chapterHook?: string
  writingConstraints?: string
}

// 卷
export interface Volume {
  name: string
  description: string
  chapters: Chapter[]
}

// 大纲
export interface Outline {
  outlineId: string
  title: string
  type: string
  chapters: Chapter[]
  totalTargetWords: number
  constraints: string[]
  volumes?: Volume[]
  planFile?: string
}

// 生成状态
export interface GenerationState {
  isGenerating: boolean
  progress: number
  currentChapter: string
  content: string
  totalChapters: number
  completedChapters: number
  totalWords: number
  generatedWords: number
}

// ── 章节级生成 ──────────────────────────────────────────

// 维度类型
export type DimensionType = 'mainPlot' | 'tension' | 'emotion' | 'sceneTransition' | 'callback' | 'foreshadowing'

// 维度状态
export interface DimensionState {
  status: 'pending' | 'generating' | 'done' | 'failed'
  content: string
  error?: string
  score?: number
  maxScore?: number
  scoreReason?: string
}

// 章节详细大纲
export interface ChapterDetailedOutline {
  chapterType: string
  keyEvents: string[]
  emotionalArc: string
  tensionCurve: string
  sceneFlow: string
  newForeshadowing: string[]
  callbackForeshadowing: string[]
  dimensionWeights: Record<DimensionType, number>
  scoreThreshold: number
}

// 章节生成状态
export interface ChapterGeneration {
  index: number
  name: string
  targetWords: number

  // 流程状态
  status: 'pending' | 'outlining' | 'generating' | 'orchestrating' | 'done' | 'failed'

  // 大纲细化结果
  detailedOutline?: ChapterDetailedOutline

  // 六维状态
  dimensions: Record<DimensionType, DimensionState>

  // 编排状态
  orchestration: {
    round: number
    maxRounds: number
    totalScore: number
    passThreshold: number
    pass: boolean
  }

  // 最终结果
  content: string
  words: number
  error?: string
}

// 创建空的维度状态
export function createEmptyDimensionState(): DimensionState {
  return {
    status: 'pending',
    content: ''
  }
}

// 创建空的章节生成状态
export function createEmptyChapterGeneration(index: number, name: string, targetWords: number): ChapterGeneration {
  return {
    index,
    name,
    targetWords,
    status: 'pending',
    dimensions: {
      mainPlot: createEmptyDimensionState(),
      tension: createEmptyDimensionState(),
      emotion: createEmptyDimensionState(),
      sceneTransition: createEmptyDimensionState(),
      callback: createEmptyDimensionState(),
      foreshadowing: createEmptyDimensionState()
    },
    orchestration: {
      round: 0,
      maxRounds: 2,
      totalScore: 0,
      passThreshold: 75,
      pass: false
    },
    content: '',
    words: 0
  }
}

// 改编状态
export interface AdaptationState {
  novel: NovelInfo | null
  role: Role | null
  settings: AdaptationSettings
  analysis: AnalysisResult | null
  outline: Outline | null
  customSettings: string[]
  selectedGenre: string | null
  generation: GenerationState
  chapterGenerations: ChapterGeneration[]  // 章节级生成状态
}

// 默认主编提示词
export const DEFAULT_EDITOR_PROMPT = `你是一个专业的小说主编，擅长分析和改编小说。

你的职责是：
1. 分析原始小说的故事背景、人物角色、剧情走向
2. 根据用户的要求和设定，生成改编大纲
3. 制定详细的执行计划，供写手执行

分析要求：
- 深入理解故事的核心冲突和主题
- 识别关键人物的性格特征和成长弧线
- 把握剧情节奏和转折点
- 提出有创意的改编方向`

// 默认写手提示词
export const DEFAULT_WRITER_PROMPT = `你是一个专业的小说写手，擅长根据大纲和计划创作小说。

你的职责是：
1. 按照主编提供的大纲和执行计划，逐步生成小说内容
2. 保持人物性格一致，情节连贯
3. 注重细节描写，营造氛围
4. 控制节奏，确保每章有适当的冲突和转折

写作要求：
- 文笔流畅，符合网文风格
- 人物对话自然，符合性格
- 场景描写生动，有画面感
- 情节紧凑，不拖沓`

// 默认设置
export const DEFAULT_SETTINGS: AdaptationSettings = {
  roleModels: {
    editor: '',
    writer: ''
  },
  rolePrompts: {
    editor: DEFAULT_EDITOR_PROMPT,
    writer: DEFAULT_WRITER_PROMPT
  },
  rewriteOptions: [
    { id: 1, text: '角色名随机（中式姓氏）', enabled: true },
    { id: 2, text: '城市布局采用中国（禁止名称直接映射）', enabled: true },
    { id: 3, text: '历史背景架空', enabled: true }
  ],
  genreOptions: [
    { id: 1, text: '末世求生' },
    { id: 2, text: '虐恋' },
    { id: 3, text: '甜甜恋爱' }
  ]
}
