import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/novel-store";
import { detectAndDecode } from "@/lib/encoding";

// POST: 上传小说文件
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const platformId = formData.get("platformId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "缺少文件" }, { status: 400 });
    }
    if (!platformId) {
      return NextResponse.json({ error: "请选择目标平台" }, { status: 400 });
    }

    // 读取文件为 Buffer 并自动检测编码（支持 UTF-8/GBK/GB2312/GB18030）
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const content = detectAndDecode(buffer);

    const project = await createProject(file.name, content, platformId);

    return NextResponse.json({
      id: project.id,
      name: project.name,
      chapters: project.chapters.length,
      totalWords: project.chapters.reduce((s, c) => s + c.wordCount, 0),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET: 列出所有项目
export async function GET() {
  try {
    const projects = await listProjects();
    return NextResponse.json(projects);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
