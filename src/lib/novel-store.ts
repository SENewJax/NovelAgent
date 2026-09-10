import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  NovelProject,
  Chapter,
  AnalysisResult,
  RewriteVersion,
  ContinueChapter,
  ChapterScore,
  StyleProfile,
  Gender,
  CategoryDetection,
  AnalysisDraft,
} from "@/scoring/types";
import { findWeakestDimensions, weightsFromContext } from "@/scoring/calculator";
import { extractStyleProfile } from "@/agents/style-profiler";

const NOVEL_DIR = path.join(process.cwd(), ".novel");

/**
 * 确保 .novel 目录存在
 */
async function ensureDir() {
  await fs.mkdir(NOVEL_DIR, { recursive: true });
}

/**
 * 获取项目目录
 */
function projectDir(id: string) {
  return path.join(NOVEL_DIR, id);
}

/**
 * 创建新项目（上传小说时调用）
 * @param platformId 配置包平台 id，决定用哪套基准权重与提示词
 */
export async function createProject(
  fileName: string,
  fileContent: string,
  platformId?: string
): Promise<NovelProject> {
  await ensureDir();

  const id = uuidv4().slice(0, 8);
  const name = fileName.replace(/\.txt$/i, "");
  const dir = projectDir(id);

  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "chapters"), { recursive: true });
  await fs.mkdir(path.join(dir, "rewrites"), { recursive: true });
  await fs.mkdir(path.join(dir, "continues"), { recursive: true });

  // 保存原始文件
  await fs.writeFile(path.join(dir, "original.txt"), fileContent, "utf-8");

  // 分割章节
  const chapters = splitChapters(fileContent);

  // 保存章节文件
  for (const ch of chapters) {
    await fs.writeFile(
      path.join(dir, "chapters", `${ch.index}.txt`),
      ch.content,
      "utf-8"
    );
  }

  const project: NovelProject = {
    id,
    name,
    platformId,
    createdAt: new Date().toISOString(),
    chapters,
    rewrites: {},
    continues: [],
  };

  await fs.writeFile(
    path.join(dir, "project.json"),
    JSON.stringify(project, null, 2),
    "utf-8"
  );

  return project;
}

/**
 * 加载项目
 */
export async function loadProject(id: string): Promise<NovelProject | null> {
  try {
    const data = await fs.readFile(
      path.join(projectDir(id), "project.json"),
      "utf-8"
    );
    return JSON.parse(data) as NovelProject;
  } catch {
    return null;
  }
}

/**
 * 保存项目
 */
export async function saveProject(project: NovelProject): Promise<void> {
  await fs.writeFile(
    path.join(projectDir(project.id), "project.json"),
    JSON.stringify(project, null, 2),
    "utf-8"
  );
}

/**
 * 保存分析结果
 */
export async function saveAnalysis(
  id: string,
  result: AnalysisResult
): Promise<void> {
  const project = await loadProject(id);
  if (!project) throw new Error("Project not found: " + id);

  project.analysis = result;
  await saveProject(project);

  await fs.writeFile(
    path.join(projectDir(id), "analysis.json"),
    JSON.stringify(result, null, 2),
    "utf-8"
  );
}

/**
 * 加载分析结果
 */
export async function loadAnalysis(id: string): Promise<AnalysisResult | null> {
  try {
    const data = await fs.readFile(
      path.join(projectDir(id), "analysis.json"),
      "utf-8"
    );
    return JSON.parse(data) as AnalysisResult;
  } catch {
    return null;
  }
}

/**
 * 加载分析草稿（断点续跑用）
 */
export async function loadAnalysisDraft(id: string): Promise<AnalysisDraft | null> {
  try {
    const data = await fs.readFile(
      path.join(projectDir(id), "analysis-draft.json"),
      "utf-8"
    );
    return JSON.parse(data) as AnalysisDraft;
  } catch {
    return null;
  }
}

/**
 * 保存分析草稿（增量持久化，每完成一个步骤就写盘）
 */
