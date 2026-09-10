import { NextRequest, NextResponse } from "next/server";
import {
  loadPackContents,
  updatePack,
  deletePack,
} from "@/lib/prompt-registry";

/**
 * GET /api/config-packs/[id] — 获取指定配置包内容（2.0 形状）
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const contents = await loadPackContents(params.id);
    if (!contents) {
      return NextResponse.json({ error: "配置包不存在或不符合 2.0 协议" }, { status: 404 });
    }
    return NextResponse.json({ contents });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PUT /api/config-packs/[id] — 更新配置包
 * body: { manifest?, contents? }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const updates = await req.json();
    const pack = await updatePack(params.id, updates);
    return NextResponse.json({ success: true, contents: pack });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/config-packs/[id] — 删除配置包
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await deletePack(params.id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
