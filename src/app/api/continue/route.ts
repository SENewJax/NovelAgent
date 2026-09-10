import { NextRequest, NextResponse } from "next/server";
import { generatePlan, generateChapter } from "@/workflows/continue";
import { withSSE } from "@/lib/sse";

// POST: 续写（Step 1: 规划 JSON / Step 2: 生成 SSE）
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

  const { novelId, afterChapter, step, plan, enableDeAI, enableAdRemove, enableStyleAlign, styleHint } = body;

  if (!novelId || afterChapter === undefined) {
    return new Response(
      JSON.stringify({ error: "缺少 novelId 或 afterChapter" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Step 1: 生成规划（快速操作，保持 JSON）
  if (step === "plan" || !step) {
    try {
      const result = await generatePlan(novelId, afterChapter);
      return NextResponse.json(result);
    } catch (err) {
      console.error("[continue] planning failed", err);
      return NextResponse.json({ error: "续写规划失败，请稍后重试" }, { status: 500 });
    }
  }

  // Step 2: 确认规划，生成正文（SSE 流式推送）
  if (step === "generate" && plan) {
    return withSSE(async (push, close) => {
      const result = await generateChapter(
        novelId,
        plan,
        afterChapter,
        { enableDeAI, enableAdRemove, enableStyleAlign, styleHint },
        (progress) => {
          push("progress", progress);
        }
      );

      push("complete", { result });
      close();
    });
  }

  return new Response(
    JSON.stringify({ error: "无效的 step 参数" }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
}
