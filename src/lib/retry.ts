/**
 * 弹性重试包装器
 *
 * 用于长耗时 AI 调用（分析/改写/续写 Pipeline 中的 generateText/generateObject）。
 * 区分可恢复错误（网络闪烁/超时/5xx/限流）与不可恢复错误（配额耗尽/4xx/参数错误），
 * 仅对可恢复错误做指数退避重试，不可恢复错误立即抛出。
 */

/** 判断错误是否为可恢复的瞬态错误（值得重试） */
export function isRecoverable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // ── 明确不可恢复：配额耗尽、认证失败、参数错误 ──
  // 这些即便重试也不会成功，反而放大额度消耗。其余一律视为可恢复 ——
  // 宁可多拆几批重试一次，也不让一次偶发异常中断整本分析。
  if (lower.includes("insufficient_quota")) return false;
  if (lower.includes("invalid_api_key")) return false;
  if (lower.includes("unauthorized")) return false;
  if (lower.includes("forbidden")) return false;
  if (lower.includes("bad request")) return false;

  // 显式标记 401（认证）与 400（参数错误 / API 拒绝请求）也不可恢复
  if (/\b400\b/.test(lower)) return false;
  if (/\b401\b/.test(lower)) return false;

  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  /** 最大重试次数（不含首次调用），默认 3 */
  maxRetries?: number;
  /** 初始延迟（毫秒），默认 2000 */
  baseDelay?: number;
  /** 最大延迟（毫秒），默认 30000 */
  maxDelay?: number;
  /** 日志标签，用于 console 输出 */
  tag?: string;
}

/**
 * 弹性重试包装器
 *
 * @example
 * ```ts
 * const result = await withRetry(() => generateText({ ... }), {
 *   tag: "scoreChapter",
 * });
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelay = options?.baseDelay ?? 2000;
  const maxDelay = options?.maxDelay ?? 30000;
  const tag = options?.tag ?? "withRetry";

  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);

      if (!isRecoverable(err)) {
        // 不可恢复错误：立即抛出，不浪费配额
        console.error(`[${tag}] 不可恢复错误，终止重试: ${msg}`);
        throw err;
      }

      if (attempt >= maxRetries) {
        // 可恢复但重试次数已耗尽
        console.error(`[${tag}] 可恢复错误但重试 ${maxRetries} 次仍失败: ${msg}`);
        throw err;
      }

      // 指数退避 + 抖动
      const delay = Math.min(
        baseDelay * Math.pow(2, attempt) + Math.random() * 500,
        maxDelay
      );
      console.warn(`[${tag}] 可恢复错误（尝试 ${attempt + 1}/${maxRetries}），${(delay / 1000).toFixed(1)}s 后重试: ${msg}`);
      await sleep(delay);
    }
  }

  throw lastErr;
}
