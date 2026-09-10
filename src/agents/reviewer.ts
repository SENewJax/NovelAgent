// 审稿 Agent — 根据分类判定执行审稿口诀/反面清单/命门校验

import { safeGenerateObject } from "@/lib/safe-generate";
import { z } from "zod";
import { ReviewResult, CategoryDetection, ScoringContext } from "@/scoring/types";
import { getSkillKnowledge } from "@/skills";
import { createAIClient, getConfig } from "@/lib/config";
import { getPrompt, getRoleWeights } from "@/lib/prompt-registry";
import { withValidation, buildReviewerValidator } from "@/lib/validate-retry";

const reviewIssueSchema = z.object({
  severity: z.enum(["fatal", "warning", "info"]),
  category: z.string(),
  description: z.string(),
  suggestion: z.string().optional().default(""),
});

const reviewSchema = z.preprocess(
  (val) => {
    if (!val || typeof val !== "object") return val;
    const obj = val as Record<string, unknown>;

    // 兼容模型返回扁平结构（issues 缺失，但有 severity/passed 等字段）
    if (!obj.issues && obj.severity && obj.passed !== undefined) {
      const issue: Record<string, unknown> = {
        severity: obj.severity,
        category: obj.category || "通用",
        description: obj.description || "",
        suggestion: obj.suggestion || "",
      };
      return {
        passed: obj.passed,
        issues: [issue],
        mnemonic: obj.mnemonic || "",
        fatal_flaws: obj.fatal_flaws || obj.fatalFlaws || [],
      };
    }

    // 兼容 fatalFlaws (camelCase) → fatal_flaws (snake_case)
    if (obj.fatalFlaws && !obj.fatal_flaws) {
      obj.fatal_flaws = obj.fatalFlaws;
    }

    return val;
  },
  z.object({
    passed: z.boolean(),
    issues: z.array(reviewIssueSchema),
    mnemonic: z.string(),
    fatal_flaws: z.preprocess(
      (val) => {
        if (typeof val === "string") return val ? [val] : [];
        if (Array.isArray(val)) return val;
        return [];
      },
      z.array(z.string())
    ),
  })
);

/**
 * 根据分类判定构建审稿 prompt
 */
async function buildReviewSystemPrompt(
  detection: CategoryDetection,
  platformId?: string
): Promise<string> {
  const knowledge = getSkillKnowledge(detection.gender);

  // 尝试从 Registry 获取模板
  const registryPrompt = await getPrompt("reviewer", {
    genderLabel: detection.gender === "male" ? "男频" : "女频",
    primaryLabel: detection.primaryLabel,
    secondaryCategory: detection.secondaryCategory,
    reasoning: detection.reasoning,
    reviewChecklist: knowledge.reviewChecklist,
  }, {
    gender: detection.gender,
    platform: platformId,
    primaryCategory: detection.primaryCategory,
    secondaryCategory: detection.secondaryCategory,
  });

  if (registryPrompt) return registryPrompt;

  // 回退到硬编码构建
  return `你是一位严格的网文审稿编辑，精通${detection.gender === "male" ? "男频" : "女频"}小说的审稿标准。

当前小说的分类判定结果：
- 性别: ${detection.gender === "male" ? "男频" : "女频"}
- 一级分类: ${detection.primaryLabel}
- 二级分类: ${detection.secondaryCategory}
- 判定理由: ${detection.reasoning}

## 审稿知识库（该性别的完整审稿标准）
${knowledge.reviewChecklist}

## 审稿任务
请根据上述审稿标准，对以下章节进行逐条检查：

### 检查层次
1. **通用检查**：3秒钩子、单集爽点、情绪螺旋、反派质量、冲突聚焦、逻辑自洽
2. **型审稿口诀**：根据型执行对应口诀检查
3. **型级清单**：该型共通的常见问题
4. **赛道反面清单**：该赛道的专属常见问题
5. **命门校验**：该赛道的命门是否被触碰

### 输出要求
- severity 为 "fatal" 表示致命问题（命门级），"warning" 表示警告，"info" 表示建议
- category 为 "型级"、"赛道级" 或 "通用"
- passed: 如果有 fatal 级别问题则为 false
- mnemonic: 当前型对应的审稿口诀（如 "依·渐·越·分"）
- fatal_flaws: 命门命中的具体问题描述

返回严格JSON格式。`;
}

/**
 * 审稿校验：根据型+赛道执行审稿口诀/反面清单/命门校验
 * @param content 章节内容
 * @param detection 分类判定结果
 * @param chapterTitle 章节标题（可选）
 * @param context 额外上下文（可选，如分析结果摘要）
 * @param scoringContext 本次分析生效的评分上下文（可选，用于平台化 prompt 与权重）
 */
export async function reviewChapter(
  content: string,
  detection: CategoryDetection,
  chapterTitle?: string,
  context?: string,
  scoringContext?: ScoringContext
): Promise<ReviewResult> {
  const openai = await createAIClient();
  const config = await getConfig();
  const model = config.ai.scoreModel || config.ai.model;

  const systemPrompt = await buildReviewSystemPrompt(detection, scoringContext?.platformId);

  const contextHint = context ? `\n\n上下文信息：${context}` : "";
  const titleHint = chapterTitle ? `【${chapterTitle}】\n` : "";

  // 审稿员注意力权重 + 输出校验重试。
  // ScoringContext.weights 是打分维度权重，没有按角色的细分，所以角色权重仍从配置包取。
  const reviewerWeights = await getRoleWeights("reviewer", detection.gender);
  const validateReview = buildReviewerValidator(reviewerWeights);

  const { result: object } = await withValidation(
    async (feedback) => {
      const { object } = await safeGenerateObject({
        model: openai(model),
        system: systemPrompt,
        prompt: `请对以下章节进行审稿校验：\n\n${titleHint}${content}${contextHint}${feedback ? `\n\n【校验反馈】${feedback}` : ""}`,
        schema: reviewSchema,
      });
      return object;
    },
    (obj: any) => validateReview(obj),
    1
  );

  const result = object as z.infer<typeof reviewSchema>;

  return {
    passed: result.passed,
    issues: result.issues.map((i: { severity: string; category: string; description: string; suggestion: string }) => ({
      severity: i.severity as "fatal" | "warning" | "info",
      category: i.category,
      description: i.description,
      suggestion: i.suggestion,
    })),
    mnemonic: result.mnemonic,
    fatalFlaws: result.fatal_flaws,
  };
}

/**
 * 审稿校验（简化版）：用于写作后的自检
 */
export async function quickReview(
  content: string,
  detection: CategoryDetection,
  scoringContext?: ScoringContext
): Promise<{ issues: string[]; fatalCount: number }> {
  const result = await reviewChapter(content, detection, undefined, undefined, scoringContext);
  return {
    issues: result.issues
      .filter((i) => i.severity !== "info")
      .map((i) => `[${i.severity === "fatal" ? "致命" : "警告"}] ${i.description} → ${i.suggestion}`),
    fatalCount: result.issues.filter((i) => i.severity === "fatal").length,
  };
}
