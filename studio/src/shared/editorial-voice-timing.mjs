import {createHash} from "node:crypto";
import {splitSubtitleTextSemantically, SUBTITLE_MINIMUM_CUE_DURATION_SECONDS,
  SUBTITLE_MAXIMUM_CUE_DURATION_SECONDS} from "../server/production/subtitle-segmentation.mjs";

const sampleRate = 24000;
const sha = value => createHash("sha256").update(value).digest("hex");
const identifier = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,127}$/u.test(value);
const text = value => typeof value === "string" && value.trim().length > 0
  && value.length <= 20000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
function requireValue(condition, code = "editorial_voice_timing_invalid") {
  if (!condition) throw Object.assign(new Error("本地旁白文本或实测样本边界不符合合同"), {code});
}
function closed(value, keys) {
  requireValue(value && typeof value === "object" && !Array.isArray(value)
    && [null, Object.prototype].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable && Object.hasOwn(descriptor, "value");
    }));
}
const planKeys = ["schemaVersion", "sampleRate", "voiceId", "speed", "segments", "sourceTextSha256"];
const segmentKeys = ["id", "sceneId", "unitId", "text", "textSha256", "pauseAfterSamples"];

/** Preserve the approved source verbatim; only paragraph line breaks disappear in speech. */
export function buildEditorialVoiceSpeechPlan(scenes, {voiceId = "zm_010", speed = 1.1} = {}) {
  requireValue(voiceId === "zm_010" && speed === 1.1, "editorial_voice_selection_invalid");
  requireValue(Array.isArray(scenes) && scenes.length > 0 && scenes.length <= 64);
  const sceneIds = new Set();
  const unitIds = new Set();
  const segments = [];
  for (const [sceneIndex, scene] of scenes.entries()) {
    requireValue(scene && identifier(scene.id) && !sceneIds.has(scene.id) && text(scene.narration));
    sceneIds.add(scene.id);
    const paragraphs = scene.narration.replace(/\r\n/gu, "\n").split("\n\n");
    requireValue(Array.isArray(scene.unitIds) && scene.unitIds.length === paragraphs.length
      && paragraphs.length <= 128 && paragraphs.every(value => text(value) && !/[\r\n]/u.test(value)));
    for (const [unitIndex, paragraph] of paragraphs.entries()) {
      const unitId = scene.unitIds[unitIndex];
      requireValue(identifier(unitId) && !unitIds.has(unitId));
      unitIds.add(unitId);
      // Bind closing quotation marks to the phrase they close. Never split a
      // list at its enumeration comma or split a word to meet a visual width.
      const allowedBoundaries = [...paragraph.matchAll(/[。！？；：，,.!?;:][”’」』）》】]*\s*/gu)]
        .map(match => match.index + match[0].length);
      const chunks = splitSubtitleTextSemantically(paragraph, 28, {allowedBoundaries});
      for (const [chunkIndex, chunk] of chunks.entries()) {
        const unitEnd = chunkIndex === chunks.length - 1;
        const sceneEnd = unitEnd && unitIndex === paragraphs.length - 1;
        const final = sceneEnd && sceneIndex === scenes.length - 1;
        segments.push({id: `speech-${String(segments.length + 1).padStart(4, "0")}`,
          sceneId: scene.id, unitId, text: chunk, textSha256: sha(chunk),
          pauseAfterSamples: final ? 0 : sceneEnd ? 4800 : unitEnd ? 2880 : 0});
      }
    }
  }
  const plan = {schemaVersion: "editorial-voice-speech-plan-v1", sampleRate, voiceId, speed,
    segments, sourceTextSha256: sha(segments.map(segment => segment.text).join(""))};
  validatePlan(plan);
  return plan;
}

