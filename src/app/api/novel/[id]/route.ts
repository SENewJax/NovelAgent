import { NextRequest, NextResponse } from "next/server";
import { loadProject, clearAnalysis, loadAnalysisDraft } from "@/lib/novel-store";

// GET: 获取项目详情（含草稿进度信息）
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const project = await loadProject(params.id);
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    // 检查是否有分析草稿（断点续跑用）。草稿存在也一并返回已产出的分析结果
    // （partial 情况：部分章失败时分析已产出报告但草稿保留待补分）。
    const draft = await loadAnalysisDraft(params.id);
    if (draft) {
      return NextResponse.json({
        ...project,
        analysisDraft: {
          hasGlobal: !!draft.globalAnalysis,
          hasCategoryDetection: !!draft.categoryDetection,
          summaryCount: draft.chapterSummaries?.length || 0,
          scoredCount: draft.chapterScores.length,
          totalChapters: project.chapters.length,
          startedAt: draft.startedAt,
          updatedAt: draft.updatedAt,
        },
      });
    }

    return NextResponse.json(project);
  } catch (err) {
    console.error("[novel] GET failed", err);
    return NextResponse.json({ error: "获取项目失败" }, { status: 500 });
  }
}

// DELETE: 清除分析结果（用于重新分析，保留原文与章节）
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await clearAnalysis(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[novel] DELETE failed", err);
    return NextResponse.json({ error: "清除分析失败" }, { status: 500 });
  }
}
