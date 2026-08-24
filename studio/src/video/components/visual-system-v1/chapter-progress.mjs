const EXPLICIT_TRAILING_DURATION_PATTERN =
  /\s*[·•|]\s*\d+(?:\.\d+)?\s*(?:s|秒)\s*$/u;
const AMBIGUOUS_TRAILING_DURATION_PATTERN =
  /(?:^|[-–—（(\s]|第)\s*\d+(?:\.\d+)?\s*(?:s|秒)\s*[）)]?\s*$/u;

export function visualSystemV1ChapterDisplayLabel(label, zeroBasedIndex) {
  if (typeof label !== "string" || label.trim().length === 0) {
    throw new TypeError("章节进度标签必须是非空文本");
  }
  if (!Number.isInteger(zeroBasedIndex) || zeroBasedIndex < 0) {
    throw new TypeError("章节进度序号必须是从零开始的非负整数");
  }

  const title = label.trim().replace(EXPLICIT_TRAILING_DURATION_PATTERN, "").trim();
  if (title.length === 0) {
    throw new TypeError("章节进度标签不能只包含时长");
  }
  if (AMBIGUOUS_TRAILING_DURATION_PATTERN.test(title)) {
    throw new TypeError("章节进度标签不得包含时长，请传入纯段落名");
  }
  return `${String(zeroBasedIndex + 1).padStart(2, "0")} · ${title}`;
}
