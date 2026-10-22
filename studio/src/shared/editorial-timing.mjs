import {
  splitSubtitleTextSemantically,
  SUBTITLE_MINIMUM_CUE_DURATION_SECONDS,
  SUBTITLE_MAXIMUM_CUE_DURATION_SECONDS
} from "../server/production/subtitle-segmentation.mjs";

export const EDITORIAL_TIMING_POLICY = Object.freeze({
  version: "editorial-estimate-v1",
  fps: 30,
  charactersPerSecond: 5.5,
  minorPauseSeconds: 0.14,
  majorPauseSeconds: 0.32,
  audioAligned: false
});

const sceneTypes = new Set(["title", "evidence", "statement", "summary"]);
const ignoredCharacters = /[\s，。！？；：、“”‘’（）《》…—,.!?;:'"()\[\]{}-]/gu;
const minorPunctuation = /[，、：；,;:]/gu;
const majorPunctuation = /[。！？.!?]/gu;
const text = value => typeof value === "string" && value.trim().length > 0 && value.length <= 20000
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const identifier = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(value);
const normalizedNarration = value => value
  .replace(/([A-Za-z0-9])[\r\n]+(?=[A-Za-z0-9])/gu, "$1 ")
  .replace(/[\r\n]+/gu, "");

function requireValue(condition, code = "editorial_timing_contract_invalid") {
  if (!condition) throw Object.assign(new Error("编辑时间轴不符合已锁定的估算与原文合同"), { code });
}

function dataRecord(value) {
  requireValue(value && typeof value === "object" && !Array.isArray(value)
    && [null, Object.prototype].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === "string" && descriptor?.enumerable && Object.hasOwn(descriptor, "value");
    }));
}

