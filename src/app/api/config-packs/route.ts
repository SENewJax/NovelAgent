import { NextRequest, NextResponse } from "next/server";
import {
  listPacks,
  createPack,
  ensureDefaultPack,
  PackManifest,
} from "@/lib/prompt-registry";

/**
 * GET /api/config-packs — 列出所有配置包
 */
export async function GET() {
  try {
    // 确保默认包存在（首次运行时自动创建）
    await ensureDefaultPack();
    const packs = await listPacks();
    return NextResponse.json({ packs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/config-packs — 创建新配置包
 * body: { manifest: PackManifest, copyFrom?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { manifest, copyFrom } = await req.json();

    if (!manifest || !manifest.id || !manifest.name) {
      return NextResponse.json(
        { error: "缺少必要字段: manifest.id, manifest.name" },
        { status: 400 }
      );
    }

    const fullManifest: PackManifest = {
      ...manifest,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: manifest.author || "user",
    };

    const pack = await createPack(fullManifest, { copyFrom });

    return NextResponse.json({ success: true, contents: pack });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
