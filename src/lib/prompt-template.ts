/**
 * 轻量模板引擎
 * 支持:
 * - {{variable}} -- 简单变量替换
 * - {{#if variable}}...{{/if}} -- 条件渲染
 * - {{#each array}}...{{/each}} -- 数组遍历
 */

/**
 * 渲染模板字符串，替换变量、条件块和循环块
 */
export function renderTemplate(
  template: string,
  context: Record<string, any>
): string {
  let result = template;

  // 1. 处理 {{#each array}}...{{/each}} 块
  result = processEachBlocks(result, context);

  // 2. 处理 {{#if variable}}...{{/if}} 块（支持嵌套）
  result = processIfBlocks(result, context);

  // 3. 处理简单变量替换 {{variable}}
  result = processVariables(result, context);

  return result;
}

/**
 * 处理 {{#each arrayName}}...{{/each}} 块
 * 在循环体内，{{propertyName}} 引用数组元素的属性
 * 也支持 {{this}} 引用元素本身
 */
function processEachBlocks(template: string, context: Record<string, any>): string {
  const eachRegex = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
  let result = template;
  let match: RegExpExecArray | null;

  // 循环处理直到没有更多 each 块
  while ((match = eachRegex.exec(result)) !== null) {
    const arrayName = match[1];
    const blockContent = match[2];
    const fullMatch = match[0];

    const array = context[arrayName];
    let replacement = "";

    if (Array.isArray(array) && array.length > 0) {
      for (let i = 0; i < array.length; i++) {
        const item = array[i];
        let itemContent = blockContent;

        if (typeof item === "object" && item !== null) {
          // 替换对象属性 {{propName}}
          for (const [key, value] of Object.entries(item)) {
            const propRegex = new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, "g");
            itemContent = itemContent.replace(propRegex, String(value ?? ""));
          }
        } else {
          // 替换 {{this}}
          itemContent = itemContent.replace(/\{\{this\}\}/g, String(item ?? ""));
        }

        // 替换 {{@index}}
        itemContent = itemContent.replace(/\{\{@index\}\}/g, String(i));

        replacement += itemContent;
      }
    }

    result = result.replace(fullMatch, replacement);
    // 重置 lastIndex 因为字符串已改变
    eachRegex.lastIndex = 0;
  }

  return result;
}

/**
 * 处理 {{#if variable}}...{{else}}...{{/if}} 块
 * 支持嵌套
 */
function processIfBlocks(template: string, context: Record<string, any>): string {
  // 从最内层开始处理，逐步向外
  let result = template;
  let prevResult = "";

  // 循环处理直到没有更多 if 块（处理嵌套）
  while (prevResult !== result) {
    prevResult = result;
    // 匹配最内层的 if 块（内部不再包含 if 块）
    const ifRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
    let match: RegExpExecArray | null;

    while ((match = ifRegex.exec(result)) !== null) {
      const varName = match[1];
      const blockContent = match[2];
      const fullMatch = match[0];

      // 检查是否有 {{else}}
      let trueContent = blockContent;
      let falseContent = "";

      // 只在最内层匹配 else（不含嵌套的 if/else）
      const elseIndex = findTopLevelElse(blockContent);
      if (elseIndex !== -1) {
        trueContent = blockContent.slice(0, elseIndex);
        falseContent = blockContent.slice(elseIndex + "{{else}}".length);
      }

      const value = context[varName];
      const isTruthy = !!value && (Array.isArray(value) ? value.length > 0 : true);
      const replacement = isTruthy ? trueContent : falseContent;

      result = result.replace(fullMatch, replacement);
      ifRegex.lastIndex = 0;
    }
  }

  return result;
}

/**
 * 在块内容中找到顶层 {{else}} 的位置（不匹配嵌套 if 中的 else）
 */
function findTopLevelElse(content: string): number {
  let depth = 0;
  let i = 0;

  while (i < content.length) {
    if (content.slice(i).startsWith("{{#if ")) {
      depth++;
      i += 6;
    } else if (content.slice(i).startsWith("{{/if}}")) {
      depth--;
      i += 7;
    } else if (content.slice(i).startsWith("{{else}}") && depth === 0) {
      return i;
    } else {
      i++;
    }
  }

  return -1;
}

/**
 * 处理简单变量替换 {{variableName}}
 * 支持点号路径访问 {{object.property}}
 */
function processVariables(template: string, context: Record<string, any>): string {
  const varRegex = /\{\{(\w+(?:\.\w+)*)\}\}/g;
  return template.replace(varRegex, (match, path) => {
    const value = getNestedValue(context, path);
    return value !== undefined && value !== null ? String(value) : match;
  });
}

/**
 * 获取嵌套对象值 (如 "obj.prop1.prop2")
 */
function getNestedValue(obj: Record<string, any>, path: string): any {
  const parts = path.split(".");
  let current: any = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * 转义正则特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