export async function saveAnalysisDraft(id: string, draft: AnalysisDraft): Promise<void> {
  draft.updatedAt = new Date().toISOString();
  const filePath = path.join(projectDir(id), "analysis-draft.json");
  const tmpPath = filePath + ".tmp";
  // 原子写入：先写临时文件，再 rename，防止崩溃时文件损坏
  await fs.writeFile(tmpPath, JSON.stringify(draft, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}

/**
 * 清除分析草稿（分析完成后调用）
 */
export async function clearAnalysisDraft(id: string): Promise<void> {
  try {
    await fs.unlink(path.join(projectDir(id), "analysis-draft.json"));
  } catch {
    // 草稿不存在时忽略
  }
}

/**
 * 清除分析结果（用于重新分析）
 * 同时清理 project.json 中的 analysis 与型判定字段，以及 analysis.json 文件
 */
export async function clearAnalysis(id: string): Promise<void> {
  const project = await loadProject(id);
  if (!project) throw new Error("Project not found: " + id);

  delete project.analysis;
  delete project.gender;
  delete project.primaryCategory;
  delete project.secondaryCategory;
  delete project.categoryDetection;
  delete project.styleProfile;
  await saveProject(project);

  try {
    await fs.unlink(path.join(projectDir(id), "analysis.json"));
  } catch {
    // analysis.json 不存在时忽略
  }

  // 同时清除草稿
  await clearAnalysisDraft(id);
}

/**
 * 保存改写版本（同时更新章节内容）
 */
export async function saveRewrite(
  id: string,
  chapterIndex: number,
  rewrite: RewriteVersion
): Promise<void> {
  const project = await loadProject(id);
  if (!project) throw new Error("Project not found: " + id);

  if (!project.rewrites[chapterIndex]) {
    project.rewrites[chapterIndex] = [];
  }
  project.rewrites[chapterIndex].push(rewrite);

  // 同时更新章节内容，使改写后的内容立即可见
  if (project.chapters[chapterIndex]) {
    project.chapters[chapterIndex].content = rewrite.content;
    project.chapters[chapterIndex].wordCount = rewrite.content.length;
    project.chapters[chapterIndex].sourceKind = "rewrite";
    project.chapters[chapterIndex].sourceVersion = rewrite.version;
    project.chapters[chapterIndex].contentHash = undefined;
  }
  if (project.analysis) {
    project.analysis.chapters = project.analysis.chapters.map((score) => score.index === chapterIndex ? { ...score, stale: true, staleReason: "章节已改写" } : score);
    project.analysis.overall = { ...project.analysis.overall, stale: true, staleReason: "章节已改写" };
  }

  await saveProject(project);
}

/**
 * 保存续写章节（同时添加到章节列表和评分中）
 */
export async function saveContinue(
  id: string,
  chapter: ContinueChapter
): Promise<void> {
  const project = await loadProject(id);
  if (!project) throw new Error("Project not found: " + id);

  project.continues.push(chapter);

  // 同时添加到 chapters 数组，使续写章节立即可见
  // 用当前 chapters.length 作为 index，确保不重复、不跳号
  const newIndex = Math.max(-1, ...project.chapters.map((c) => c.index)) + 1;
  project.chapters.push({
    title: chapter.title,
    content: chapter.content,
    index: newIndex,
    wordCount: chapter.content.length,
    sourceKind: "continue",
    sourceVersion: 1,
  });

  // 同步评分到 analysis.chapters，使续写章节支持改写和显示分数
  if (project.analysis && chapter.scores) {
    const chapterScore: ChapterScore = {
      index: newIndex,
      title: chapter.title,
      wordCount: chapter.content.length,
      scores: chapter.scores.scores,
      weightedTotal: chapter.scores.weightedTotal,
      summary: chapter.scores.summary,
      emotionalBeat: "（续写章节）",
      weakestDimensions: findWeakestDimensions(
        chapter.scores.scores,
        weightsFromContext(project.analysis.scoringContext),
        2
      ),
    };
    project.analysis.chapters.push({ ...chapterScore, sourceHash: undefined, scoringMode: "hybrid", confidence: chapter.scores.confidence });
  }

  await saveProject(project);
}

/**
 * 获取所有项目列表
 */
export async function listProjects(): Promise<
  {
    id: string;
    name: string;
    createdAt: string;
    totalScore?: number;
    gender?: Gender;
    primaryCategory?: string;
    secondaryCategory?: string;
    categoryDetection?: CategoryDetection;
  }[]
> {
  await ensureDir();
  const dirs = await fs.readdir(NOVEL_DIR);
  const projects = [];

  for (const dir of dirs) {
    try {
      const data = await fs.readFile(
        path.join(NOVEL_DIR, dir, "project.json"),
        "utf-8"
      );
      const project = JSON.parse(data) as NovelProject;
      projects.push({
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        totalScore: project.analysis?.overall.weightedTotal,
        gender: project.gender,
        primaryCategory: project.primaryCategory,
        secondaryCategory: project.secondaryCategory,
        categoryDetection: project.categoryDetection,
      });
    } catch {
      // skip invalid
    }
  }

  return projects.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * 获取章节内容（原始上传内容，不受改写影响）
 */
export async function getChapterContent(
  id: string,
  chapterIndex: number
): Promise<string | null> {
  try {
    const project = await loadProject(id);
    const current = project?.chapters.find((c) => c.index === chapterIndex);
    if (current) return current.content;
    return await fs.readFile(path.join(projectDir(id), "chapters", `${chapterIndex}.txt`), "utf-8");
  } catch {
    return null;
  }
}

/**
 * 获取作者风格指纹（带缓存）
 *
 * 首次调用时从原始章节文件中提取（避免被改写内容污染），
 * 提取后缓存到 project.styleProfile，后续直接读缓存。
 */
export async function getOrExtractStyleProfile(
  id: string
): Promise<StyleProfile> {
  const project = await loadProject(id);
  if (!project) throw new Error("Project not found: " + id);

  // 命中缓存直接返回
  if (project.styleProfile) return project.styleProfile;

  // 优先从原始章节文件读取（chapters/*.txt 保留上传时的原文，不受改写影响）
  // 只取原文的前几章做风格样本，续写章节不参与风格提取
  const originalChapterCount = Math.min(
    project.chapters.length,
    project.chapters.length - project.continues.length
  );

  const samples: Chapter[] = [];
  for (let i = 0; i < originalChapterCount; i++) {
    const original = await getChapterContent(id, i);
    if (original) {
      samples.push({
        index: i,
        title: project.chapters[i].title,
        content: original,
        wordCount: original.length,
      });
    }
  }

  // 回退：没有原始文件时用 project.chapters 中的内容
  if (samples.length === 0) {
    samples.push(...project.chapters.slice(0, 3));
  }

  if (samples.length === 0) throw new Error("没有可用于风格提取的章节内容");

  const profile = await extractStyleProfile(samples);

  // 缓存到项目
  project.styleProfile = profile;
  await saveProject(project);

  return profile;
}

/**
 * 清除风格指纹缓存（重新分析时可调用）
 */
export async function clearStyleProfile(id: string): Promise<void> {
  const project = await loadProject(id);
  if (!project) return;
  delete project.styleProfile;
  await saveProject(project);
}

// ──────────────────────────────────────
// 章节分割逻辑
// ──────────────────────────────────────

export function splitChapters(text: string): Chapter[] {
  // 支持多种章节标题格式
  const chapterPattern =
    /^(#{1,3}\s*(?:第[\s]*[〇零一二两三四五六七八九十百千万亿\d]+[章节回]?\s*.*)|第[\s]*[〇零一二两三四五六七八九十百千万亿\d]+[章节回]\s*.*|\d+[\.、\s]+\S.*)/gm;

  const matches = [...text.matchAll(chapterPattern)];

  if (matches.length === 0) {
    // 没有章节标记，按固定长度分割（每3000字一章）
    return splitByLength(text, 3000);
  }

  const chapters: Chapter[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const title = match[1].trim();
    const startIdx = match.index! + match[0].length;
    const endIdx = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const content = text.slice(startIdx, endIdx).trim();

    if (content.length > 0) {
      chapters.push({
        index: i,
        title,
        content,
        wordCount: content.length,
      });
    }
  }

  return chapters;
}

function splitByLength(text: string, maxLen: number): Chapter[] {
  const chapters: Chapter[] = [];
  let i = 0;
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxLen, text.length);
    const content = text.slice(start, end).trim();

    if (content.length > 0) {
      chapters.push({
        index: i,
        title: `第${i + 1}章`,
        content,
        wordCount: content.length,
      });
    }

    start = end;
    i++;
  }

  return chapters;
}
