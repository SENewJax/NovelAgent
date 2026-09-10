/**
 * SSE (Server-Sent Events) 流工具
 *
 * 为长耗时操作（分析/改写/续写/生成）提供实时进度推送。
 * 替代旧的文件轮询方案（progress.json + setInterval）。
 */

export interface SSEController {
  /** 推送一个 SSE 事件 */
  push: (event: string, data: unknown) => void;
  /** 关闭 SSE 流 */
  close: () => void;
  /** 返回 Next.js Response 对象 */
  response: Response;
}

/**
 * 创建 SSE 流
 *
 * @example
 * ```ts
 * const sse = createSSEStream();
 *
 * // 在异步工作中推送进度
 * sse.push("progress", { phase: "scoring", message: "正在打分...", current: 3, total: 16 });
 *
 * // 完成时推送结果并关闭
 * sse.push("complete", { result: analysisResult });
 * sse.close();
 *
 * return sse.response;
 * ```
 */
export function createSSEStream(): SSEController {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController;
  let closed = false;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
  });

  const push = (event: string, data: unknown) => {
    if (closed) return;
    try {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(encoder.encode(payload));
    } catch {
      // 客户端断开时忽略错误
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      controller.close();
    } catch {
      // 已关闭
    }
  };

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // 禁用 nginx 缓冲
    },
  });

  return { push, close, response };
}

/**
 * 将异步工作流包装为 SSE 响应
 *
 * @param handler - 接收 push/close 回调的异步函数
 * @returns SSE Response
 *
 * @example
 * ```ts
 * export async function POST(req: NextRequest) {
 *   const body = await req.json();
 *   return withSSE(async (push, close) => {
 *     push("progress", { message: "开始..." });
 *     const result = await runWorkflow(body.id, (msg) => push("progress", { message: msg }));
 *     push("complete", { result });
 *     close();
 *   });
 * }
 * ```
 */
export function withSSE(
  handler: (
    push: SSEController["push"],
    close: SSEController["close"]
  ) => Promise<void>
  , options?: { taskId?: string }
): Response {
  const sse = createSSEStream();
  const taskId = options?.taskId;

  // 在后台执行工作流（不阻塞 response 返回）
  handler((event, data) => { sse.push(event, data); if (taskId) import("@/lib/task-store").then(({ appendTaskProgress }) => appendTaskProgress(taskId, { event, data })); }, sse.close).then(() => { if (taskId) return import("@/lib/task-store").then(({ updateTask }) => updateTask(taskId, { status: "completed" })); }).catch((err) => {
    console.error(`[SSE] workflow error: ${err.message || err}`);
    if (err.stack) console.error(err.stack);
    const publicMessage = sanitizeErrorMessage(err);
    sse.push("error", { message: publicMessage });
    if (taskId) import("@/lib/task-store").then(({ updateTask }) => updateTask(taskId, { status: "failed", error: publicMessage }));
    sse.close();
  });

  return sse.response;
}

/** 只向客户端暴露可操作的信息，过滤密钥、URL、响应正文和堆栈。 */
export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || "");
  const lower = raw.toLowerCase();
  if (raw.includes("批评分失败") || raw.includes("章评分失败") || raw.startsWith("评分缺失：") || raw.startsWith("模型未返回任何评分")) {
    return raw.replace(/https?:\/\/\S+/gi, "[服务地址]").slice(0, 500);
  }
  if (lower.includes("quota") || lower.includes("insufficient_quota")) return "模型额度不足，分析进度已保存，请补充额度后继续分析";
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) return "模型请求过于频繁，分析进度已保存，请稍后继续分析";
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) return "模型请求超时，分析进度已保存，请继续分析";
  if (lower.includes("unauthorized") || lower.includes("invalid_api_key") || lower.includes("401")) return "模型服务认证失败，请检查 API 配置后继续分析";
  if (lower.includes("json") || lower.includes("validation") || lower.includes("评分缺失")) return "模型返回格式异常或评分不完整，失败章节已记录，请继续分析";
  return "分析服务发生异常，进度已保存。请查看服务端日志后继续分析";
}
