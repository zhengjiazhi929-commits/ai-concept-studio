export const VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF = Object.freeze({
  schemaVersion: "visual-system-v1-ai-watermark-motion-proof-v12",
  compositionId: "VisualSystemV1AIWatermarkMotionProof",
  width: 640,
  height: 640,
  fps: 30,
  cycleSeconds: 4,
  cycleFrames: 120,
  referenceCycleSeconds: 2,
  referenceCycleFrames: 60,
  turnSeconds: 1,
  turnFrames: 30,
  turnCount: 4,
  contentFrames: 120,
  durationInFrames: 121,
  durationSeconds: 121 / 30,
  reference: Object.freeze({
    url: "https://uiverse.io/AqFox/young-dragon-29",
    license: "MIT",
    timingFunction: "cubic-bezier(0.25, 0.1, 0.25, 1)",
    firstHalf: "one complete X-axis rotation",
    secondHalf: "one complete Y-axis rotation",
    adaptedDirectionPattern: Object.freeze([
      "x-forward",
      "y-forward",
      "x-reverse",
      "y-reverse"
    ])
  }),
  rotation: Object.freeze({
    z: 45,
    xStart: -25,
    xEnd: -385,
    yStart: 25,
    yEnd: 385
  }),
  cube: Object.freeze({
    faceCount: 6,
    halfSizePx: 91.22,
    glyphWidthPx: 168,
    glyphHeightPx: 110,
    glyphViewBoxWidth: 368,
    glyphVisibleXMin: 18,
    glyphVisibleXMax: 350,
    panelMode: "none",
    backfaceMode: "hidden",
    minimumVisibleFacing: 0.15,
    extrusionTaperFacingStart: 0.1,
    extrusionFullFacing: 0.5,
    layoutMode: "near-touching",
    targetVisibleSolidGapRangePx: Object.freeze([0.6, 0.65]),
    targetProjectedVisibleGapPx: 0.5
  }),
  extrusion: Object.freeze({
    layerCount: 15,
    depthPx: 15,
    primaryMintLayers: 12,
    secondaryPurpleLayers: 3
  }),
  palette: Object.freeze({
    paper: "#F7FAF8",
    mintFaceLight: "#D8F8EC",
    mintFace: "#58CAA1",
    mintFaceDeep: "#2EA97F",
    mintSideLight: "#43B891",
    mintSideDeep: "#17795D",
    purpleSideLight: "#8067D9",
    purpleSideDeep: "#5B45AA"
  })
});

export const AI_WATERMARK_TURNS = Object.freeze([
  Object.freeze({
    index: 0,
    phase: "rotate-x-forward",
    axis: "x",
    direction: -1,
    startFrame: 0,
    endFrame: 30
  }),
  Object.freeze({
    index: 1,
    phase: "rotate-y-forward",
    axis: "y",
    direction: 1,
    startFrame: 30,
    endFrame: 60
  }),
  Object.freeze({
    index: 2,
    phase: "rotate-x-reverse",
    axis: "x",
    direction: 1,
    startFrame: 60,
    endFrame: 90
  }),
  Object.freeze({
    index: 3,
    phase: "rotate-y-reverse",
    axis: "y",
    direction: -1,
    startFrame: 90,
    endFrame: 120
  })
]);

export const AI_CUBE_FACES = Object.freeze([
  Object.freeze({ id: "front", axis: "y", degrees: 0, normal: Object.freeze([0, 0, 1]) }),
  Object.freeze({ id: "back", axis: "y", degrees: 180, normal: Object.freeze([0, 0, -1]) }),
  Object.freeze({ id: "right", axis: "y", degrees: 90, normal: Object.freeze([1, 0, 0]) }),
  Object.freeze({ id: "left", axis: "y", degrees: -90, normal: Object.freeze([-1, 0, 0]) }),
  Object.freeze({ id: "top", axis: "x", degrees: 90, normal: Object.freeze([0, -1, 0]) }),
  Object.freeze({ id: "bottom", axis: "x", degrees: -90, normal: Object.freeze([0, 1, 0]) })
]);

export function visibleAiSolidGapAtCubeCorner() {
  const { cube, extrusion } = VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF;
  const visibleGlyphHalfWidthPx =
    (cube.glyphWidthPx * (cube.glyphVisibleXMax - cube.glyphVisibleXMin)) /
    cube.glyphViewBoxWidth /
    2;
  const axisClearancePx =
    cube.halfSizePx - extrusion.depthPx - visibleGlyphHalfWidthPx;
  return Object.freeze({
    visibleGlyphHalfWidthPx,
    axisClearancePx,
    nearestCornerGapPx: Math.SQRT2 * axisClearancePx
  });
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function smoothstep(edge0, edge1, value) {
  const progress = clamp01((value - edge0) / (edge1 - edge0));
  return progress * progress * (3 - 2 * progress);
}

function cubicCoefficientA(point1, point2) {
  return 1 - 3 * point2 + 3 * point1;
}

function cubicCoefficientB(point1, point2) {
  return 3 * point2 - 6 * point1;
}

function cubicCoefficientC(point1) {
  return 3 * point1;
}

function sampleCubicBezier(parameter, point1, point2) {
  return (
    (cubicCoefficientA(point1, point2) * parameter +
      cubicCoefficientB(point1, point2)) *
      parameter +
    cubicCoefficientC(point1)
  ) * parameter;
}

function sampleCubicBezierSlope(parameter, point1, point2) {
  return (
    3 * cubicCoefficientA(point1, point2) * parameter * parameter +
    2 * cubicCoefficientB(point1, point2) * parameter +
    cubicCoefficientC(point1)
  );
}

export function referenceCssEase(progress) {
  const x = clamp01(progress);
  if (x === 0 || x === 1) return x;

  const x1 = 0.25;
  const y1 = 0.1;
  const x2 = 0.25;
  const y2 = 1;
  let parameter = x;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const slope = sampleCubicBezierSlope(parameter, x1, x2);
    if (Math.abs(slope) < 1e-7) break;
    parameter -= (sampleCubicBezier(parameter, x1, x2) - x) / slope;
    parameter = clamp01(parameter);
  }

  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const sampledX = sampleCubicBezier(parameter, x1, x2);
    if (Math.abs(sampledX - x) < 1e-9) break;
    if (sampledX < x) low = parameter;
    else high = parameter;
    parameter = (low + high) / 2;
  }

  return sampleCubicBezier(parameter, y1, y2);
}

