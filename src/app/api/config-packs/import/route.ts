import { NextRequest, NextResponse } from "next/server";
import { importPackArchive } from "@/lib/prompt-registry";

export const runtime = "nodejs";

/** POST /api/config-packs/import — 导入并安装配置包 ZIP */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少配置包 ZIP 文件" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json({ error: "只支持 ZIP 格式配置包" }, { status: 400 });
    }

    const pack = await importPackArchive(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ success: true, contents: pack });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
