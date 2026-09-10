// 输出校验 + 重试
//
// 设计理念：每个角色执行后输出 JSON，系统按该角色的"注意力权重"校验输出，
// 若输出未体现高权重注意力点，则带反馈重试（最多 maxRetry 次）。

import type { DimensionScores } from "@/scoring/types";
import type { RoleWeights } from "@/scoring/attention";

/** 校验结果 */
export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * 带校验重试的执行器。
 * @param produce 产出结果的函数；重试时会收到上一次的校验反馈 feedback
 * @param validate 校验函数，返回 ok/reason
 * @param maxRetry 最大重试次数（默认 1，即最多执行 2 次）
 */
export async function withValidation<T>(
  produce: (feedback?: string) => Promise<T>,
  validate: (out: T) => ValidationResult,
  maxRetry: number = 1
): Promise<{ result: T; attempts: number; lastReason?: string }> {
  let feedback: string | undefined;
  let lastReason: string | undefined;
  let result: T | undefined;

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    result = await produce(feedback);
    const v = validate(result);
    if (v.ok) {
      return { result, attempts: attempt + 1 };
    }
    lastReason = v.reason;
    feedback = `上一次输出未满足注意力权重要求：${v.reason || "未达标"}。请重新输出并重点补足该部分。`;
  }

  return { result: result as T, attempts: maxRetry + 1, lastReason };
}

/**
 * 评分员校验器：权重最高的前 2 个维度必须有非空评语且分数在 1-10 之间。
 * 高权重维度若缺失评语，说明模型未按注意力权重分配精力，需要重试。
 */
export function buildScorerValidator(weights: RoleWeights) {
  return (scores: DimensionScores): ValidationResult => {
    const topDims = Object.entries(weights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([k]) => k);

    const rec = scores as unknown as Record<string, { score?: number; comment?: string }>;
    for (const key of topDims) {
      const dim = rec[key];
      if (!dim || typeof dim.score !== "number" || dim.score < 1 || dim.score > 10) {
        return { ok: false, reason: `高权重维度「${key}」分数缺失或不在 1-10 范围内` };
      }
      if (!dim.comment || dim.comment.trim().length === 0) {
        return { ok: false, reason: `高权重维度「${key}」缺少评语，未体现注意力权重` };
      }
    }
    return { ok: true };
  };
}

/**
 * 审稿员校验器：若「命门」是最高注意力权重，则必须给出明确命门结论
 * （要么 passed=true 表示无命门，要么列出 fatal 问题 / fatal_flaws）。
 */
export function buildReviewerValidator(weights: RoleWeights) {
  return (out: {
    passed: boolean;
    issues: { severity: string }[];
    fatal_flaws?: string[];
    fatalFlaws?: string[];
  }): ValidationResult => {
    const fatalWeight = weights["fatal"] || 0;
    const maxWeight = Math.max(0, ...Object.values(weights));

    if (fatalWeight > 0 && fatalWeight >= maxWeight) {
      const flaws = out.fatal_flaws || out.fatalFlaws || [];
      const hasFatalIssue = (out.issues || []).some((i) => i.severity === "fatal");
      if (typeof out.passed !== "boolean") {
        return { ok: false, reason: "缺少 passed 字段，无法判断命门结论" };
      }
      if (!out.passed && !hasFatalIssue && flaws.length === 0) {
        return { ok: false, reason: "命门为最高注意力权重，但未给出命门结论（passed/issues/fatal_flaws 均为空）" };
      }
    }
    return { ok: true };
  };
}