function cycleFrameFor(frame) {
  const integerFrame = Number.isFinite(frame) ? Math.trunc(frame) : 0;
  const { cycleFrames } = VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF;
  return ((integerFrame % cycleFrames) + cycleFrames) % cycleFrames;
}

export function aiWatermarkMotionAtFrame(frame) {
  const cycleFrame = cycleFrameFor(frame);
  const { turnFrames } = VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF;
  const turnIndex = Math.floor(cycleFrame / turnFrames);
  const turn = AI_WATERMARK_TURNS[turnIndex];
  const phaseFrame = cycleFrame - turn.startFrame;
  const linearProgress = phaseFrame / turnFrames;
  const easedProgress = referenceCssEase(linearProgress);
  const { z, xStart, xEnd, yStart, yEnd } =
    VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.rotation;

  let rotateX;
  let rotateY;
  if (turnIndex === 0) {
    rotateX = xStart + (xEnd - xStart) * easedProgress;
    rotateY = yStart;
  } else if (turnIndex === 1) {
    rotateX = xEnd;
    rotateY = yStart + (yEnd - yStart) * easedProgress;
  } else if (turnIndex === 2) {
    rotateX = xEnd + (xStart - xEnd) * easedProgress;
    rotateY = yEnd;
  } else {
    rotateX = xStart;
    rotateY = yEnd + (yStart - yEnd) * easedProgress;
  }

  return Object.freeze({
    cycleFrame,
    turnIndex,
    phase: turn.phase,
    axis: turn.axis,
    direction: turn.direction,
    linearProgress,
    easedProgress,
    rotateZ: z,
    rotateX,
    rotateY
  });
}

export function normalizeDegrees(value) {
  const normalized = ((value % 360) + 360) % 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function visualOrientationAtFrame(frame) {
  const state = aiWatermarkMotionAtFrame(frame);
  return Object.freeze({
    rotateZ: normalizeDegrees(state.rotateZ),
    rotateX: normalizeDegrees(state.rotateX),
    rotateY: normalizeDegrees(state.rotateY)
  });
}

function aiCubeFaceFacingAtFrame(frame, face) {
  const state = aiWatermarkMotionAtFrame(frame);
  const rotateX = (state.rotateX * Math.PI) / 180;
  const rotateY = (state.rotateY * Math.PI) / 180;
  const [normalX, normalY, normalZ] = face.normal;
  const normalZAfterY = -Math.sin(rotateY) * normalX + Math.cos(rotateY) * normalZ;
  return Math.sin(rotateX) * normalY + Math.cos(rotateX) * normalZAfterY;
}

export function aiCubeFaceVisibilityAtFrame(frame, face) {
  const { cube } = VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF;
  const facing = aiCubeFaceFacingAtFrame(frame, face);
  const extrusionProgress = smoothstep(
    cube.extrusionTaperFacingStart,
    cube.extrusionFullFacing,
    facing
  );
  const extrusionDepthPx =
    extrusionProgress * VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.extrusion.depthPx;
  const extrusionLayerCount = Math.ceil(
    extrusionProgress * VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.extrusion.layerCount
  );
  return Object.freeze({
    facing,
    extrusionProgress,
    extrusionDepthPx,
    extrusionLayerCount,
    visible: facing > cube.minimumVisibleFacing
  });
}

export function aiExtrusionLayerState(layer, extrusionProgress) {
  const progress = clamp01(extrusionProgress);
  const layerCount = VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.extrusion.layerCount;
  const revealIndex = layerCount - 1 - layer.index;
  return Object.freeze({
    depthPx: layer.depthPx,
    opacity: clamp01(progress * layerCount - revealIndex)
  });
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

function rgbToHex(rgb) {
  return `#${rgb
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function mixHex(from, to, progress) {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const amount = clamp01(progress);
  return rgbToHex(start.map((channel, index) => channel + (end[index] - channel) * amount));
}

const { extrusion, palette } = VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF;

export const AI_WATERMARK_EXTRUSION_LAYERS = Object.freeze(
  Array.from({ length: extrusion.layerCount }, (_, index) => {
    const isPurple = index > 0 && index <= extrusion.secondaryPurpleLayers;
    const roleIndex = isPurple ? index - 1 : index === 0 ? 0 : index - extrusion.secondaryPurpleLayers;
    const roleCount = isPurple
      ? extrusion.secondaryPurpleLayers
      : extrusion.primaryMintLayers;
    const roleProgress = roleCount <= 1 ? 1 : roleIndex / (roleCount - 1);
    const color = isPurple
      ? mixHex(palette.purpleSideDeep, palette.purpleSideLight, roleProgress)
      : mixHex(palette.mintSideDeep, palette.mintSideLight, roleProgress);
    return Object.freeze({
      index,
      depthPx: index - extrusion.layerCount,
      role: isPurple ? "secondary-purple" : "primary-mint",
      color
    });
  })
);
