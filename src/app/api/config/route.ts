import { NextRequest, NextResponse } from "next/server";
import {
  getConfig,
  isAIConfigured,
  envLockedKeys,
  writeSharedEnv,
  sharedEnvExists,
  readSharedEnv,
} from "@/lib/config";

// GET: 获取当前配置（隐藏 apiKey 中间部分）
export async function GET() {
  try {
    const config = getConfig();
    const configured = isAIConfigured();
    const lockedKeys = envLockedKeys();
    const envExists = sharedEnvExists();

    // 隐藏 API Key 中间部分
    const maskedKey = config.ai.apiKey
      ? config.ai.apiKey.slice(0, 7) + "****" + config.ai.apiKey.slice(-4)
      : "";

    return NextResponse.json({
      ai: {
        baseUrl: config.ai.baseUrl,
        model: config.ai.model,
        apiKey: maskedKey,
        scoreModel: config.ai.scoreModel || "",
      },
      lockedKeys,
      configured,
      envExists,
      envPath: "novel-studio.env",
    });
  } catch (err) {
    console.error("[config] GET failed", err);
    return NextResponse.json({ error: "读取配置失败" }, { status: 500 });
  }
}

// POST: 保存配置到共享配置文件
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { baseUrl, model, apiKey, scoreModel } = body;

    // 验证必填字段
    if (!baseUrl || !model || !apiKey) {
      return NextResponse.json(
        { error: "接口地址、模型名称、密钥为必填项" },
        { status: 400 }
      );
    }

    // 读取现有配置（保留非 AI 字段）
    const existing = readSharedEnv();

    // 如果 apiKey 是掩码格式，保留原值
    const actualApiKey =
      apiKey.includes("****") ? existing.apiKey || apiKey : apiKey;

    // 写入共享配置文件
    writeSharedEnv({
      baseUrl,
      model,
      apiKey: actualApiKey,
      scoreModel: scoreModel || undefined,
    });

    return NextResponse.json({
      success: true,
      message: "配置已保存并立即生效",
    });
  } catch (err: any) {
    console.error("[config] POST failed", err);
    return NextResponse.json(
      { error: err.message || "保存配置失败" },
      { status: 500 }
    );
  }
}
