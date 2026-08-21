export const VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF = Object.freeze({
  schemaVersion: "visual-system-v1-ai-watermark-size-proof-v1",
  reviewOnly: true,
  registered: false,
  actualWatermarkIncluded: false,
  videoOutput: false,
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 1,
  compositionId: "VisualSystemV1AiWatermarkSizeRangeProof",
  sourceFrame: Object.freeze({
    relativePath:
      "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v004/qa/encoded-frames/wide-frame-0300.png",
    width: 1920,
    height: 1080,
    bytes: 348306,
    sha256: "9635bf00089c3a21ee977b42e7471e5aa974be4b9c6a8e1a1fc20a61020e7d1a"
  }),
  anchor: Object.freeze({ top: 72, right: 96 }),
  outline: Object.freeze({
    width: 2,
    style: "dashed",
    color: "rgba(20, 54, 47, 0.66)",
    fill: "transparent",
    shadow: "none",
    cornerRadius: 0
  }),
  options: Object.freeze([
    Object.freeze({
      id: "option-1-recommended",
      label: "推荐·均衡",
      size: 192,
      fileName: "01-recommended-192px.png"
    }),
    Object.freeze({
      id: "option-2-compact",
      label: "克制",
      size: 160,
      fileName: "02-compact-160px.png"
    }),
    Object.freeze({
      id: "option-3-strong",
      label: "强识别",
      size: 224,
      fileName: "03-strong-224px.png"
    })
  ])
});

export function aiWatermarkSizeProofGeometry(option) {
  const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF;
  if (!contract.options.some((candidate) => candidate.id === option.id)) {
    throw new Error(`未知的水印尺寸方案：${option.id}`);
  }
  return Object.freeze({
    left: contract.width - contract.anchor.right - option.size,
    top: contract.anchor.top,
    width: option.size,
    height: option.size,
    right: contract.anchor.right,
    bottom: contract.height - contract.anchor.top - option.size
  });
}
