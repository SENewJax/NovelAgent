import { planNextChapter, generateContinueText, ChapterPlan } from "@/agents/writer";
import { rescoreText } from "@/agents/scorer";
import { removeAIFlavor } from "@/agents/deai";
import { removeAds } from "@/agents/ad-detector";
import { alignStyle } from "@/agents/style-align";
import { reviewChapter } from "@/agents/reviewer";
import { ContinueChapter, Chapter, CategoryDetection, StyleProfile } from "@/scoring/types";
import { loadProject, saveContinue, getOrExtractStyleProfile } from "@/lib/novel-store";

export interface ContinueOptions {
  enableDeAI?: boolean;
  enableAdRemove?: boolean;
  enableStyleAlign?: boolean;
  styleHint?: string;
}

export interface ContinueProgress {
  phase: "loading" | "planning" | "generating" | "adcheck" | "deai" | "stylealign" | "scoring" | "complete" | "waiting_confirm";
  message: string;
  plan?: ChapterPlan;
  content?: string;
}

/**
 * Step 1: 生成续写规划（返回给前端确认）
 */
export async function generatePlan(
  projectId: string,
  afterChapter: number
): Promise<{ plan: ChapterPlan; context: string }> {
  const project = await loadProject(projectId);
  if (!project) throw new Error("项目不存在");
  if (!project.analysis) throw new Error("请先执行分析");

  // 获取最后几章作为上下文
  const lastChapters = project.chapters.slice(
    Math.max(0, afterChapter - 1),
    afterChapter + 1
  );

  const styleContext = `${project.analysis.style.genre} ${project.analysis.style.tone}，${project.analysis.style.narrative}。${project.analysis.style.summary}`;
  const characters = project.analysis.characters
    .map((c) => `${c.name}(${c.type}): ${c.oneLiner}`)
    .join("；");

  const plan = await planNextChapter(lastChapters, styleContext, characters, project.categoryDetection);

  return { plan, context: styleContext };
}

/**
 * Step 2: 用户确认规划后，生成正文，风格向原作者看齐
 * Pipeline: 生成(注入风格指纹) → 去广告(可选) → 去AI味(可选) → 风格对齐(可选) → 自检打分
 */
export async function generateChapter(
  projectId: string,
  plan: ChapterPlan,
  afterChapter: number,
  options?: ContinueOptions,
  onProgress?: (p: ContinueProgress) => void
): Promise<ContinueChapter> {
  const pipelineStart = Date.now();
  const log = (step: string, detail?: string) => {
    const tag = `[Continue][${projectId.slice(0, 8)}][ch${afterChapter + 1}][${step}]`;
    console.log(`${tag} ${detail || ""}`);
  };
  const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    log(label, "start");
    try {
      const result = await fn();
      log(label, `done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return result;
    } catch (err: any) {
      log(label, `FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${err.message}`);
      throw err;
    }
  };

  const project = await loadProject(projectId);
  if (!project) throw new Error("项目不存在");
  if (!project.analysis) throw new Error("请先执行分析");

  const enableDeAI = options?.enableDeAI !== false;
  const enableAdRemove = options?.enableAdRemove !== false;
  const enableStyleAlign = options?.enableStyleAlign !== false; // 默认开启
  const styleHint = options?.styleHint;

  log("pipeline", `start | deAI=${enableDeAI} adRemove=${enableAdRemove} styleAlign=${enableStyleAlign}`);

  const lastChapters = project.chapters.slice(
    Math.max(0, afterChapter - 1),
    afterChapter + 1
  );

  const styleContext = `${project.analysis.style.genre} ${project.analysis.style.tone}，${project.analysis.style.narrative}。${project.analysis.style.summary}`;

  // 获取作者风格指纹（首次使用时提取，之后读缓存）
  let styleProfile: StyleProfile | undefined;
  if (enableStyleAlign) {
    onProgress?.({ phase: "loading", message: "🖊 提取作者风格指纹..." });
    try {
      styleProfile = await timed("style_profile", () => getOrExtractStyleProfile(projectId));
      onProgress?.({ phase: "loading", message: `✓ 风格指纹就绪：${styleProfile.summary}` });
    } catch (err: any) {
      log("style_profile", `skip: ${err.message}`);
      // 风格提取失败不阻断主流程，降级为无风格约束模式运行
    }
  }

  onProgress?.({ phase: "generating", message: "正在生成章节正文..." });

  let content = await timed("generate", () =>
    generateContinueText(plan, lastChapters, styleContext, project.categoryDetection, styleProfile)
  );

  // 去广告 Pipeline
  if (enableAdRemove) {
    onProgress?.({ phase: "adcheck", message: "广告检测中...", content });

    const adResult = await timed("adcheck", () => removeAds(content));
    content = adResult.cleanText;
  }

  // 去AI味 Pipeline
  if (enableDeAI) {
    onProgress?.({ phase: "deai", message: "去AI味润色中...", content });

    const toneHint = styleHint || `${project.analysis.style.tone}，${project.analysis.style.genre}`;
    content = await timed("deai", () => removeAIFlavor(content, toneHint, project.categoryDetection));
  }

  // 风格对齐 Pipeline（消除“作者换人”既视感）
  if (enableStyleAlign && styleProfile) {
    onProgress?.({ phase: "stylealign", message: "🖊 风格对齐：向原作者风格看齐...", content });

    content = await timed("stylealign", () => alignStyle(content, styleProfile));
  }

  // 真实新章号：以项目章节数组最大 index +1 为准，不用前端（可能滞后的）afterChapter。
  // 前端的 afterChapter 来自 React state，两次连续续写时第二次可能还是旧值，
  // 导致标题编号重复（如「第186章」出现两次）。
  const newIndex = Math.max(-1, ...project.chapters.map((c) => c.index)) + 1;
  const correctedTitle = plan.title.replace(/第\s*\d+\s*章\s*/, `第${newIndex + 1}章 `);

  onProgress?.({ phase: "scoring", message: "自检打分中...", content });

  // 自检打分（复用分析时解析出的评分上下文，否则权重为空、总分恒为 0）
  const scoringContext = project.analysis?.scoringContext;
  const scores = await timed("rescore", () =>
    rescoreText(content, correctedTitle, undefined, project.categoryDetection, scoringContext)
  );

  // 审稿校验（如果有型判定）
  if (project.categoryDetection) {
    try {
      onProgress?.({ phase: "scoring", message: "📝 Acting: 审稿校验中..." });
      const td = project.categoryDetection;
      await timed("review", () => reviewChapter(content, td, correctedTitle));
    } catch {
      // 审稿失败不阻断主流程
    }
  }

  const continueChapter: ContinueChapter = {
    index: newIndex,
    title: correctedTitle,
    plan: JSON.stringify(plan),
    content,
    scores,
    createdAt: new Date().toISOString(),
  };

  await saveContinue(projectId, continueChapter);

  onProgress?.({ phase: "complete", message: "续写完成！", content });

  log("pipeline", `done | index=${newIndex} title=${correctedTitle} total=${((Date.now() - pipelineStart) / 1000).toFixed(1)}s`);

  return continueChapter;
}
