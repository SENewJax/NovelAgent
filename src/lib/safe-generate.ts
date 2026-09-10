import { generateText } from "ai";
import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";

/**
 * 兼容所有模型的 generateObject 替代方案
 *
 * 原因：AI SDK 的 generateObject 内部使用 tool_choice: "required"，
 * 但 Qwen3.7/Claude thinking 模式等模型不支持此参数。
 * 此函数改用 generateText + JSON 解析，兼容所有模型。
 */
export async function safeGenerateObject<T>(opts: {
  model: any;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}): Promise<{ object: T }> {
  const { model, system, prompt, schema, maxTokens } = opts;

  // Keep the prompt contract derived from the same Zod schema that validates the
  // response. This prevents hand-written prompt examples from drifting away
  // from the runtime contract (especially for required fields).
  const schemaDescription = JSON.stringify(zodToJsonSchema(schema, { $refStrategy: "none" }), null, 2);
  const fullPrompt = `${prompt}\n\n【输出结构（必须严格遵守）】\n请根据以下 JSON Schema 输出对象；所有 required 字段都必须出现，数组没有内容时输出 []：\n${schemaDescription}\n\n【重要】请严格按照JSON格式输出，不要包含任何其他文字，只输出JSON对象。`;

  const { text } = await generateText({
    model,
    system,
    prompt: fullPrompt,
    ...(maxTokens ? { maxTokens } : {}),
  });

  // 提取 JSON（兼容模型可能包裹在 ```json ``` 中）
  let jsonStr = text.trim();

  // 去除 markdown 代码块
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  // 尝试找到第一个 { 和最后一个 }
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // JSON 被截断时尝试自动修复
    const repaired = tryRepairJson(jsonStr);
    try {
      parsed = JSON.parse(repaired);
    } catch {
      throw new Error(
        `模型输出无法解析为JSON（可能被 max_tokens 截断）。\n原始输出:\n${text.slice(0, 500)}...`
      );
    }
  }

  // 规范化：模型可能将数组返回为“全数字 key 的对象”，自动转为数组
  parsed = normalizeNumericKeyObjects(parsed);

  // 用 zod 校验
  let result: T;
  try {
    result = schema.parse(parsed);
  } catch (e) {
    console.error("[safeGenerateObject] Zod validation failed.",
      "Parsed type:", Array.isArray(parsed) ? "array" : typeof parsed,
      "Preview:", JSON.stringify(parsed).slice(0, 500));
    throw e;
  }
  return { object: result };
}

/**
 * 尝试修复被截断的 JSON
 *
 * 当模型输出被 max_tokens 截断时，JSON 可能不完整。
 * 此函数通过闭合未闭合的字符串、数组和对象来尝试修复。
 */
function tryRepairJson(jsonStr: string): string {
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") openBraces++;
    else if (ch === "}") openBraces--;
    else if (ch === "[") openBrackets++;
    else if (ch === "]") openBrackets--;
  }

  let repaired = jsonStr;
  // 如果在字符串中间被截断，先闭合字符串
  if (inString) repaired += '"';
  // 闭合未闭合的数组和对象
  for (let i = 0; i < openBrackets; i++) repaired += "]";
  for (let i = 0; i < openBraces; i++) repaired += "}";

  return repaired;
}

/**
 * 规范化：将“全数字 key 的对象”转为数组
 *
 * 某些 AI 模型在输出数组时，会错误地使用对象格式：
 * {"0": {...}, "1": {...}, "2": {...}}
 * 此函数递归地将这类对象转为真正的数组。
 */
function normalizeNumericKeyObjects(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(normalizeNumericKeyObjects);
  }

  const keys = Object.keys(obj as Record<string, unknown>);
  if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
    // 全数字 key 的对象 → 转为数组（按 key 排序）
    return keys
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map(k => normalizeNumericKeyObjects((obj as Record<string, unknown>)[k]));
  }

  // 递归处理嵌套对象
  const result: Record<string, unknown> = {};
  for (const k of keys) {
    result[k] = normalizeNumericKeyObjects((obj as Record<string, unknown>)[k]);
  }
  return result;
}
