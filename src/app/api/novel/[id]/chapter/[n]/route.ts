import { NextRequest, NextResponse } from "next/server";
import { getChapterContent } from "@/lib/novel-store";

// GET: 获取章节内容
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; n: string } }
) {
  try {
    const chapterIndex = parseInt(params.n, 10);
    const content = await getChapterContent(params.id, chapterIndex);
    if (content === null) {
      return NextResponse.json({ error: "章节不存在" }, { status: 404 });
    }
    return NextResponse.json({ index: chapterIndex, content });
  } catch (err) {
    console.error("[chapter] failed", err);
    return NextResponse.json({ error: "获取章节失败" }, { status: 500 });
  }
}
