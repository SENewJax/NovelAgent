import { NextRequest } from "next/server";
import { runRewrite } from "@/workflows/rewrite";
import { withSSE } from "@/lib/sse";

// POST: 启动改写（SSE 流式推送进度）
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求体格式错误" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { novelId, chapterIndex, targetDimensions, styleHint, enableDeAI, enableAdRemove, enableStyleAlign } = body;

  if (!novelId || chapterIndex === undefined) {
    return new Response(
      JSON.stringify({ error: "缺少 novelId 或 chapterIndex" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  return withSSE(async (push, close) => {
    const result = await runRewrite(
      novelId,
      chapterIndex,
      { targetDimensions, styleHint, enableDeAI, enableAdRemove, enableStyleAlign },
      (progress) => {
        push("progress", progress);
      }
    );

    push("complete", { result });
    close();
  });
}
