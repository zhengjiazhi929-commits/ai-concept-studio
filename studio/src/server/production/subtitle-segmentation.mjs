const subtitleWordSegmenter = new Intl.Segmenter("zh-CN", {
  granularity: "word"
});

const leadingClosingPunctuation = /^[，。！？；：、）》】」』,.!?;:)\]]/u;
const trailingOpeningPunctuation = /[（《【「『(\[]$/u;
const semanticClauseEnding = /[，。！？；：、,.!?;:]\s*$/u;
const sentenceEnding = /[。！？.!?]\s*$/u;
const semicolonEnding = /[；;]\s*$/u;
const colonEnding = /[：:]\s*$/u;
const commaEnding = /[，,]\s*$/u;
const enumerationEnding = /、\s*$/u;

// Keep this deliberately conservative. These are tokens which cannot normally
// finish an independently readable Chinese subtitle phrase when no punctuation
// follows them. The matching right-hand list catches dependent continuations
// even when the left token itself is a product or protocol name.
const incompleteLeftPhrase =
  /(?:被|把|让|使|由|给|向|对|从|在|为|以|按|与|和|或|及|以及|或者|并|但|而|则|是|外部|不|未|没|没有|不是|不能|可以|可|应|应该|应当|要|需要|将|会|可能|能够|负责|提供|标准化|一个|一份|一条|这个|这些|该|的)\s*$/u;
const dependentRightPhrase =
  /^(?:才|只会|只|就|也|都|仍|再|继续|需要|应该|应当|被|由|把|让|的|地|得|以及|或者|或|和|与|及|负责|提供|标准化|用于|作为|怎样|如何|不知道|误当成|可发现|可复用|可维护)/u;
const incompletePunctuatedLeftPhrase =
  /[；;][^；;。！？.!?]*(?:时|之时|之后|之前|情况下|条件下|前提下)[，,]\s*$/u;

function textLength(value) {
  return Array.from(String(value ?? "")).length;
}

function uniqueSortedBoundaries(source, allowedBoundaries) {
  const sourceLength = source.length;
  const boundaries = new Set([0, sourceLength]);
  if (allowedBoundaries === undefined) {
    for (const item of subtitleWordSegmenter.segment(source)) {
      const boundary = item.index + item.segment.length;
      if (
        boundary > 0 &&
        boundary < sourceLength &&
        !/^\s/u.test(source.slice(boundary))
      ) {
        boundaries.add(boundary);
      }
    }
  } else {
    for (const rawBoundary of allowedBoundaries) {
      const boundary = Number(rawBoundary);
      if (
        Number.isInteger(boundary) &&
        boundary > 0 &&
        boundary < sourceLength
      ) {
        boundaries.add(boundary);
      }
    }
  }
  return [...boundaries].sort((left, right) => left - right);
}

export function semanticSubtitleBoundaryReasons(previousText, nextText) {
  const previous = String(previousText ?? "").trimEnd();
  const next = String(nextText ?? "").trimStart();
  if (!previous || !next) return [];

  const reasons = [];
  if (incompletePunctuatedLeftPhrase.test(previous)) {
    reasons.push("incomplete-punctuated-left-phrase");
  }
  if (semanticClauseEnding.test(previous)) return reasons;
  if (incompleteLeftPhrase.test(previous)) {
    reasons.push("incomplete-left-phrase");
  }
  if (dependentRightPhrase.test(next)) {
    reasons.push("dependent-right-phrase");
  }
  return [...new Set(reasons)];
}

export function subtitleBoundaryReasons(previousText, nextText) {
  const previousSource = String(previousText ?? "");
  const nextSource = String(nextText ?? "");
  const previous = previousSource.trimEnd();
  const next = nextSource.trimStart();
  const reasons = semanticSubtitleBoundaryReasons(previous, next);
  if (previous && next) {
    // Whitespace is a real word boundary. Trimming it before segmentation
    // incorrectly joins complete English words into one token.
    const joined = `${previousSource}${nextSource}`;
    const validWordBoundaries = new Set(
      [...subtitleWordSegmenter.segment(joined)].map((item) => item.index)
    );
    validWordBoundaries.add(joined.length);
    if (!validWordBoundaries.has(previousSource.length)) reasons.push("word-split");
  }
  if (leadingClosingPunctuation.test(next)) {
    reasons.push("leading-punctuation");
  }
  if (trailingOpeningPunctuation.test(previous)) {
    reasons.push("trailing-opening-punctuation");
  }
  return [...new Set(reasons)];
}

function boundaryPenalty(previousText, isFinal) {
  if (isFinal || sentenceEnding.test(previousText)) return 0;
  if (semicolonEnding.test(previousText)) return 2;
  if (colonEnding.test(previousText)) return 4;
  if (commaEnding.test(previousText)) return 7;
  if (enumerationEnding.test(previousText)) return 20;
  // A punctuation-free cut is a last resort. It is intentionally much more
  // expensive than adding one more cue at a real clause boundary: otherwise
  // the optimiser can balance glyph counts by cutting a compound such as
  // “数据库查询” even though the semicolon-delimited clauses each fit.
  return 100;
}

function findBestSplit(source, boundaries, maximumCharacters, options = {}) {
  const allowSemanticViolations = options.allowSemanticViolations === true;
  const hardMaximumCharacters = Number(options.hardMaximumCharacters);
  const chunkFits = typeof options.chunkFits === "function"
    ? options.chunkFits
    : () => true;
  const chunkPenalty = typeof options.chunkPenalty === "function"
    ? options.chunkPenalty
    : () => 0;
  const targetLength = Math.max(6, Math.round(maximumCharacters * 1.55));
  const states = new Map([[0, {cost: 0, chunks: []}]]);

  for (let startPosition = 0; startPosition < boundaries.length - 1; startPosition += 1) {
    const start = boundaries[startPosition];
    const state = states.get(start);
    if (!state) continue;

    for (let endPosition = startPosition + 1; endPosition < boundaries.length; endPosition += 1) {
      const end = boundaries[endPosition];
      const chunk = source.slice(start, end);
      const length = textLength(chunk);
      if (!chunk.trim()) continue;
      if (length > hardMaximumCharacters) break;
      const isFinal = end === source.length;
      if (!chunkFits(chunk, {
        source,
        start,
        end,
        length,
        isFinal
      })) continue;
      const extraChunkPenalty = Number(chunkPenalty(chunk, {
        source,
        start,
        end,
        length,
        isFinal
      }));
      if (!Number.isFinite(extraChunkPenalty) || extraChunkPenalty < 0) {
        throw new Error("chunkPenalty 必须返回非负有限数");
      }

      const next = isFinal ? "" : source.slice(end);
      const reasons = isFinal ? [] : subtitleBoundaryReasons(chunk, next);
      const hardStructuralReasons = reasons.filter(
        (reason) =>
          reason === "word-split" ||
          reason === "leading-punctuation" ||
          reason === "trailing-opening-punctuation"
      );
      if (hardStructuralReasons.length > 0) continue;
      if (reasons.length > 0 && !allowSemanticViolations) continue;

      const shortPenalty = length < Math.min(6, maximumCharacters)
        ? (Math.min(6, maximumCharacters) - length) * 8
        : 0;
      const semanticPenalty = reasons.length * 10_000;
      const cost =
        state.cost +
        12 +
        boundaryPenalty(chunk.trimEnd(), isFinal) +
        Math.abs(length - targetLength) * 0.35 +
        shortPenalty +
        semanticPenalty +
        extraChunkPenalty;
      const current = states.get(end);
      if (!current || cost < current.cost) {
        states.set(end, {
          cost,
          chunks: [...state.chunks, chunk]
        });
      }
    }
  }
  return states.get(source.length)?.chunks ?? null;
}

export function splitSubtitleTextSemantically(
  value,
  maximumCharacters = 24,
  options = {}
) {
  const source = String(value ?? "");
  if (!source.trim()) return ["待补充"];
  if (!Number.isInteger(maximumCharacters) || maximumCharacters < 4) {
    throw new TypeError("maximumCharacters 必须是大于等于 4 的整数");
  }
  const maximumLines = Number(options.maximumLines ?? 1);
  const hardMaximumCharacters = Number(
    options.hardMaximumCharacters ?? maximumCharacters * maximumLines
  );
  if (!Number.isInteger(maximumLines) || maximumLines < 1) {
    throw new TypeError("maximumLines 必须是正整数");
  }
  if (
    !Number.isInteger(hardMaximumCharacters) ||
    hardMaximumCharacters < maximumCharacters
  ) {
    throw new TypeError(
      "hardMaximumCharacters 必须是大于等于 maximumCharacters 的整数"
    );
  }

  const boundaries = uniqueSortedBoundaries(source, options.allowedBoundaries);
  const chunks =
    findBestSplit(source, boundaries, maximumCharacters, {
      hardMaximumCharacters,
      chunkFits: options.chunkFits,
      chunkPenalty: options.chunkPenalty
    }) ??
    (options.allowSemanticViolations === true
      ? findBestSplit(source, boundaries, maximumCharacters, {
        hardMaximumCharacters,
        allowSemanticViolations: true,
        chunkFits: options.chunkFits,
        chunkPenalty: options.chunkPenalty
      })
      : null);

  if (!chunks || chunks.join("") !== source) {
    throw new Error("字幕无法在允许边界内完整分段");
  }
  return chunks;
}

export const SUBTITLE_SEMANTIC_SEGMENTATION_VERSION =
  "subtitle-semantic-segmentation-v8";

export const SUBTITLE_MINIMUM_CUE_DURATION_SECONDS = 0.75;
export const SUBTITLE_PREFERRED_CUE_DURATION_SECONDS = 4.5;
// Generation and QA intentionally share this hard ceiling. A longer cue can
// reveal the ending of a 31–44-character sentence several seconds before it is
// narrated, even when the cue is technically aligned to the speech segment.
export const SUBTITLE_MAXIMUM_CUE_DURATION_SECONDS = 5.5;
