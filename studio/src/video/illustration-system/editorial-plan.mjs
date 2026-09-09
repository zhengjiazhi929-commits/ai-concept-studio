import { defineIllustrationSequence } from "../../shared/illustration-system-contract.mjs";
import { illustrationExample } from "./catalog.mjs";

const example = illustrationExample("select-load");

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const timing = {
  cue: 20,
  match: [90, 150],
  reflow: [150, 210],
  contract: [150, 170],
  separateRows: [170, 190],
  alignCatalog: [190, 210],
  extract: [210, 240],
  raiseCopy: [240, 255],
  expand: [255, 300],
  steps: [255, 280],
  qa: [280, 300],
  transfer: [330, 420],
  loaded: [420, 600]
};

// Independent paper choreography reuses the existing explanation and copy.
// Geometry and local preview evidence do not introduce new knowledge or grant
// production approval; the earlier 2D and 3D candidates remain separate.
export const EDITORIAL_PLAN = deepFreeze({
  id: "EditorialSelectLoad",
  compositionId: "EditorialSelectLoad",
  exampleId: example.id,
  version: 1,
  status: "candidate",
  productionApproved: false,
  userAccepted: false,
  finalAccepted: false,
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 600,
  audio: "none",
  title: example.definition.title,
  subtitle: example.subtitle,
  copy: example.copy,
  sourceDescriptions: ["适用：图片任务", "适用：整理报告", "适用：数据检查"],
  typography: { title: 44, secondary: 28, detailTitle: 44 },
  definition: defineIllustrationSequence({
    id: "editorial-select-load",
    title: example.definition.title,
    explanationGoal: example.definition.explanationGoal,
    claimIds: example.definition.claimIds,
    fps: 30,
    durationInFrames: 600,
    objects: example.definition.objects,
    actions: [
      { ...example.definition.actions[0], fromFrame: timing.match[0], toFrame: timing.match[1] },
      { ...example.definition.actions[1], fromFrame: timing.extract[0], toFrame: timing.transfer[1] },
      { id: "expand", kind: "reveal", objectIds: ["copy"], claimIds: example.definition.claimIds,
        fromFrame: timing.expand[0], toFrame: timing.expand[1] },
      { ...example.definition.actions[2], fromFrame: timing.loaded[0], toFrame: timing.loaded[1] }
    ]
  }),
  geometry: {
    safeArea: { x: 90, y: 300, width: 1740, height: 560 },
    sourceInitialRects: [170, 750, 1330].map((x) => ({ x, y: 420, width: 420, height: 280 })),
    sourceFinalRects: [355, 525, 695].map((y) => ({ x: 140, y, width: 430, height: 125 })),
    context: { x: 1140, y: 325, width: 640, height: 485 },
    contextContent: { x: 1170, y: 430, width: 580, height: 340 },
    packetStart: { x: 176, y: 525, width: 430, height: 125 },
    packetReading: { x: 660, y: 450, width: 430, height: 280 },
    packetLoaded: { x: 1245, y: 450, width: 430, height: 280 },
    stepsMinimumHeight: 214,
    qaMinimumHeight: 276
  },
  timing
});

function progress(frame, [start, end]) {
  const amount = Math.max(0, Math.min(1, (frame - start) / (end - start)));
  return amount * amount * (3 - 2 * amount);
}

function interpolateRect(from, to, amount) {
  if (amount === 0) return { ...from };
  if (amount === 1) return { ...to };
  return Object.fromEntries(["x", "y", "width", "height"].map((key) => [key, from[key] + (to[key] - from[key]) * amount]));
}

