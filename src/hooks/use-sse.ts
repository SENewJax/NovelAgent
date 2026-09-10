import { useRef, useCallback, useState } from "react";

export interface SSEEvent {
  event: string;
  data: any;
}

export interface UseSSEResult {
  /** 发送 POST 请求并开始接收 SSE 流 */
  start: (url: string, body: Record<string, unknown>) => void;
  /** 取消当前 SSE 连接 */
  cancel: () => void;
  /** 是否正在接收 */
  streaming: boolean;
  /** 最近一条 SSE 事件 */
  lastEvent: SSEEvent | null;
  /** 是否发生错误 */
  error: string | null;
  /** 流是否已结束 */
  done: boolean;
}

/**
 * 前端 SSE 消费 Hook（POST 请求）
 *
 * @param onEvent - 每收到一条 SSE 事件时调用
 * @param onComplete - 流结束时调用（收到 "complete" 或 "error" 事件）
 *
 * @example
 * ```tsx
 * const { start, streaming, lastEvent } = useSSE(
 *   (event) => {
 *     if (event.event === "progress") setProgress(event.data);
 *   },
 *   (event) => {
 *     if (event.event === "complete") setResult(event.data.result);
 *   }
 * );
 *
 * const handleClick = () => {
 *   start("/api/analysis", { novelId: id });
 * };
 * ```
 */
export function useSSE(
  onEvent?: (event: SSEEvent) => void,
  onComplete?: (event: SSEEvent) => void
): UseSSEResult {
  const [streaming, setStreaming] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStreaming(false);
  }, []);

  const start = useCallback(
    async (url: string, body: Record<string, unknown>) => {
      // 取消上一次连接
      cancel();
      setError(null);
      setDone(false);
      setLastEvent(null);
      setStreaming(true);

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: abort.signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || `HTTP ${res.status}`);
        }

        if (!res.body) {
          throw new Error("响应体为空");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done: readerDone, value } = await reader.read();
          if (readerDone) break;

          buffer += decoder.decode(value, { stream: true });

          // 解析 SSE 事件（以双换行分隔）
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || ""; // 最后一段可能不完整，留到下次

          for (const part of parts) {
            if (!part.trim()) continue;
            const event = parseSSEPart(part);
            if (event) {
              setLastEvent(event);
              onEvent?.(event);

              if (event.event === "complete" || event.event === "error") {
                if (event.event === "error") {
                  setError(event.data?.message || "未知错误");
                }
                setDone(true);
                setStreaming(false);
                onComplete?.(event);
                return;
              }
            }
          }
        }

        // 流自然结束（未收到 complete/error）
        setDone(true);
        setStreaming(false);
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setError(err.message || "连接失败");
        setStreaming(false);
        setDone(true);
      }
    },
    [cancel, onEvent, onComplete]
  );

  return { start, cancel, streaming, lastEvent, error, done };
}

/**
 * 解析单个 SSE 数据块
 * 格式: event: xxx\ndata: {...}
 */
function parseSSEPart(part: string): SSEEvent | null {
  let event = "message";
  let data = "";

  for (const line of part.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data += line.slice(5).trim();
    }
  }

  if (!data) return null;

  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return { event, data };
  }
}
