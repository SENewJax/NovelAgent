import { NextRequest } from "next/server";
import { loadProject } from "@/lib/novel-store";
import { runAnalysis } from "@/workflows/analysis";
import { withSSE } from "@/lib/sse";

// POST: 启动分析（SSE 流式推送进度）
export async function POST(req: NextRequest) {
  let novelId: string | undefined;
  let resume: boolean | undefined;

  try {
    const body = await req.json();
    novelId = body.novelId;
    resume = body.resume;
  } catch {
    return new Response(JSON.stringify({ error: "请求体格式错误" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!novelId) {
    return new Response(JSON.stringify({ error: "缺少 novelId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const project = await loadProject(novelId);
  if (!project) {
    return new Response(JSON.stringify({ error: "项目不存在" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return withSSE(async (push, close) => {
    const result = await runAnalysis(
      novelId,
      project.chapters,
      (progress) => {
        push("progress", progress);
      },
      { resume: !!resume }
    );

    push("complete", { result });
    close();
  });
}