function sourceRectAt(frame, index) {
  const initial = EDITORIAL_PLAN.geometry.sourceInitialRects[index];
  const final = EDITORIAL_PLAN.geometry.sourceFinalRects[index];
  const contracted = { ...initial, width: final.width, height: final.height };
  const separated = { ...contracted, y: final.y };
  // Simultaneous diagonal reflow overlaps the three papers midway. Contract
  // them in their columns, separate the rows, then align the catalog at left.
  if (frame <= timing.contract[1]) return interpolateRect(initial, contracted, progress(frame, timing.contract));
  if (frame <= timing.separateRows[1]) return interpolateRect(contracted, separated, progress(frame, timing.separateRows));
  return interpolateRect(separated, final, progress(frame, timing.alignCatalog));
}

function packetRectAt(frame) {
  const { packetStart, packetReading, packetLoaded } = EDITORIAL_PLAN.geometry;
  const outsideCatalog = { ...packetStart, x: packetReading.x };
  const collapsed = { ...packetReading, height: packetStart.height };
  // Clear the source column before rising so the copy never covers the
  // unrelated first source. The selected original keeps a visible left edge.
  if (frame <= timing.extract[1]) return interpolateRect(packetStart, outsideCatalog, progress(frame, timing.extract));
  if (frame <= timing.raiseCopy[1]) return interpolateRect(outsideCatalog, collapsed, progress(frame, timing.raiseCopy));
  if (frame <= timing.expand[1]) return interpolateRect(collapsed, packetReading, progress(frame, timing.expand));
  return interpolateRect(packetReading, packetLoaded, progress(frame, timing.transfer));
}

function rectInside(inner, outer) {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

export function editorialFrameState(frame) {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= EDITORIAL_PLAN.durationInFrames) {
    throw new RangeError(`Frame must be an integer from 0 to ${EDITORIAL_PLAN.durationInFrames - 1}`);
  }
  const { copy, geometry } = EDITORIAL_PLAN;
  const selected = frame >= timing.match[0];
  const packetVisible = frame >= timing.extract[0];
  const contextVisible = packetVisible;
  const packet = packetRectAt(frame);
  const expansion = progress(frame, timing.expand);
  const stepsVisible = frame > timing.steps[0] && packet.height >= geometry.stepsMinimumHeight;
  const qaVisible = frame > timing.qa[0] && packet.height >= geometry.qaMinimumHeight;
  const loaded = frame >= timing.transfer[1] && rectInside(packet, geometry.contextContent);
  const phase = !selected ? 0 : !packetVisible ? 1 : loaded ? 3 : 2;
  const cueVisible = frame >= timing.cue;
  const cue = !cueVisible ? "" : !selected ? "先查看目录，找到当前任务需要的材料" : !packetVisible ?
    `匹配当前任务：只选中“${copy.documents[copy.selectedIndex]}”` : loaded ? "命中的内容已载入；原材料仍保留" :
      frame >= timing.transfer[0] ? "将命中的完整内容载入上下文" : qaVisible ? "步骤与验收都在副本中，准备载入" :
        stepsVisible ? "展开副本里的执行步骤" : "复制命中的内容，原件仍留在目录";
  return deepFreeze({
    titleVisible: true,
    cueVisible,
    selected,
    selectedIndex: copy.selectedIndex,
    selectedAmount: progress(frame, timing.match),
    reflowProgress: progress(frame, timing.reflow),
    sources: copy.documents.map((label, index) => ({
      ...sourceRectAt(frame, index),
      index,
      label,
      description: EDITORIAL_PLAN.sourceDescriptions[index],
      selected: selected && index === copy.selectedIndex,
      retained: true,
      labelSize: EDITORIAL_PLAN.typography.title
    })),
    sourceRetained: true,
    contextVisible,
    packetVisible,
    packet,
    packetLabel: copy.documents[copy.selectedIndex],
    expansion,
    stepsVisible,
    qaVisible,
    stepsAmount: progress(frame, timing.steps),
    qaAmount: progress(frame, timing.qa),
    loaded,
    phase,
    phaseName: ["directory", "selected", "copying", "loaded"][phase],
    cue,
    copy
  });
}
