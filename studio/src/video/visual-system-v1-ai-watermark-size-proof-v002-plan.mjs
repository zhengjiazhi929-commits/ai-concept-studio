import { VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF } from "./visual-system-v1-ai-watermark-size-proof-plan.mjs";

const base = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF;

export const VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF_V002 = Object.freeze({
  schemaVersion: "visual-system-v1-ai-watermark-size-proof-v2",
  candidateDirectoryName: "visual-system-v1-ai-watermark-size-proof-v002",
  reviewOnly: true,
  registered: false,
  actualWatermarkIncluded: false,
  videoOutput: false,
  width: base.width,
  height: base.height,
  fps: base.fps,
  durationInFrames: base.durationInFrames,
  compositionId: base.compositionId,
  sourceFrame: base.sourceFrame,
  outline: base.outline,
  anchor: Object.freeze({ top: 40, right: 40 }),
  option: Object.freeze({
    id: "option-4-compact-corner",
    label: "120px · 上40 · 右40",
    size: 120,
    fileName: "120px-top40-right40.png"
  })
});

export function aiWatermarkSizeProofV002Geometry() {
  const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF_V002;
  return Object.freeze({
    left: contract.width - contract.anchor.right - contract.option.size,
    top: contract.anchor.top,
    width: contract.option.size,
    height: contract.option.size,
    right: contract.anchor.right,
    bottom: contract.height - contract.anchor.top - contract.option.size
  });
}
