import { NextResponse } from "next/server";
import { loadActivePack } from "@/lib/prompt-registry";

/**
 * GET /api/config-packs/active/platforms — 获取当前激活配置包的平台列表
 *
 * 上传页面用此接口动态渲染目标平台选择器，
 * 确保目标平台与导入配置的小说平台一致。
 */
export async function GET() {
  try {
    const contents = await loadActivePack();

    if (!contents) {
      return NextResponse.json({ platforms: [] });
    }

    const platforms = contents.platforms.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      genders: p.genders,
    }));

    return NextResponse.json({ platforms });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
