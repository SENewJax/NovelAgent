import { NextRequest } from "next/server";
import { generateText } from "ai";
import { createAIClient, getConfig } from "@/lib/config";
import { withSSE } from "@/lib/sse";
import { getSkillKnowledge, getTypeLabel, getTrackLabel } from "@/skills";
import { Gender } from "@/scoring/types";
import { getPrompt } from "@/lib/prompt-registry";

const WRITER_SYSTEM = `你是一个专业的网络小说作者。根据给定的设定和大纲，写出高质量的小说章节。

要求：
- 每章2000-3000字
- 开篇要有吸引力（黄金三章原则）
- 对话自然生动
- 描写有画面感
- 节奏把控好，有爽点有伏笔
- 章末留钩子

输出格式：直接输出正文，不要标题前缀。`;

export async function POST(req: NextRequest) {
  let outline: any;
  let projectId: string | undefined;

  try {
    const body = await req.json();
    outline = body.outline;
    projectId = body.projectId;
  } catch {
    return new Response(JSON.stringify({ error: "请求体格式错误" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!outline) {
    return new Response(JSON.stringify({ error: "缺少 outline" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const chapterPlan = outline.chapterPlan || [];
  if (chapterPlan.length === 0) {
    return new Response(JSON.stringify({ error: "章节规划为空，请先完善设定" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return withSSE(async (push, close) => {
    const openai = await createAIClient();
    const config = await getConfig();
    const chapters: { title: string; content: string }[] = [];

    // 必须确定性别方向
    const gender = outline.gender as Gender | undefined;
    const typeValue = outline.type as string | undefined;
    const trackValue = outline.track as string | undefined;

    if (!gender) {
      push("error", { message: "请先选择性别方向（男频/女频）再开始写作" });
      close();
      return;
    }

    // 构建赛道约束 prompt（沿用写作时的型/赛道选择）
    let trackConstraint = "";
    if (gender && typeValue && trackValue) {
      const knowledge = getSkillKnowledge(gender);
      const genderLabel = gender === "male" ? "男频" : "女频";
      const typeLabel = getTypeLabel(typeValue) || typeValue;
      const trackLabel = getTrackLabel(trackValue) || trackValue;
      trackConstraint = `
【赛道约束】
当前性别: ${genderLabel}
当前型: ${typeLabel}
当前赛道: ${trackLabel}

## 爽点设计参考
${knowledge.satisfaction}

## 结构框架参考
${knowledge.structure}

【反套壳禁令】
- 禁止混用其他赛道的价值观和套路
- 禁止将A赛道的元素机械套用到B赛道
- 例如：修仙赛道禁止出现"职场KPI"式都市逻辑；职场赛道禁止出现"金手指升级"式玄幻逻辑
- 所有剧情必须符合当前赛道的核心爽感来源和节奏铁律

## 台词风格
${gender === "male" ? "台词方向：短、狠、炸（身份/配不配/废物/跪）" : "台词方向：清醒、有力、带情绪（自我/欠我的/清醒/人生）"}
`;
    }

    const pid = projectId || "write-" + Date.now();

    for (let i = 0; i < chapterPlan.length; i++) {
      const ch = chapterPlan[i];

      push("progress", {
        phase: "writing",
        message: `✍️ 正在写第 ${i + 1}/${chapterPlan.length} 章「${ch.title}」...`,
        current: i + 1,
        total: chapterPlan.length,
      });

      const contextPrompt = `## 小说设定
标题：${outline.title || "未命名"}
类型：${outline.genre || "未定"}
世界观：${outline.worldSetting || "未定"}
角色：${(outline.characters || []).map((c: any) => `${c.name}(${c.role}): ${c.description}`).join("; ")}
剧情大纲：${outline.plotOutline || "未定"}
剧情模式：${outline.plotMode || "未定"}
文风：${outline.tone || "未定"}

## 当前章节
第${i + 1}章：${ch.title}
章节摘要：${ch.summary}
${i > 0 ? `\n前情提要（上一章结尾）：${chapters[i - 1]?.content?.slice(-300) || ""}` : ""}

请写出第${i + 1}章的完整正文（2000-3000字）。`;

      const basePrompt = await getPrompt("generate", { trackConstraint: trackConstraint || undefined });
      const systemPrompt = (basePrompt || WRITER_SYSTEM) + trackConstraint;

      const { text } = await generateText({
        model: openai(config.ai.model),
        system: systemPrompt,
        prompt: contextPrompt,
      });

      chapters.push({ title: ch.title, content: text.trim() });
    }

    push("complete", { projectId: pid, chapters, outline });
    close();
  });
}
