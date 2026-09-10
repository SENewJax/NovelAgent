import { createOpenAI } from "@ai-sdk/openai";
import fs from "fs";
import path from "path";

/**
 * AI 接入配置 —— 环境变量 + 共享配置文件。
 *
 * 与 novel-data-studio 共用同一套 NOVEL_STUDIO_* 变量名和共享配置文件 novel-studio.env。
 * 优先读取环境变量，其次读取共享配置文件。
 * 设置页面可以编辑配置并写回共享文件，重启后生效。
 */

export interface AIConfig {
  baseUrl: string; // API 地址，如 https://api.openai.com/v1
  model: string; // 模型名，如 gpt-4o
  apiKey: string; // API Key
  // 打分和续写可以用不同模型（省钱）
  scoreModel?: string; // 打分用小模型，如 gpt-4o-mini
}

export interface AppConfig {
  ai: AIConfig;
}

const DEFAULT_CONFIG: AppConfig = {
  ai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    apiKey: "",
    scoreModel: "gpt-4o-mini",
  },
};

const ENV = {
  baseUrl: "NOVEL_STUDIO_BASE_URL",
  model: "NOVEL_STUDIO_MODEL",
  apiKey: "NOVEL_STUDIO_API_KEY",
  scoreModel: "NOVEL_STUDIO_SCORE_MODEL",
} as const;

const read = (name: string) => process.env[name]?.trim() || undefined;

// ──────────────────────────────────────
// 共享配置文件（仓库根的 novel-studio.env）
// ──────────────────────────────────────

const ROOT = path.resolve(process.cwd(), "..");
const SHARED_ENV_FILE = path.join(ROOT, "novel-studio.env");

/** 共享配置文件路径 */
export function sharedEnvPath(): string {
  return SHARED_ENV_FILE;
}

/** 共享配置文件是否存在 */
export function sharedEnvExists(): boolean {
  return fs.existsSync(SHARED_ENV_FILE);
}

/**
 * 从共享配置文件读取设置（不依赖环境变量）
 */
export function readSharedEnv(): Partial<AIConfig> {
  if (!fs.existsSync(SHARED_ENV_FILE)) return {};

  const content = fs.readFileSync(SHARED_ENV_FILE, "utf-8");
  const result: Partial<AIConfig> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();

    switch (key) {
      case ENV.baseUrl:
        result.baseUrl = value;
        break;
      case ENV.model:
        result.model = value;
        break;
      case ENV.apiKey:
        result.apiKey = value;
        break;
      case ENV.scoreModel:
        result.scoreModel = value;
        break;
    }
  }

  return result;
}

/**
 * 把 AI 参数写回共享配置文件。
 *
 * 只覆盖 AI 相关字段，保留文件里其它字段不动。
 */
export function writeSharedEnv(settings: Partial<AIConfig>): void {
  const existing = fs.existsSync(SHARED_ENV_FILE)
    ? fs.readFileSync(SHARED_ENV_FILE, "utf-8")
    : "";

  // 解析已有键值，保持非 AI 字段原样
  const lines = existing.split(/\r?\n/);
  const out: string[] = [];
  const written = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    // 注释或空行原样保留
    if (!trimmed || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      out.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const newValue = pickNewValue(key, settings);
    if (newValue !== undefined) {
      out.push(`${key}=${newValue}`);
      written.add(key);
    } else {
      out.push(line); // 不是 AI 字段，原样保留
    }
  }

  // 文件里不存在的 AI 字段，追加到末尾
  const appendIfMissing = (key: string, value: string | undefined) => {
    if (!written.has(key) && value !== undefined && value !== "") {
      out.push(`${key}=${value}`);
    }
  };
  if (existing === "") {
    // 文件不存在，写完整头部
    out.push("# 共享 AI 配置 —— novel-analyzer 与 novel-data-studio 共用。");
    out.push("# 由设置页面自动写入。");
    out.push("# 改完后要重启两个服务的进程才生效。");
    out.push("");
  }
  appendIfMissing(ENV.baseUrl, settings.baseUrl);
  appendIfMissing(ENV.model, settings.model);
  appendIfMissing(ENV.apiKey, settings.apiKey);
  appendIfMissing(ENV.scoreModel, settings.scoreModel);

  // 确保尾部有换行
  const content = out.join("\n") + (out.length > 0 ? "\n" : "");
  fs.writeFileSync(SHARED_ENV_FILE, content, "utf-8");

  // 更新内存缓存，立即生效
  updateConfigCache(settings);
}

