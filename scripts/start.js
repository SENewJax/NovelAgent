// 启动脚本：显式解析 --port / -p / PORT，再透传给 next start。
//
// 直接用 `npm run start -- --port=3001` 也能启动（next 原生支持），
// 但 npm 的参数透传要求记住加 `--`，且 `npm run start --port 3001`（不带 --）
// 会被 npm 当成自己的配置吞掉。这里兜住两种情况，PORT 环境变量也一并支持，
// 方便部署平台注入端口。
const { spawn } = require("child_process");

const args = process.argv.slice(2);
let port;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--port" || arg === "-p") {
    port = args[i + 1];
    i++;
  } else if (arg.startsWith("--port=")) {
    port = arg.slice("--port=".length);
  } else if (arg.startsWith("-p=")) {
    port = arg.slice("-p=".length);
  }
}

// 兜底：`npm run start --port 3000` 时 npm 会吞掉 `--port`，只把 `3000` 传给脚本。
// 此时 args=[「3000」]。若未解析到端口、且存在唯一的纯数字参数，就把它当作端口。
if (!port) {
  const numeric = args.filter((a) => /^\d+$/.test(a));
  if (numeric.length === 1) port = numeric[0];
}

if (!port && process.env.PORT) port = process.env.PORT;

const nextArgs = ["start"];
if (port) nextArgs.push("--port", port);

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", ...nextArgs],
  { stdio: "inherit", shell: process.platform === "win32" }
);

child.on("exit", (code) => process.exit(code ?? 0));