function validatePlan(plan) {
  closed(plan, planKeys);
  requireValue(plan.schemaVersion === "editorial-voice-speech-plan-v1" && plan.sampleRate === sampleRate
    && plan.voiceId === "zm_010" && plan.speed === 1.1 && hash(plan.sourceTextSha256)
    && Array.isArray(plan.segments) && plan.segments.length > 0 && plan.segments.length <= 4096);
  const sceneIds = new Set();
  const unitIds = new Set();
  for (const [index, segment] of plan.segments.entries()) {
    closed(segment, segmentKeys);
    const prior = plan.segments[index - 1];
    const next = plan.segments[index + 1];
    requireValue(segment.id === `speech-${String(index + 1).padStart(4, "0")}`
      && identifier(segment.sceneId) && identifier(segment.unitId) && text(segment.text)
      && [...segment.text].length <= 28 && !/[\r\n]/u.test(segment.text)
      && !/^[”’」』）》】]/u.test(segment.text) && !/、\s*$/u.test(segment.text)
      && hash(segment.textSha256) && segment.textSha256 === sha(segment.text));
    if (prior?.sceneId !== segment.sceneId) {
      requireValue(!sceneIds.has(segment.sceneId));
      sceneIds.add(segment.sceneId);
    }
    if (prior?.unitId !== segment.unitId) {
      requireValue(!unitIds.has(segment.unitId));
      unitIds.add(segment.unitId);
    } else requireValue(prior.sceneId === segment.sceneId);
    const expectedGap = !next ? 0 : next.sceneId !== segment.sceneId ? 4800
      : next.unitId !== segment.unitId ? 2880 : 0;
    requireValue(segment.pauseAfterSamples === expectedGap);
  }
  requireValue(plan.sourceTextSha256 === sha(plan.segments.map(segment => segment.text).join("")));
}

/** Exact unit boundaries, not ASR, word timestamps or proportional alignment. */
export function buildEditorialVoiceTiming(plan, measuredSegments) {
  validatePlan(plan);
  requireValue(Array.isArray(measuredSegments) && measuredSegments.length === plan.segments.length);
  const captions = [], segments = [], scenes = [], units = [], captionDurationIssues = [];
  let cursor = 0;
  for (const [index, source] of plan.segments.entries()) {
    const measurement = measuredSegments[index];
    closed(measurement, ["id", "sampleCount"]);
    requireValue(measurement.id === source.id && Number.isSafeInteger(measurement.sampleCount)
      && measurement.sampleCount >= sampleRate / 4 && measurement.sampleCount <= sampleRate * 65,
    "editorial_voice_measurement_invalid");
    const startSample = cursor;
    const endSample = cursor + measurement.sampleCount;
    cursor = endSample + source.pauseAfterSamples;
    requireValue(Number.isSafeInteger(cursor) && cursor <= sampleRate * 3600);
    segments.push({...source, sampleCount: measurement.sampleCount, startSample, endSample, nextSample: cursor});
    captions.push({text: source.text, startMs: startSample * 1000 / sampleRate,
      endMs: endSample * 1000 / sampleRate, timestampMs: null, confidence: null});
    if (scenes.at(-1)?.id !== source.sceneId) scenes.push({id: source.sceneId, startSample, endSample: cursor});
    else scenes.at(-1).endSample = cursor;
    if (units.at(-1)?.id !== source.unitId) units.push({id: source.unitId, sceneId: source.sceneId, startSample, endSample: cursor});
    else units.at(-1).endSample = cursor;
    const durationSeconds = measurement.sampleCount / sampleRate;
    if (durationSeconds < SUBTITLE_MINIMUM_CUE_DURATION_SECONDS || durationSeconds > SUBTITLE_MAXIMUM_CUE_DURATION_SECONDS) {
      captionDurationIssues.push({id: source.id, durationSeconds, code: "subtitle-duration-out-of-range"});
    }
  }
  return {schemaVersion: "editorial-voice-timing-v1", alignmentMethod: "synthesis-segment-sample-boundaries-v1",
    sampleRate, sourceTextSha256: plan.sourceTextSha256, totalSamples: cursor, durationSeconds: cursor / sampleRate,
    captions, segments, scenes, units, captionDurationIssues};
}

function timestamp(milliseconds) {
  const value = Math.round(milliseconds);
  const h = Math.floor(value / 3600000);
  const m = Math.floor(value % 3600000 / 60000);
  const s = Math.floor(value % 60000 / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(value % 1000).padStart(3, "0")}`;
}

export function serializeEditorialVoiceSrt(captions) {
  requireValue(Array.isArray(captions) && captions.length > 0 && captions.length <= 4096);
  let previousEnd = 0;
  return captions.map((caption, index) => {
    closed(caption, ["text", "startMs", "endMs", "timestampMs", "confidence"]);
    requireValue(text(caption.text) && !/[\r\n]/u.test(caption.text)
      && Number.isFinite(caption.startMs) && Number.isFinite(caption.endMs)
      && caption.startMs >= previousEnd && caption.endMs > caption.startMs
      && Math.round(caption.endMs) > Math.round(caption.startMs) && caption.endMs <= 3600000
      && caption.timestampMs === null && caption.confidence === null);
    previousEnd = caption.endMs;
    return `${index + 1}\n${timestamp(caption.startMs)} --> ${timestamp(caption.endMs)}\n${caption.text}\n`;
  }).join("\n");
}
