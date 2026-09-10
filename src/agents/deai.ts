import { generateText } from "ai";
import { CategoryDetection } from "@/scoring/types";
import { createAIClient, getConfig } from "@/lib/config";
import { getPrompt } from "@/lib/prompt-registry";

const DEAI_SYSTEM = `你是一个专业的小说润色编辑，擅长消除AI生成文本的"机器味"。

你需要识别并修正以下AI常见痕迹：

1. **过度使用排比/对称句式** → 打破节奏，长短句交错
2. **千篇一律的描写套路** → 用更具体、独特的细节替代
3. **过于工整的段落结构** → 让叙述更自然随意
4. **空洞的形容词堆砌** → 用动词和具体场景替代
5. **情感表达过于直白** → 用行为和细节暗示情感
6. **转折词过多**（然而/不过/但是）→ 减少或换用更自然的衔接
7. **总结性结尾太多** → 让场景自然收束
8. **过于均匀的段落长度** → 有长有短，模拟人类写作节奏

要求：
- 保持原文的核心剧情和信息不变
- 不添加新剧情，只做表达层面的优化
- 让文字读起来更像是人写的
- 保持作者原有的风格基调`;

/**
 * 去AI味润色
 */
export async function removeAIFlavor(
  text: string,
  styleHint?: string,
  detection?: CategoryDetection
): Promise<string> {
  const openai = await createAIClient();
  const config = await getConfig();

  // 根据性别注入台词风格方向，确保去AI味后仍保持赛道风格
  let trackHint = "";
  if (detection?.gender === "male") {
    trackHint = `\n\n【台词风格保持】男频台词应保持：短、狠、炸的风格（身份/配不配/废物/跪），不要将台词润色成文艺腔。`;
  } else if (detection?.gender === "female") {
    trackHint = `\n\n【台词风格保持】女频台词应保持：清醒、有力、带情绪的风格（自我/欠我的/清醒/人生），不要将台词润色成空洞抒情。`;
  }

  const extraHint = styleHint
    ? `\n\n风格要求：${styleHint}`
    : "";

  // 从 Registry 获取 prompt，回退时使用硬编码 DEAI_SYSTEM
  const registryPrompt = await getPrompt("deai", { trackHint: trackHint || undefined });
  const basePrompt = registryPrompt || DEAI_SYSTEM;

  const { text: result } = await generateText({
    model: openai(config.ai.model),
    system: basePrompt + extraHint + trackHint,
    prompt: `请对以下文本进行去AI味润色，保持核心内容不变，只优化表达：\n\n${text}`,
  });

  return result.trim();
}