function closed(value, keys) {
  dataRecord(value);
  requireValue(Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}

function validatePolicy(policy) {
  closed(policy, Object.keys(EDITORIAL_TIMING_POLICY));
  requireValue(Object.entries(EDITORIAL_TIMING_POLICY).every(([key, value]) => policy[key] === value));
}

// All durations use the same exact 1/550-second integer lattice: one counted
// character is 100 ticks, a minor pause 77, and a major pause 176. This prevents
// cumulative floating point differences between subtitle and action prefixes.
function narrationTicks(value) {
  return value.replace(ignoredCharacters, "").length * 100
    + (value.match(minorPunctuation)?.length ?? 0) * 77
    + (value.match(majorPunctuation)?.length ?? 0) * 176;
}

function framesForTicks(ticks) {
  return Math.round(ticks * EDITORIAL_TIMING_POLICY.fps / 550);
}

/** Return a scene-relative frame. occurrence is a zero-based, non-overlapping match. */
export function cueFrameForNarration(narration, cue, timingPolicy, occurrence = 0) {
  validatePolicy(timingPolicy);
  requireValue(text(narration) && text(cue) && Number.isSafeInteger(occurrence) && occurrence >= 0,
    "editorial_timing_cue_invalid");
  const source = normalizedNarration(narration);
  const anchor = normalizedNarration(cue);
  let position = -anchor.length;
  for (let index = 0; index <= occurrence; index += 1) {
    position = source.indexOf(anchor, position + anchor.length);
    requireValue(position >= 0, "editorial_timing_cue_invalid");
  }
  return framesForTicks(narrationTicks(source.slice(0, position)));
}

/** Convert an already validated ordered raw-text cue position using the same
 * estimate lattice. Different cues may skip an earlier occurrence of a word. */
export function cueFrameAtNarrationPosition(narration, position, timingPolicy) {
  validatePolicy(timingPolicy);
  requireValue(text(narration) && Number.isSafeInteger(position) && position >= 0 && position <= narration.length,
    "editorial_timing_cue_invalid");
  return framesForTicks(narrationTicks(normalizedNarration(narration.slice(0, position))));
}

function originalUnits(shots) {
  requireValue(Array.isArray(shots) && shots.length > 0 && shots.length <= 64);
  const shotIds = new Set();
  const unitIds = new Set();
  const units = [];
  for (const shot of shots) {
    dataRecord(shot);
    requireValue(identifier(shot.id) && !shotIds.has(shot.id) && text(shot.narration));
    shotIds.add(shot.id);
    requireValue(Array.isArray(shot.unitIds) && shot.unitIds.length > 0 && shot.unitIds.length <= 128
      && Array.isArray(shot.sourceUnits) && shot.sourceUnits.length === shot.unitIds.length
      && Array.isArray(shot.evidenceRefs) && shot.evidenceRefs.every(text)
      && new Set(shot.evidenceRefs).size === shot.evidenceRefs.length);
    const paragraphs = shot.narration.split("\n\n");
    requireValue(paragraphs.length === shot.unitIds.length && paragraphs.every(text));
    shot.unitIds.forEach((id, index) => {
      const source = shot.sourceUnits[index];
      closed(source, ["id", "sha256"]);
      requireValue(identifier(id) && !unitIds.has(id) && source.id === id
        && typeof source.sha256 === "string" && /^[a-f0-9]{64}$/u.test(source.sha256));
      unitIds.add(id);
      // This browser-safe compiler checks mapping shape. The controlled import
      // separately verifies each exact source hash against the approved script.
      units.push({ id, narration: paragraphs[index], shotId: shot.id, evidenceRefs: [...shot.evidenceRefs] });
    });
  }
  return units;
}

/** Compile only an editorial estimate; no audio generation, stretching or target duration. */
export function compileEditorialTimeline(input) {
  closed(input, ["shots", "groups", "timingPolicy"]);
  validatePolicy(input.timingPolicy);
  const units = originalUnits(input.shots);
  const unitsById = new Map(units.map(unit => [unit.id, unit]));
  requireValue(Array.isArray(input.groups) && input.groups.length >= 12 && input.groups.length <= 24,
    "editorial_scene_count_invalid");
  const sceneIds = new Set();
  const assigned = [];
  for (const group of input.groups) {
    closed(group, ["id", "title", "type", "unitIds"]);
    requireValue(identifier(group.id) && !sceneIds.has(group.id) && text(group.title)
      && sceneTypes.has(group.type) && Array.isArray(group.unitIds) && group.unitIds.length > 0
      && group.unitIds.length <= units.length && group.unitIds.every(id => unitsById.has(id)));
    sceneIds.add(group.id);
    assigned.push(...group.unitIds);
  }
  requireValue(assigned.length === units.length && assigned.every((id, index) => id === units[index].id),
    "editorial_source_coverage_invalid");

  const scenes = [];
  const subtitles = [];
  let cursorFrame = 0;
  for (const group of input.groups) {
    const selected = group.unitIds.map(id => unitsById.get(id));
    const narration = selected.map(unit => unit.narration).join("\n\n");
    const display = normalizedNarration(narration);
    const sceneTicks = narrationTicks(display);
    const sceneFrames = framesForTicks(sceneTicks);
    requireValue(sceneTicks >= 12 * 550 && sceneTicks <= 60 * 550 && sceneFrames >= 360 && sceneFrames <= 1800,
      "editorial_scene_duration_invalid");
    const cues = splitSubtitleTextSemantically(display, 28);
    requireValue(cues.length > 0 && cues.length <= 8, "editorial_scene_subtitle_count_invalid");
    const endFrame = cursorFrame + sceneFrames;
    let cueTicks = 0;
    for (const cue of cues) {
      const cueStartFrame = cursorFrame + framesForTicks(cueTicks);
      cueTicks += narrationTicks(cue);
      const cueEndFrame = cursorFrame + framesForTicks(cueTicks);
      const cueSeconds = (cueEndFrame - cueStartFrame) / EDITORIAL_TIMING_POLICY.fps;
      requireValue(cueSeconds >= SUBTITLE_MINIMUM_CUE_DURATION_SECONDS
        && cueSeconds <= SUBTITLE_MAXIMUM_CUE_DURATION_SECONDS, "editorial_subtitle_duration_invalid");
      subtitles.push({
        sceneId: group.id, startFrame: cueStartFrame, endFrame: cueEndFrame,
        start: cueStartFrame / EDITORIAL_TIMING_POLICY.fps,
        end: cueEndFrame / EDITORIAL_TIMING_POLICY.fps,
        text: cue
      });
    }
    requireValue(cueTicks === sceneTicks);
    scenes.push({
      id: group.id, title: group.title, type: group.type,
      start: cursorFrame / EDITORIAL_TIMING_POLICY.fps,
      end: endFrame / EDITORIAL_TIMING_POLICY.fps,
      narration, unitIds: [...group.unitIds],
      sourceShotIds: [...new Set(selected.map(unit => unit.shotId))],
      evidenceRefs: [...new Set(selected.flatMap(unit => unit.evidenceRefs))],
      startFrame: cursorFrame, endFrame
    });
    cursorFrame = endFrame;
  }
  return {
    scenes, subtitles, durationInFrames: cursorFrame,
    durationSeconds: cursorFrame / EDITORIAL_TIMING_POLICY.fps,
    timingStatus: "editorial-estimate", audioAligned: false
  };
}
