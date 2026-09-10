const fs = require("fs");
const path = require("path");

/**
 * 加载仓库根级的共享 AI 配置（novel-studio.env），注入 process.env。
 *
 * 两个应用（novel-analyzer / novel-data-studio）共用这一份配置：
 * 变量名都是 NOVEL_STUDIO_*，放在仓库根，两个 next.config 都会读它，
 * 因此改一处两边生效。
 *
 * Next 自带的 .env 机制只读本项目目录下的 .env*.local，读不到上位目录的共享文件，
 * 所以在这里手动注入。已存在的环境变量（如进程内 export 或单项目 .env.local）
 * 优先于共享文件，共享文件只补缺省值。
 */
function loadSharedConfig() {
  // 从本文件（novel-analyzer/next.config.js）上溯两层：`..` 为仓库根。
  const root = path.resolve(__dirname, "..");
  const sharedFile = path.join(root, "novel-studio.env");
  const exampleFile = path.join(root, "novel-studio.env.example");

  const source = fs.existsSync(sharedFile) ? sharedFile : exampleFile;
  if (!fs.existsSync(source)) return;

  const lines = fs.readFileSync(source, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // 去除可选的引号包裹
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // 已存在的环境变量优先，共享文件只作缺省补全。
    // Next 加载 .env.local 时会把空值设为 ""，这里排除空串，
    // 避免单项目的空值挡住共享配置。
    if (!process.env[key]) process.env[key] = value;
  }
}

loadSharedConfig();

/** @type {import('next').NextConfig} */
const nextConfig = {};

module.exports = nextConfig;
