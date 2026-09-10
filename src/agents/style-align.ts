import { generateText } from "ai";
import { StyleProfile } from "@/scoring/types";
import { createAIClient, getConfig } from "@/lib/config";
import { buildStyleConstraintPrompt } from "@/agents/style-profiler";

const STYLE_ALIGN_SYSTEM = `你是一位专业的小说风格统一编辑。你的任务是：将给定的文本润色成与"原作者风格指纹"完全一致的文字，消除"作者换人"的既视感。

修正重点：
1. **句式节奏对齐**：句长分布、段落切分方式向原作者看齐（如原文多短句短段，就把长句拆短）
2. **对话风格对齐**：对话引导词、标点习惯、语气词与原作者一致
3. **叙事腔调对齐**：视角、腔调、心理描写方式与原作者一致
4. **词汇对齐**：剔除原作者不会用的词（文艺腔/书面腔/翻译腔），换用符合原作者词汇习惯的表达
5. **适度融入作者口头禅**：在自然的地方使用作者的标志性表达，但不可刻意堆砌

硬性要求：
- 保持原有剧情、信息量、爽点完全不变
- 不添加新剧情、不删减关键情节
- 只做表达层面的风格统一
- 输出润色后的完整正文，不要输出任何解释`;

/**
 * 风格对齐润色：将生成文本统一为原作者风格
 *
 * 用于续写/改写 Pipeline 的后置步骤，解决"看着看着作者换人"的问题。
 */
export async function alignStyle(
  text: string,
  profile: StyleProfile
): Promise<string> {
  const openai = await createAIClient();
  const config = await getConfig();

  const styleConstraint = buildStyleConstraintPrompt(profile);

  const { text: result } = await generateText({
    model: openai(config.ai.model),
    system: STYLE_ALIGN_SYSTEM + "\n\n" + styleConstraint,
    prompt: `请将以下文本润色为与原作者风格一致的文字，保持剧情不变：\n\n${text}`,
  });

  return result.trim();
}
