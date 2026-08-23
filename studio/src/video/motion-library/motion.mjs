export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function smoothStep(value) {
  const progress = clamp01(value);
  return progress * progress * (3 - 2 * progress);
}

export function easeOutCubic(value) {
  const progress = clamp01(value);
  return 1 - ((1 - progress) ** 3);
}

export function easeInOutCubic(value) {
  const progress = clamp01(value);
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - (((-2 * progress) + 2) ** 3) / 2;
}

export function progressBetween(frame, startFrame, endFrame, easing = smoothStep) {
  if (!Number.isFinite(frame) || endFrame <= startFrame) return 0;
  return easing((frame - startFrame) / (endFrame - startFrame));
}

export function previewEntranceProgress(frame, durationInFrames) {
  const enterStart = Math.round(durationInFrames * 0.08);
  const enterEnd = Math.round(durationInFrames * 0.36);
  const exitStart = Math.round(durationInFrames * 0.66);
  const exitEnd = Math.round(durationInFrames * 0.94);
  if (frame < enterStart) return 0;
  if (frame <= enterEnd) return progressBetween(frame, enterStart, enterEnd, easeOutCubic);
  if (frame < exitStart) return 1;
  if (frame <= exitEnd) return 1 - progressBetween(frame, exitStart, exitEnd, easeInOutCubic);
  return 0;
}

export function seamlessProgress(frame, durationInFrames) {
  if (durationInFrames <= 1) return 0;
  return clamp01(frame / (durationInFrames - 1));
}

export function staggeredProgress(progress, index, count, overlap = 0.42) {
  if (count <= 1) return clamp01(progress);
  const delay = (index / (count - 1)) * overlap;
  return smoothStep((progress - delay) / (1 - overlap));
}

export function segmentChineseWords(text) {
  const value = String(text ?? "").trim();
  if (!value) return [];
  try {
    const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
    const segments = [...segmenter.segment(value)]
      .map((item) => item.segment)
      .filter((item) => item.trim().length > 0);
    return segments.length > 0 ? segments : Array.from(value);
  } catch {
    return Array.from(value);
  }
}
