# Novel Analyzer

AI 驱动的网文分析工具。上传小说文本，自动进行类型判定、多维度评分、内容分析，并支持基于评分结果的改写与续写。

## 环境要求

- **Node.js >= 22.0.0**
- 一个兼容 OpenAI API 格式的大模型服务（OpenAI、DeepSeek、Moonshot、本地 Ollama 等均可）

## 快速开始

### 1. 安装依赖

```bash
cd novel-analyzer
npm install
```

### 2. 配置 AI 参数

在项目**根目录**（`NAgentFramework/`）下创建 `novel-studio.env` 文件：

```env
NOVEL_STUDIO_BASE_URL=https://api.openai.com/v1
NOVEL_STUDIO_MODEL=gpt-4o
NOVEL_STUDIO_API_KEY=sk-your-api-key-here
NOVEL_STUDIO_SCORE_MODEL=gpt-4o-mini
```

> `novel-analyzer` 和 `novel-data-studio` 共享此配置文件，只需维护一份。

**各变量说明：**

| 变量 | 说明 | 示例 |
|---|---|---|
| `NOVEL_STUDIO_BASE_URL` | API 端点地址 | `https://api.openai.com/v1` |
| `NOVEL_STUDIO_MODEL` | 主模型（分析、写作） | `gpt-4o` / `deepseek-chat` |
| `NOVEL_STUDIO_API_KEY` | API Key | `sk-...` |
| `NOVEL_STUDIO_SCORE_MODEL` | 评分模型（可选，更便宜） | `gpt-4o-mini` |

**支持的 API 端点示例：**

| 服务商 | BASE_URL | MODEL |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-128k` |
| Ollama (本地) | `http://localhost:11434/v1` | `qwen2.5:14b` |

> 任何兼容 OpenAI API 格式的服务均可使用。

### 3. 启动

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start
```

浏览器打开 `http://localhost:3000`。

### 4. 导入配置包

启动后需要导入一个**配置包**（Config Pack），它定义了平台、分类、权重和提示词。

1. 打开 **设置页面**（`/settings`）
2. 在「配置包管理」区域点击 **导入** 按钮
3. 选择 `.zip` 格式的配置包文件上传
4. 导入后自动成为激活配置包

> 配置包由 `novel-data-studio` 生成，格式版本为 2.0。

也可以在设置页面在线编辑配置包：修改平台权重、分类定义、提示词等。

## 使用流程

```
上传小说 → 选择目标平台 → 自动分析 → 查看评分 → 改写/续写
```

1. **上传**：首页拖拽或选择 `.txt` 文件，从配置包平台中选择目标平台
2. **分析**：自动进行类型判定 → 章节摘要 → 多维度评分 → 内容分析 → 结果复核
3. **改写**：针对薄弱维度对章节进行 AI 改写，支持多次迭代
4. **续写**：基于前文风格和评分标准生成后续章节

## 项目结构

```
src/
├── agents/           # AI Agent（评分、分析、改写、续写等）
├── app/
│   ├── api/          # API 路由
│   ├── analysis/     # 分析页面
│   └── settings/     # 设置页面
├── lib/
│   ├── config.ts          # AI 配置读取
│   ├── prompt-registry.ts # 配置包管理
│   ├── pack-resolver.ts   # 权重解析（三层继承）
│   └── novel-store.ts     # 项目数据存储
├── scoring/          # 评分计算
└── workflows/        # 分析/改写/续写工作流
.novel/               # 运行时数据（自动生成，已 gitignore）
├── config-packs/     # 配置包存储
└── <project-id>/     # 各小说项目数据
```

## API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/upload` | 上传小说文件 |
| `GET` | `/api/upload` | 列出所有项目 |
| `DELETE` | `/api/novel/[id]` | 清除分析结果 |
| `GET` | `/api/config-packs` | 列出配置包 |
| `POST` | `/api/config-packs/import` | 导入配置包（ZIP） |
| `GET` | `/api/config-packs/active` | 获取激活配置包 |
| `PUT` | `/api/config-packs/active` | 切换激活配置包 |
| `GET` | `/api/config-packs/active/platforms` | 获取平台列表 |
| `GET/PUT/DELETE` | `/api/config-packs/[id]` | 配置包 CRUD |
| `GET/POST` | `/api/config` | AI 配置读写 |

## 配置包协议 2.0

配置包是一个包含 6 个 JSON 文件的 ZIP 包：

| 文件 | 说明 |
|---|---|
| `manifest.json` | 元数据（id、名称、版本） |
| `dimensions.json` | 五个 pipeline 的评分维度定义 |
| `platforms.json` | 平台定义（含男/女频权重和提示词） |
| `categories.json` | 分类级权重覆盖 |
| `taxonomy.json` | 男/女频分类树 |
| `defaults.json` | 平台级兜底权重 |

**权重解析优先级**：分类覆盖 > 平台基准 > 频道兜底 > 等权回退
