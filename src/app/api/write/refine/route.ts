import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { createAIClient, getConfig } from "@/lib/config";
import { getSkillKnowledge, getTypeLabel, getTrackLabel } from "@/skills";
import { Gender } from "@/scoring/types";
import { getPrompt } from "@/lib/prompt-registry";

const REFINE_SYSTEM = `你是一个专业的小说编辑。用户会给你一段章节正文和修改要求，请按要求修改这段文字。

要求：
- 保持原文的核心剧情不变
- 只修改用户指出的部分
- 保持前后文连贯
- 输出完整的修改后章节（不要省略未修改部分）`;

export async function POST(req: NextRequest) {
  try {
    const { chapterContent, chapterTitle, feedback, outline, prevChapterEnd } = await req.json();

    if (!chapterContent || !feedback) {
      return NextResponse.json({ error: "缺少章节内容或修改要求" }, { status: 400 });
    }

    const openai = await createAIClient();
    const config = await getConfig();

    // 构建赛道约束
    let trackConstraint = "";
    if (outline?.gender && outline?.type && outline?.track) {
      const gender = outline.gender as Gender;
      const knowledge = getSkillKnowledge(gender);
      const genderLabel = gender === "male" ? "男频" : "女频";
      const typeLabel = getTypeLabel(outline.type) || outline.type;
      const trackLabel = getTrackLabel(outline.track) || outline.track;

      trackConstraint = `
【赛道一致性约束】
当前赛道: ${trackLabel}（${genderLabel}/${typeLabel}）
微调时必须保持赛道一致性：
- 禁止混入其他赛道的价值观
- 如果用户的修改要求与赛道价值观冲突，请在修改时尽量平衡，保持赛道特色
- 台词风格: ${gender === "male" ? "短、狠、炸" : "清醒、有力、带情绪"}
`;
    }

    const contextInfo = outline
      ? `\n小说标题：${outline.title || "未命名"}\n类型：${outline.genre}\n文风：${outline.tone}`
      : "";

    const basePrompt = await getPrompt("refine", { trackConstraint: trackConstraint || undefined });
    const systemPrompt = (basePrompt || REFINE_SYSTEM) + trackConstraint;

    const { text } = await generateText({
      model: openai(config.ai.model),
      system: systemPrompt,
      prompt: `## 当前章节：${chapterTitle || "未命名"}
${contextInfo}
${prevChapterEnd ? `\n上一章结尾：${prevChapterEnd}` : ""}

## 原文
${chapterContent}

## 修改要求
${feedback}

请输出修改后的完整章节正文。`,
    });

    return NextResponse.json({ success: true, content: text.trim() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
