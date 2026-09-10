import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { createAIClient, getConfig } from "@/lib/config";
import { safeGenerateObject } from "@/lib/safe-generate";
import { z } from "zod";
import { getPrompt } from "@/lib/prompt-registry";

// 结构化摘要 Schema
const outlineSchema = z.object({
  title: z.string().describe("小说标题"),
  genre: z.string().describe("类型/题材"),
  gender: z.enum(["male", "female"]).describe("性别方向：男频(male)或女频(female)").optional(),
  type: z.string().describe("型：成长型/身份型/预知型/实力逆袭型/身份反转型/情感关系型").optional(),
  track: z.string().describe("赛道：逆袭/修仙/玄幻/战神/赘婿/霸总/重生/职场/学霸/医生/穿越修仙/真千金/马甲/虐文言情").optional(),
  worldSetting: z.string().describe("世界观设定摘要"),
  characters: z.array(z.object({
    name: z.string(),
    role: z.string().describe("主角/配角/龙套"),
    description: z.string(),
  })).describe("角色列表"),
  plotOutline: z.string().describe("主线剧情大纲"),
  plotMode: z.string().describe("剧情模式：如升级流/甜宠/悬疑/复仇等"),
  tone: z.string().describe("文风基调"),
  chapterPlan: z.array(z.object({
    title: z.string(),
    summary: z.string(),
  })).describe("3-5章的章节规划"),
});

const CHAT_SYSTEM = `你是一个专业的小说创作助手。你的任务是通过聊天帮助用户整理出一部小说的完整设定。

## 必须首先确认的信息
1. **性别方向**：男频还是女频？这是创作的基础，必须在第一时间确认。
   - 男频：以男主为主，核心驱动=力量/权力/地位，爽感=力量展示×身份碾压×观众震惊
   - 女频：以女主为主，核心驱动=自我价值/尊严/情感独立，爽感=能力认可×尊严回收×价值实现

2. 小说标题和类型
3. 世界观设定（背景、规则）
4. 角色设定（主角、配角、龙套，性格/外貌/动机）
5. 主线剧情大纲
6. 剧情模式（升级流/甜宠/悬疑/复仇/无限流等）
7. 文风基调（轻松/热血/虐心/搞笑等）

## 型和赛道判定
根据用户描述，自动建议型和赛道：
- 男频：成长型（逆袭/修仙/玄幻） | 身份型（战神/赘婿/霸总） | 预知型（重生/穿越）
- 女频：实力逆袭型（职场/学霸/医生） | 身份反转型（穿越修仙/真千金/马甲） | 情感关系型（虐文言情）

## 你的回复风格
- 简短友好，像一个写作伙伴
- 主动追问缺失的关键信息
- 对用户提供的碎片信息进行确认和整理
- 当信息足够时，建议用户"可以开始写了"
- 如果用户还没提供某项信息，自然地引导他们，但不要一次性问太多`;

const EXTRACT_SYSTEM = `你是一个信息提取助手。根据用户和AI的对话历史，提取并整理小说的完整设定。
如果某项信息尚未明确，用"待定"标记。
chapterPlan 规划3-5章，每章有标题和一句话摘要。

重要：根据对话内容判断性别方向（男频/女频）、型和赛道：
- gender: "male" 或 "female"
- type: 型的中文标签（成长型/身份型/预知型/实力逆袭型/身份反转型/情感关系型）
- track: 赛道的中文标签`;

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "缺少 messages" }, { status: 400 });
    }

    const openai = await createAIClient();
    const config = await getConfig();

    // 从 Registry 获取 prompt，回退时使用硬编码
    const chatPrompt = await getPrompt("chat", {}) || CHAT_SYSTEM;

    // AI 回复聊天
    const { text: reply } = await generateText({
      model: openai(config.ai.model),
      system: chatPrompt,
      messages: messages.map((m: any) => ({
        role: m.role,
        content: m.content,
      })),
    });

    // 尝试从对话中提取结构化信息
    let outline = null;
    if (messages.length >= 4) {
      try {
        const conversationText = messages
          .map((m: any) => `${m.role === "user" ? "用户" : "AI"}: ${m.content}`)
          .join("\n");

        const extractPrompt = await getPrompt("extract", {}) || EXTRACT_SYSTEM;

        const { object } = await safeGenerateObject({
          model: openai(config.ai.scoreModel || config.ai.model),
          system: extractPrompt,
          prompt: `请从以下对话中提取小说设定信息：\n\n${conversationText}`,
          schema: outlineSchema,
        });
        outline = object;
      } catch {
        // 提取失败不影响聊天
      }
    }

    return NextResponse.json({ reply, outline });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