function pickNewValue(
  key: string,
  settings: Partial<AIConfig>,
): string | undefined {
  switch (key) {
    case ENV.baseUrl:
      return settings.baseUrl || undefined;
    case ENV.model:
      return settings.model || undefined;
    case ENV.apiKey:
      return settings.apiKey || undefined;
    case ENV.scoreModel:
      return settings.scoreModel || undefined;
    default:
      return undefined; // 不是 AI 字段，原样保留
  }
}

/**
 * 只认专属前缀的变量名。
 *
 * 不回退到 OPENAI_API_KEY 之类的通用名 —— 开发机上这类变量常为别的工具而存在，
 * 一旦被当作本工具的配置，界面会莫名变成只读且指向错误的服务，排查成本很高。
 */
export function envSettings(): Partial<AIConfig> {
  return {
    ...(read(ENV.baseUrl) ? { baseUrl: read(ENV.baseUrl)! } : {}),
    ...(read(ENV.model) ? { model: read(ENV.model)! } : {}),
    ...(read(ENV.apiKey) ? { apiKey: read(ENV.apiKey)! } : {}),
    ...(read(ENV.scoreModel) ? { scoreModel: read(ENV.scoreModel)! } : {}),
  };
}

/**
 * 哪些字段由环境变量提供。
 *
 * 注意：不再锁定字段，所有字段都可编辑。
 * 环境变量仅作为初始值，用户可以通过设置页面覆盖并保存到共享配置文件。
 */
export function envLockedKeys(): Array<keyof AIConfig> {
  // 不再锁定任何字段，所有字段都可编辑
  return [];
}

/** 获取完整配置信息（用于设置页面） */
export function getFullConfig() {
  const config = getConfig();
  const lockedKeys = envLockedKeys();
  const configured = isAIConfigured();
  const envExists = sharedEnvExists();

  return {
    ai: config.ai,
    lockedKeys,
    configured,
    envExists,
    envPath: sharedEnvPath(),
  };
}

// 内存缓存 - 写入后立即生效
let _configCache: Partial<AIConfig> | null = null;

/**
 * 更新内存缓存（写入共享文件后调用）
 */
export function updateConfigCache(settings: Partial<AIConfig>): void {
  _configCache = { ..._configCache, ...settings };
}

/**
 * 清除内存缓存
 */
export function clearConfigCache(): void {
  _configCache = null;
}

/**
 * 读取配置。优先内存缓存 > 环境变量 > 共享配置文件。
 */
export function getConfig(): AppConfig {
  const envConf = envSettings();
  const fileConf = readSharedEnv();
  // 内存缓存 > 环境变量 > 文件
  return {
    ai: {
      ...DEFAULT_CONFIG.ai,
      ...fileConf,
      ...envConf,
      ...(_configCache || {}),
    },
  };
}

/**
 * 校验 AI 配置是否有效（apiKey + baseUrl + model 均已设置）。
 */
export function isAIConfigured(): boolean {
  const { apiKey, baseUrl, model } = getConfig().ai;
  return !!(apiKey && baseUrl && model);
}

/**
 * 创建 OpenAI 客户端实例（使用当前配置）。
 *
 * getConfig 已非异步，此处保持同步；调用方原有的 `await` 对其是 no-op，无需改动。
 */
export function createAIClient() {
  const config = getConfig();
  return createOpenAI({
    apiKey: config.ai.apiKey,
    baseURL: config.ai.baseUrl,
  });
}
