const wordSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
const cjkWord = /^\p{Script=Han}+$/u;
const trailingParticle = /^[的地得]$/u;
const lineEndingPunctuation = /^[，。！？；：、,.!?;:）》】”’…—]+$/u;
const openingPunctuation = /^[（《【“‘([]+$/u;

function characterCount(value) {
  return [...value].length;
}

export function phraseWrapChunks(value, options = {}) {
  const maxCjkCharacters = options.maxCjkCharacters ?? 4;
  const chunks = [];
  let current = "";
  let currentCjkCharacters = 0;

  const flush = () => {
    if (current) chunks.push(current);
    current = "";
    currentCjkCharacters = 0;
  };

  for (const segment of wordSegmenter.segment(String(value ?? ""))) {
    const text = segment.segment;
    if (text.includes("\n")) {
      for (const [index, part] of text.split("\n").entries()) {
        if (part) current += part;
        flush();
        if (index < text.split("\n").length - 1) chunks.push("\n");
      }
      continue;
    }
    if (/^\s+$/u.test(text)) {
      flush();
      if (chunks.length > 0 && chunks.at(-1) !== "\n") chunks[chunks.length - 1] += text;
      else current += text;
      continue;
    }
    if (lineEndingPunctuation.test(text)) {
      if (current) current += text;
      else if (chunks.length > 0 && chunks.at(-1) !== "\n") chunks[chunks.length - 1] += text;
      else current = text;
      flush();
      continue;
    }
    if (openingPunctuation.test(text)) {
      flush();
      current = text;
      continue;
    }
    if (segment.isWordLike && cjkWord.test(text)) {
      const length = characterCount(text);
      if (trailingParticle.test(text)) {
        if (currentCjkCharacters > 0) {
          current += text;
          currentCjkCharacters += length;
          if (currentCjkCharacters >= maxCjkCharacters) flush();
        } else if (chunks.length > 0 && chunks.at(-1) !== "\n") {
          chunks[chunks.length - 1] += text;
        } else {
          current = text;
          currentCjkCharacters = length;
        }
        continue;
      }
      if (currentCjkCharacters > 0 && currentCjkCharacters + length > maxCjkCharacters) flush();
      current += text;
      currentCjkCharacters += length;
      if (currentCjkCharacters >= maxCjkCharacters) flush();
      continue;
    }
    flush();
    chunks.push(text);
  }
  flush();
  return chunks;
}
