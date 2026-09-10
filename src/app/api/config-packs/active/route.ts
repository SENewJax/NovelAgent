import { NextRequest, NextResponse } from "next/server";
import {
  getActivePackState,
  setActivePackId,
  loadActivePack,
  rollbackActivePack,
} from "@/lib/prompt-registry";

/**
 * GET /api/config-packs/active — 获取当前激活的配置包
 */
export async function GET() {
  try {
    const { packId, previousPackId } = await getActivePackState();
    const contents = await loadActivePack();
    return NextResponse.json({ activePackId: packId, previousPackId, contents });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}


/** POST /api/config-packs/active — 回退到上一个激活包 */
export async function POST() {
  try {
    const packId = await rollbackActivePack();
    return NextResponse.json({ success: true, activePackId: packId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

/**
 * PUT /api/config-packs/active — 切换激活的配置包
 * body: { packId: string }
 */
export async function PUT(req: NextRequest) {
  try {
    const { packId } = await req.json();

    if (!packId) {
      return NextResponse.json({ error: "缺少 packId" }, { status: 400 });
    }

    await setActivePackId(packId);

    return NextResponse.json({ success: true, activePackId: packId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
