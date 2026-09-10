/**
 * 文件编码检测与转换
 *
 * 中文小说文件常见编码：UTF-8、GBK、GB2312、GB18030
 * 此模块自动检测并转换为 UTF-8
 */

import iconv from "iconv-lite";

/**
 * 检测 Buffer 的编码并转为 UTF-8 字符串
 *
 * 检测策略：
 * 1. 检查 BOM（UTF-8 BOM / UTF-16 LE/BE）
 * 2. 尝试 UTF-8 解码，检查是否有替换字符（U+FFFD）
 * 3. 回退到 GB18030（兼容 GBK/GB2312）
 */
export function detectAndDecode(buffer: Buffer): string {
  // 1. 检查 UTF-8 BOM (EF BB BF)
  if (buffer.length >= 3 &&
      buffer[0] === 0xEF &&
      buffer[1] === 0xBB &&
      buffer[2] === 0xBF) {
    return buffer.slice(3).toString("utf-8");
  }

  // 2. 检查 UTF-16 LE BOM (FF FE)
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return iconv.decode(buffer.slice(2), "utf16le");
  }

  // 3. 检查 UTF-16 BE BOM (FE FF)
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    return iconv.decode(buffer.slice(2), "utf16be");
  }

  // 4. 尝试 UTF-8 解码，检查是否有替换字符
  const utf8Str = buffer.toString("utf-8");
  const hasReplacementChars = utf8Str.includes("\uFFFD");

  // 5. 如果 UTF-8 解码没有替换字符，且包含中文字符，认为是有效 UTF-8
  if (!hasReplacementChars && /[\u4e00-\u9fff]/.test(utf8Str)) {
    return utf8Str;
  }

  // 6. 回退到 GB18030（兼容 GBK/GB2312）
  try {
    const gbkStr = iconv.decode(buffer, "gb18030");
    // 验证 GBK 解码结果是否包含有效的中文字符
    if (/[\u4e00-\u9fff]/.test(gbkStr)) {
      return gbkStr;
    }
  } catch {
    // GBK 解码失败，继续回退
  }

  // 7. 最后回退到 UTF-8（即使有替换字符）
  return utf8Str;
}
