#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  subtitleBoundaryReasons,
  splitSubtitleTextSemantically,
  SUBTITLE_MAXIMUM_CUE_DURATION_SECONDS,
  SUBTITLE_MINIMUM_CUE_DURATION_SECONDS,
  SUBTITLE_PREFERRED_CUE_DURATION_SECONDS,
  SUBTITLE_SEMANTIC_SEGMENTATION_VERSION
} from "../src/server/production/subtitle-segmentation.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WORKSPACE_ROOT = resolve(dirname(SCRIPT_PATH), "../..");
const DEFAULT_SOURCE = resolve(
  WORKSPACE_ROOT,
  "studio/data/render-inputs/full-v004b-attempt-001/subtitle-timeline-v004-full.json"
);
const DEFAULT_OUTPUT = resolve(
  WORKSPACE_ROOT,
  "studio/data/render-inputs/full-v004c-attempt-005/subtitle-timeline-v004c-semantic.json"
);
const DEFAULT_EXPECTED_SOURCE_SHA256 =
  "1a4fc03ab45ef2ca49c8e0e1cd0132c32ae6baddc723539eba3a7e001842f265";
const DEFAULT_MAXIMUM_CHARACTERS = 32;
const DURATION_EXCESS_PENALTY_PER_SECOND = 50;
const OVERLAY_BUILDER_PATH = resolve(
  WORKSPACE_ROOT,
  "studio/scripts/build-agent-skill-v004b-no-box-overlays.py"
);
const OVERLAY_FONT_PATH = "/System/Library/Fonts/Hiragino Sans GB.ttc";
const OFFICIAL_PYTHON_PATH = resolve(
  homedir(),
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
);
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const LEADING_PUNCTUATION_OR_SPACE =
  /^[\s，。！？；：、,.!?;:“”‘’（）《》「」『』…—-]+/u;
const EXPLICIT_SUBTITLE_BOUNDARY = /[，。！？；：、,.!?;:]\s*$/u;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function round(value) {
  return Number(Number(value).toFixed(12));
}

function segmentationChunkKey(segmentIndex, characterStart, characterEnd) {
  return `${segmentIndex}:${characterStart}:${characterEnd}`;
}

function frameAtSample(sample, fps, sampleRate) {
  return Math.ceil((sample * fps) / sampleRate - 1e-12);
}

function assertInteger(value, label, minimum = Number.MIN_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} 必须是大于等于 ${minimum} 的安全整数`);
  }
  return value;
}

function assertPlainFile(details, path, label) {
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} 必须是普通文件且不能是符号链接：${path}`);
  }
}

async function readSourceSnapshot(path, expectedSha256) {
  const details = await lstat(path);
  assertPlainFile(details, path, "源时间线");
  const bytes = await readFile(path);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `源时间线 SHA-256 漂移：expected=${expectedSha256} actual=${actualSha256}`
    );
  }
  return {
    bytes,
    sha256: actualSha256,
    value: JSON.parse(bytes.toString("utf8"))
  };
}

async function resolvePythonRuntime() {
  const path = await realpath(OFFICIAL_PYTHON_PATH);
  assertPlainFile(await lstat(path), path, "字幕测量 Python runtime");
  return path;
}

async function fixedRendererSnapshot() {
  const pythonPath = await resolvePythonRuntime();
  const builderPath = resolve(OVERLAY_BUILDER_PATH);
  const fontPath = resolve(OVERLAY_FONT_PATH);
  assertPlainFile(await lstat(builderPath), builderPath, "no-box overlay builder");
  assertPlainFile(await lstat(fontPath), fontPath, "固定字幕字体");
  const [pythonBytes, builderBytes, fontBytes] = await Promise.all([
    readFile(pythonPath),
    readFile(builderPath),
    readFile(fontPath)
  ]);
  return {
    pythonPath,
    pythonSha256: sha256(pythonBytes),
    builderPath,
    builderSha256: sha256(builderBytes),
    fontPath,
    fontSha256: sha256(fontBytes)
  };
}

function assertSameRendererSnapshot(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("字幕测量 Python、builder 或字体在验证期间发生漂移");
  }
}

function runProcessWithInput(command, args, input) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: WORKSPACE_ROOT,
      env: {
        ...process.env,
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PYTHONHASHSEED: "0",
        PYTHONNOUSERSITE: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      if (code !== 0) {
        rejectPromise(new Error(
          `字幕视觉测量失败 code=${code} signal=${signal ?? "none"}: ` +
          Buffer.concat(stderr).toString("utf8").trim()
        ));
        return;
      }
      resolvePromise({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
    child.stdin.end(input);
  });
}

export async function measureChunksWithOverlayRenderer(texts) {
  if (!Array.isArray(texts) || texts.some((text) => typeof text !== "string")) {
    throw new TypeError("字幕视觉测量输入必须是字符串数组");
  }
  const uniqueTexts = [...new Set(texts)];
  if (uniqueTexts.length === 0) return [];
  const pythonPath = await resolvePythonRuntime();
  const builderPath = resolve(OVERLAY_BUILDER_PATH);
  assertPlainFile(await lstat(builderPath), builderPath, "no-box overlay builder");
  const code = [
    "import importlib.util, json, sys",
    "builder_path = sys.argv[1]",
    "spec = importlib.util.spec_from_file_location('overlay_builder', builder_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "expected_renderer = {'FONT_FAMILY': 'Hiragino Sans GB', 'FONT_WEIGHT': 'W3', 'FONT_SIZE': 40, 'WIDTH': 1480, 'HEIGHT': 130, 'MAX_LINES': 2}",
    "actual_renderer = {key: getattr(module, key, None) for key in expected_renderer}",
    "if actual_renderer != expected_renderer:",
    "    raise RuntimeError(f'overlay renderer contract drift: expected={expected_renderer} actual={actual_renderer}')",
    "if str(module.FONT_PATH) != sys.argv[2]:",
    "    raise RuntimeError(f'overlay font path drift: {module.FONT_PATH}')",
    "payload = json.load(sys.stdin)",
    "font = module.ImageFont.truetype(str(module.FONT_PATH), size=module.FONT_SIZE, index=module.FONT_INDEX)",
    "results = []",
    "for text in payload['texts']:",
    "    try:",
    "        _image, lines, contract = module.render_text(text, font)",
    "    except Exception as error:",
    "        results.append({'text': text, 'fits': False, 'reason': str(error)})",
    "    else:",
    "        results.append({'text': text, 'fits': True, 'lines': lines, 'contract': contract})",
    "print(json.dumps({'results': results}, ensure_ascii=False, sort_keys=True))"
  ].join("\n");
  const {stdout} = await runProcessWithInput(
    pythonPath,
    ["-I", "-c", code, builderPath, OVERLAY_FONT_PATH],
    JSON.stringify({texts: uniqueTexts})
  );
  const result = JSON.parse(stdout);
  if (!Array.isArray(result?.results) || result.results.length !== uniqueTexts.length) {
    throw new Error("字幕视觉测量返回的结果数量不一致");
  }
  for (let index = 0; index < uniqueTexts.length; index += 1) {
    if (
      result.results[index]?.text !== uniqueTexts[index] ||
      typeof result.results[index]?.fits !== "boolean"
    ) {
      throw new Error("字幕视觉测量返回顺序或字段无效");
    }
  }
  return result.results;
}

function addBoundary(boundaries, characterOffset, localSample, evidence) {
  const current = boundaries.get(characterOffset);
  if (current && current.localSample !== localSample) {
    throw new Error(`字符边界 ${characterOffset} 对应多个音频时刻`);
  }
  if (!current || evidence.type === "after-leading-punctuation") {
    boundaries.set(characterOffset, {localSample, evidence});
  }
}

function markerBoundaryMap(segment) {
  const displayText = String(segment.text ?? "");
  const speechText = String(segment.speechText ?? displayText);
  const segmentSamples =
    assertInteger(segment.endSampleExclusive, "speech segment endSampleExclusive", 1) -
    assertInteger(segment.startSample, "speech segment startSample", 0);
  if (!displayText || segmentSamples <= 0 || !Array.isArray(segment.markers)) {
    throw new Error(`speech segment ${segment.index} 缺少文本、时长或 markers`);
  }

  const boundaries = new Map();
  addBoundary(boundaries, 0, 0, {
    type: "speech-start",
    characterOffset: 0,
    targetFrame: 0
  });

  for (const marker of segment.markers) {
    const location = assertInteger(marker.textLocation, "marker textLocation", 0);
    const length = assertInteger(marker.textLength, "marker textLength", 1);
    const localSample = assertInteger(marker.targetFrame, "marker targetFrame", 0);
    const markerText = String(marker.text ?? "");
    if (
      location + length > speechText.length ||
      speechText.slice(location, location + length) !== markerText ||
      localSample >= segmentSamples
    ) {
      throw new Error(`speech segment ${segment.index} marker 文本或时间无效`);
    }

    addBoundary(boundaries, location, localSample, {
      type: "marker-start",
      characterOffset: location,
      markerIndex: marker.index,
      markerText,
      targetFrame: localSample
    });

    // AVSpeech may return `，Skill` as one marker. Punctuation is silent, so
    // the semantic boundary after it is safely aligned to the same marker time
    // without inventing a word timestamp or splitting audible content.
    const punctuationPrefix =
      LEADING_PUNCTUATION_OR_SPACE.exec(markerText)?.[0] ?? "";
    const punctuationBoundary = location + punctuationPrefix.length;
    if (
      punctuationPrefix &&
      punctuationBoundary > location &&
      punctuationBoundary < location + length
    ) {
      addBoundary(boundaries, punctuationBoundary, localSample, {
        type: "after-leading-punctuation",
        characterOffset: punctuationBoundary,
        markerIndex: marker.index,
        markerText,
        punctuation: punctuationPrefix,
        targetFrame: localSample
      });
    }
  }

  addBoundary(boundaries, displayText.length, segmentSamples, {
    type: "speech-buffer-end",
    characterOffset: displayText.length,
    targetFrame: segmentSamples
  });
  return boundaries;
}

function rollingGroupsForChunks(source, chunks, segmentIndex) {
  const offsets = [0];
  for (const chunk of chunks) offsets.push(offsets.at(-1) + chunk.length);
  const groupsByPosition = new Map();
  let position = 0;
  while (position < chunks.length) {
    let finalPosition = position;
    while (
      finalPosition < chunks.length - 1 &&
      !EXPLICIT_SUBTITLE_BOUNDARY.test(chunks[finalPosition])
    ) {
      finalPosition += 1;
    }
    if (finalPosition > position) {
      const sourceStart = offsets[position];
      const sourceEnd = offsets[finalPosition + 1];
      const group = {
        id: `S${String(segmentIndex).padStart(2, "0")}:${sourceStart}-${sourceEnd}`,
        sourceStart,
        sourceEnd,
        finalText: source.slice(sourceStart, sourceEnd),
        cueCount: finalPosition - position + 1,
        displayAnchor: "group-source-start"
      };
      for (let cuePosition = position; cuePosition <= finalPosition; cuePosition += 1) {
        groupsByPosition.set(cuePosition, {
          ...group,
          cueOrdinal: cuePosition - position + 1
        });
      }
    }
    position = finalPosition + 1;
  }
  return groupsByPosition;
}

function validateSourceTimeline(timeline) {
  if (
    timeline?.fps !== 30 ||
    timeline?.durationInFrames !== 18_000 ||
    Number(timeline?.durationSeconds) !== 600 ||
    timeline?.sampleRate !== 48_000 ||
    !Array.isArray(timeline?.speechSegments) ||
    timeline.speechSegments.length !== 58 ||
    !Array.isArray(timeline?.displayCues)
  ) {
    throw new Error("源时间线不是冻结的 30fps / 600秒 / 58句合同");
  }
}

export function resegmentTimeline(sourceTimeline, options = {}) {
  validateSourceTimeline(sourceTimeline);
  const maximumCharacters = Number(
    options.maximumCharacters ?? DEFAULT_MAXIMUM_CHARACTERS
  );
  const maximumLines = Number(options.maximumLines ?? 2);
  const chunkFits = typeof options.chunkFits === "function"
    ? options.chunkFits
    : undefined;
  if (!Number.isInteger(maximumCharacters) || maximumCharacters < 12) {
    throw new Error("maximumCharacters 必须是大于等于 12 的整数");
  }
  if (!Number.isInteger(maximumLines) || maximumLines < 1 || maximumLines > 2) {
    throw new Error("v004c maximumLines 必须是 1 或 2");
  }
  const minimumCueDurationSeconds = Number(
    options.minimumCueDurationSeconds ?? SUBTITLE_MINIMUM_CUE_DURATION_SECONDS
  );
  const maximumCueDurationSeconds = Number(
    options.maximumCueDurationSeconds ?? SUBTITLE_MAXIMUM_CUE_DURATION_SECONDS
  );
  const preferredCueDurationSeconds = Number(
    options.preferredCueDurationSeconds ?? SUBTITLE_PREFERRED_CUE_DURATION_SECONDS
  );
  if (
    !Number.isFinite(minimumCueDurationSeconds) ||
    !Number.isFinite(maximumCueDurationSeconds) ||
    minimumCueDurationSeconds <= 0 ||
    maximumCueDurationSeconds <= minimumCueDurationSeconds ||
    !Number.isFinite(preferredCueDurationSeconds) ||
    preferredCueDurationSeconds < minimumCueDurationSeconds ||
    preferredCueDurationSeconds > maximumCueDurationSeconds
  ) {
    throw new Error("字幕 cue 最短/偏好/最长时长合同无效");
  }

  const fps = sourceTimeline.fps;
  const sampleRate = sourceTimeline.sampleRate;
  const displayCues = [];
  const speechSegments = [];
  let displayCueIndex = 1;

  for (const sourceSegment of sourceTimeline.speechSegments) {
    const segment = structuredClone(sourceSegment);
    const text = String(segment.text ?? "");
    const boundaryMap = markerBoundaryMap(segment);
    const chunks = splitSubtitleTextSemantically(text, maximumCharacters, {
      allowedBoundaries: [...boundaryMap.keys()],
      maximumLines,
      chunkPenalty: (_chunk, context) => {
        const startBoundary = boundaryMap.get(context.start);
        const endBoundary = boundaryMap.get(context.end);
        if (!startBoundary || !endBoundary) return 0;
        const durationSeconds =
          (endBoundary.localSample - startBoundary.localSample) / sampleRate;
        return Math.max(0, durationSeconds - preferredCueDurationSeconds) *
          DURATION_EXCESS_PENALTY_PER_SECOND;
      },
      chunkFits: (chunk, context) => {
        const startBoundary = boundaryMap.get(context.start);
        const endBoundary = boundaryMap.get(context.end);
        if (!startBoundary || !endBoundary) return false;
        const durationSeconds =
          (endBoundary.localSample - startBoundary.localSample) / sampleRate;
        if (
          durationSeconds < minimumCueDurationSeconds - 1e-12 ||
          durationSeconds > maximumCueDurationSeconds + 1e-12
        ) {
          return false;
        }
        return chunkFits
          ? chunkFits(chunk, {...context, speechSegmentIndex: segment.index})
          : true;
      }
    });
    if (chunks.join("") !== text) {
      throw new Error(`speech segment ${segment.index} 字幕未无损还原原文`);
    }

    const rollingGroups = rollingGroupsForChunks(text, chunks, segment.index);
    const cueIndexes = [];
    let characterStart = 0;
    let previousLocalSample = -1;
    for (let position = 0; position < chunks.length; position += 1) {
      const chunk = chunks[position];
      const characterEnd = characterStart + chunk.length;
      const rollingGroup = rollingGroups.get(position) ?? null;
      const displayContextStart = rollingGroup?.sourceStart ?? characterStart;
      const displayText = text.slice(displayContextStart, characterEnd);
      const startBoundary = boundaryMap.get(characterStart);
      const endBoundary = boundaryMap.get(characterEnd);
      if (!startBoundary || !endBoundary) {
        throw new Error(
          `speech segment ${segment.index} 使用了非 marker 字符边界`
        );
      }
      if (
        startBoundary.localSample <= previousLocalSample ||
        endBoundary.localSample <= startBoundary.localSample
      ) {
        throw new Error(
          `speech segment ${segment.index} 字幕 marker 时间未严格递增`
        );
      }
      if (position < chunks.length - 1) {
        const reasons = subtitleBoundaryReasons(
          chunk,
          text.slice(characterEnd)
        );
        if (reasons.length > 0) {
          throw new Error(
            `speech segment ${segment.index} 仍有无效字幕边界：${reasons.join(",")}`
          );
        }
      }

      const startSample = segment.startSample + startBoundary.localSample;
      const endSample = segment.startSample + endBoundary.localSample;
      const startFrame = frameAtSample(startSample, fps, sampleRate);
      const endFrameExclusive = frameAtSample(endSample, fps, sampleRate);
      if (endFrameExclusive <= startFrame) {
        throw new Error(`speech segment ${segment.index} 产生零帧字幕`);
      }

      displayCues.push({
        index: displayCueIndex,
        speechSegmentIndex: segment.index,
        sceneId: segment.sceneId,
        text: displayText,
        sourceText: chunk,
        sourceCharacterStart: characterStart,
        sourceCharacterEnd: characterEnd,
        displayContextStart,
        displayContextEnd: characterEnd,
        rollingCarryApplied: displayContextStart < characterStart,
        rollingGroup: rollingGroup ? structuredClone(rollingGroup) : null,
        start: round(startSample / sampleRate),
        end: round(endSample / sampleRate),
        startSample,
        endSampleExclusive: endSample,
        startFrame,
        endFrameExclusive,
        startAlignment: structuredClone(startBoundary.evidence),
        endAlignment: structuredClone(endBoundary.evidence)
      });
      cueIndexes.push(displayCueIndex);
      displayCueIndex += 1;
      characterStart = characterEnd;
      previousLocalSample = startBoundary.localSample;
    }
    segment.displayCueIndexes = cueIndexes;
    speechSegments.push(segment);
  }

  for (const segment of speechSegments) {
    const cues = displayCues.filter(
      (cue) => cue.speechSegmentIndex === segment.index
    );
    if (cues.map((cue) => cue.sourceText).join("") !== segment.text) {
      throw new Error(
        `speech segment ${segment.index} sourceText 未无损还原原文`
      );
    }
    const groups = new Map();
    for (const cue of cues) {
      const expectedDisplayText = segment.text.slice(
        cue.displayContextStart,
        cue.sourceCharacterEnd
      );
      if (
        cue.sourceText !== segment.text.slice(
          cue.sourceCharacterStart,
          cue.sourceCharacterEnd
        ) ||
        cue.text !== expectedDisplayText ||
        cue.displayContextEnd !== cue.sourceCharacterEnd ||
        cue.displayContextStart > cue.sourceCharacterStart ||
        cue.rollingCarryApplied !==
          (cue.displayContextStart < cue.sourceCharacterStart)
      ) {
        throw new Error(
          `speech segment ${segment.index} cue ${cue.index} source/display 合同无效`
        );
      }
      if (!cue.rollingGroup) {
        if (
          cue.rollingCarryApplied ||
          cue.displayContextStart !== cue.sourceCharacterStart
        ) {
          throw new Error(
            `speech segment ${segment.index} cue ${cue.index} 缺少 rolling group`
          );
        }
        continue;
      }
      const group = cue.rollingGroup;
      if (
        group.displayAnchor !== "group-source-start" ||
        cue.displayContextStart !== group.sourceStart ||
        group.finalText !== segment.text.slice(group.sourceStart, group.sourceEnd) ||
        group.cueOrdinal < 1 ||
        group.cueOrdinal > group.cueCount
      ) {
        throw new Error(
          `speech segment ${segment.index} cue ${cue.index} rolling group 合同无效`
        );
      }
      const groupCues = groups.get(group.id) ?? [];
      groupCues.push(cue);
      groups.set(group.id, groupCues);
    }
    for (const [groupId, groupCues] of groups) {
      const reference = groupCues[0].rollingGroup;
      if (
        groupCues.length !== reference.cueCount ||
        groupCues[0].sourceCharacterStart !== reference.sourceStart ||
        groupCues.at(-1).sourceCharacterEnd !== reference.sourceEnd ||
        groupCues.some((cue, index) =>
          cue.rollingGroup.id !== groupId ||
          cue.rollingGroup.sourceStart !== reference.sourceStart ||
          cue.rollingGroup.sourceEnd !== reference.sourceEnd ||
          cue.rollingGroup.finalText !== reference.finalText ||
          cue.rollingGroup.cueCount !== reference.cueCount ||
          cue.rollingGroup.cueOrdinal !== index + 1
        )
      ) {
        throw new Error(
          `speech segment ${segment.index} rolling group ${groupId} 不连续或元数据漂移`
        );
      }
    }
  }

  for (let index = 1; index < displayCues.length; index += 1) {
    if (displayCues[index].startSample < displayCues[index - 1].endSampleExclusive) {
      throw new Error(`display cue ${index + 1} 与前一条重叠`);
    }
  }

  const sourceSpeechTiming = sourceTimeline.speechSegments.map((segment) => ({
    index: segment.index,
    sceneId: segment.sceneId,
    startSample: segment.startSample,
    endSampleExclusive: segment.endSampleExclusive,
    startFrame: segment.startFrame,
    endFrameExclusive: segment.endFrameExclusive,
    markers: segment.markers
  }));
  const outputSpeechTiming = speechSegments.map((segment) => ({
    index: segment.index,
    sceneId: segment.sceneId,
    startSample: segment.startSample,
    endSampleExclusive: segment.endSampleExclusive,
    startFrame: segment.startFrame,
    endFrameExclusive: segment.endFrameExclusive,
    markers: segment.markers
  }));
  if (JSON.stringify(sourceSpeechTiming) !== JSON.stringify(outputSpeechTiming)) {
    throw new Error("重分段改变了 speech segment、场景或 marker 时间");
  }

  return {
    ...structuredClone(sourceTimeline),
    schemaVersion: "agent-skill-subtitle-timeline-v004c-semantic-v7",
    acceptedPrefix: {
      reused: false,
      previousDisplayCueCount:
        sourceTimeline.acceptedPrefix?.displayCueCount ?? 24,
      reason: "all cues were rebuilt to satisfy the semantic boundary contract"
    },
    semanticSegmentation: {
      contractVersion: SUBTITLE_SEMANTIC_SEGMENTATION_VERSION,
      sourceTimelineSha256: options.sourceTimelineSha256 ?? null,
      sourceTimelinePath: options.sourceTimelinePath ?? null,
      maximumCharactersPerPreferredLine: maximumCharacters,
      maximumLines,
      minimumCueDurationSeconds,
      preferredCueDurationSeconds,
      maximumCueDurationSeconds,
      cueDurationTimingEnforcedAtMarkers: true,
      rollingCarryForUnpunctuatedBoundaries: true,
      rollingCarryDisplayAnchor: "group-source-start",
      rollingCarryDisplaysOnlyPreviouslySpokenPrefix: true,
      sourceTextIsLosslessAndNonRepeated: true,
      rollingCarryCueCount: displayCues.filter(
        (cue) => cue.rollingCarryApplied
      ).length,
      rollingGroupCount: new Set(
        displayCues
          .map((cue) => cue.rollingGroup?.id)
          .filter(Boolean)
      ).size,
      markerAligned: true,
      leadingPunctuationMarkerSplitAllowedAtSameTimestamp: true,
      audioChanged: false,
      speechTimingChanged: false,
      sceneTimingChanged: false,
      markerTimingChanged: false,
      acceptedPrefixCuePngsReused: false,
      visualChunkFitsEnforced: Boolean(chunkFits),
      previousDisplayCueCount: sourceTimeline.displayCues.length,
      displayCueCount: displayCues.length
    },
    speechSegments,
    displayCues
  };
}

export async function resegmentTimelineWithVisualFits(
  sourceTimeline,
  options = {}
) {
  const measureChunks = options.measureChunks ?? measureChunksWithOverlayRenderer;
  if (typeof measureChunks !== "function") {
    throw new TypeError("measureChunks 必须是函数");
  }
  const usesRealOverlayRenderer =
    measureChunks === measureChunksWithOverlayRenderer;
  for (const forbiddenOption of ["measureOptions", "rendererIdentity"]) {
    if (Object.prototype.hasOwnProperty.call(options, forbiddenOption)) {
      throw new Error(
        `${forbiddenOption} 不得覆盖固定的正式字幕测量身份`
      );
    }
  }
  if (
    !usesRealOverlayRenderer &&
    options.allowUnverifiedMeasurementTestDouble !== true
  ) {
    throw new Error(
      "注入的 measureChunks 只能作为显式 test double，不能冒充真实视觉验证"
    );
  }
  const rendererSnapshot = usesRealOverlayRenderer
    ? await fixedRendererSnapshot()
    : null;
  const measurements = new Map();
  const rejectedChunkKeys = new Set();
  const upstreamChunkFits = typeof options.chunkFits === "function"
    ? options.chunkFits
    : () => true;
  const maximumIterations = Number(options.maximumIterations ?? 64);
  if (!Number.isInteger(maximumIterations) || maximumIterations < 1) {
    throw new Error("maximumIterations 必须是正整数");
  }

  for (let iteration = 1; iteration <= maximumIterations; iteration += 1) {
    const timeline = resegmentTimeline(sourceTimeline, {
      ...options,
      chunkFits: (text, context) => {
        const key = segmentationChunkKey(
          context.speechSegmentIndex,
          context.start,
          context.end
        );
        return !rejectedChunkKeys.has(key) && upstreamChunkFits(text, context);
      }
    });
    const selectedTexts = [...new Set(timeline.displayCues.map((cue) => cue.text))];
    const unmeasuredTexts = selectedTexts.filter((text) => !measurements.has(text));
    if (unmeasuredTexts.length > 0) {
      const results = await measureChunks(unmeasuredTexts);
      if (!Array.isArray(results) || results.length !== unmeasuredTexts.length) {
        throw new Error("measureChunks 必须逐条返回视觉测量结果");
      }
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (
          result?.text !== unmeasuredTexts[index] ||
          typeof result?.fits !== "boolean"
        ) {
          throw new Error("measureChunks 返回的文本、顺序或 fits 无效");
        }
        if (result.fits === true && (
          !Array.isArray(result.lines) ||
          result.lines.length < 1 ||
          result.lines.length > 2 ||
          result.lines.some((line) => typeof line !== "string" || !line.trim()) ||
          result.contract?.insideCaptionSafeArea !== true ||
          result.contract?.containerLikeAlpha !== false ||
          result.contract?.borderAlphaMax !== 0 ||
          result.contract?.nearFullWidthAlphaRows !== 0 ||
          !Number.isFinite(result.contract?.alphaCoverageRatio) ||
          result.contract.alphaCoverageRatio >= 0.30
        )) {
          throw new Error(
            "measureChunks 的 fits=true 缺少完整两行、安全区或无容器 alpha 证据"
          );
        }
        measurements.set(result.text, structuredClone(result));
      }
      if (usesRealOverlayRenderer) {
        assertSameRendererSnapshot(
          rendererSnapshot,
          await fixedRendererSnapshot()
        );
      }
    }

    const failedSelected = selectedTexts.filter(
      (text) => measurements.get(text)?.fits !== true
    );
    if (failedSelected.length > 0) {
      const failedSet = new Set(failedSelected);
      for (const cue of timeline.displayCues) {
        if (!failedSet.has(cue.text)) continue;
        rejectedChunkKeys.add(segmentationChunkKey(
          cue.speechSegmentIndex,
          cue.sourceCharacterStart,
          cue.sourceCharacterEnd
        ));
      }
      continue;
    }

    const successfulMeasurements = selectedTexts.map((text) => measurements.get(text));
    timeline.semanticSegmentation.visualFit = {
      verified: usesRealOverlayRenderer,
      publicationEligible: usesRealOverlayRenderer,
      measurementProvenance: usesRealOverlayRenderer
        ? "real-overlay-renderer"
        : "injected-test-double",
      testDouble: !usesRealOverlayRenderer,
      method: usesRealOverlayRenderer
        ? "iterative-global-segmentation-with-real-overlay-render-feedback"
        : "iterative-global-segmentation-with-unverified-test-double-feedback",
      iterations: iteration,
      measuredCandidateCount: measurements.size,
      rejectedCandidateCount: [...measurements.values()].filter(
        (measurement) => measurement.fits === false
      ).length,
      selectedCueCount: timeline.displayCues.length,
      allSelectedChunksFit: true,
      maximumLines: timeline.semanticSegmentation.maximumLines,
      minimumCueDurationSeconds:
        timeline.semanticSegmentation.minimumCueDurationSeconds,
      maximumCueDurationSeconds:
        timeline.semanticSegmentation.maximumCueDurationSeconds,
      maximumActualCueDurationSeconds: Math.max(
        ...timeline.displayCues.map(
          (cue) => (cue.endSampleExclusive - cue.startSample) / timeline.sampleRate
        )
      ),
      renderer: usesRealOverlayRenderer
        ? {
          ...rendererSnapshot,
          fontFamily: "Hiragino Sans GB",
          fontWeight: "W3",
          fontSize: 40,
          overlaySize: [1480, 130],
          maximumLines: 2,
          alphaAndSafeAreaThresholdsRelaxed: false,
          snapshotReverifiedAfterMeasurement: true
        }
        : {
          type: "injected-test-double",
          functionName: measureChunks.name || null
        },
      selectedMeasurements: successfulMeasurements.map((measurement) => ({
        text: measurement.text,
        lines: measurement.lines,
        contract: measurement.contract
      }))
    };
    return timeline;
  }
  throw new Error(
    `字幕在 ${maximumIterations} 轮真实渲染反馈后仍无法满足视觉合同`
  );
}

async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicRenameNoReplace(sourcePath, targetPath) {
  const pythonPath = await resolvePythonRuntime();
  const code = [
    "import ctypes, errno, os, sys",
    "source = os.fsencode(sys.argv[1])",
    "target = os.fsencode(sys.argv[2])",
    "library = ctypes.CDLL(None, use_errno=True)",
    "if sys.platform == 'darwin':",
    "    rename = library.renamex_np",
    "    rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]",
    "    rename.restype = ctypes.c_int",
    "    result = rename(source, target, 0x00000004)",
    "elif sys.platform.startswith('linux'):",
    "    rename = library.renameat2",
    "    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]",
    "    rename.restype = ctypes.c_int",
    "    result = rename(-100, source, -100, target, 0x00000001)",
    "else:",
    "    raise RuntimeError('unsupported atomic no-replace platform')",
    "if result != 0:",
    "    error_number = ctypes.get_errno()",
    "    if error_number in (errno.EEXIST, errno.ENOTEMPTY):",
    "        raise SystemExit(17)",
    "    raise OSError(error_number, os.strerror(error_number), sys.argv[2])"
  ].join("\n");
  try {
    await runProcessWithInput(
      pythonPath,
      ["-I", "-c", code, sourcePath, targetPath],
      ""
    );
  } catch (error) {
    if (/code=17(?:\s|$)/u.test(String(error?.message ?? error))) {
      throw new Error(
        `拒绝覆盖既有 v004c 时间线：${targetPath}`,
        {cause: error}
      );
    }
    throw error;
  }
}

export async function writeJsonNoReplace(path, value, options = {}) {
  const targetPath = resolve(path);
  const targetDirectory = dirname(targetPath);
  await mkdir(targetDirectory, {recursive: true});
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const temporaryPath = resolve(
    targetDirectory,
    `.${basename(targetPath)}.part-${process.pid}-${randomUUID()}`
  );
  if (
    options.testOnlyBeforePublish !== undefined &&
    typeof options.testOnlyBeforePublish !== "function"
  ) {
    throw new TypeError("testOnlyBeforePublish 必须是函数");
  }
  let handle;
  let published = false;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.chmod(0o444);
    await handle.sync();
    await handle.close();
    handle = null;

    await options.testOnlyBeforePublish?.({
      targetPath,
      temporaryPath,
      bytes
    });
    await atomicRenameNoReplace(temporaryPath, targetPath);
    published = true;
    await syncDirectory(targetDirectory);
  } catch (error) {
    if (!published) {
      try {
        await unlink(temporaryPath);
        await syncDirectory(targetDirectory);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") {
          throw new AggregateError(
            [error, cleanupError],
            `v004c 时间线发布失败且无法清理本次临时文件：${temporaryPath}`
          );
        }
      }
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return {bytes, sha256: sha256(bytes)};
}

function parseArguments(argv) {
  const result = {
    source: DEFAULT_SOURCE,
    output: DEFAULT_OUTPUT,
    expectedSourceSha256: DEFAULT_EXPECTED_SOURCE_SHA256,
    maximumCharacters: DEFAULT_MAXIMUM_CHARACTERS
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`${name} 缺少值`);
    if (name === "--source") result.source = resolve(value);
    else if (name === "--output") result.output = resolve(value);
    else if (name === "--expected-source-sha256") {
      result.expectedSourceSha256 = value;
    } else if (name === "--maximum-characters") {
      result.maximumCharacters = Number(value);
    } else {
      throw new Error(`未知参数：${name}`);
    }
    index += 1;
  }
  if (!HASH_PATTERN.test(result.expectedSourceSha256)) {
    throw new Error("expected source SHA-256 必须是 64 位小写十六进制");
  }
  return result;
}

function assertDefaultOutputScope(output) {
  const dataRoot = resolve(WORKSPACE_ROOT, "studio/data/render-inputs");
  const child = relative(dataRoot, output);
  if (!child || child.startsWith("..") || resolve(dataRoot, child) !== output) {
    throw new Error(`v004c 时间线必须写入 studio/data/render-inputs：${output}`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.source === options.output) {
    throw new Error("源时间线与 v004c 输出路径不能相同");
  }
  assertDefaultOutputScope(options.output);
  const snapshot = await readSourceSnapshot(
    options.source,
    options.expectedSourceSha256
  );
  const timeline = await resegmentTimelineWithVisualFits(snapshot.value, {
    maximumCharacters: options.maximumCharacters,
    maximumLines: 2,
    sourceTimelineSha256: snapshot.sha256,
    sourceTimelinePath: options.source
  });
  if (
    timeline.semanticSegmentation.visualFit?.verified !== true ||
    timeline.semanticSegmentation.visualFit?.publicationEligible !== true ||
    timeline.semanticSegmentation.visualFit?.measurementProvenance !==
      "real-overlay-renderer" ||
    timeline.semanticSegmentation.visualFit?.testDouble !== false
  ) {
    throw new Error("只有真实 overlay renderer 验证通过的时间线可以写入正式 attempt");
  }
  const output = await writeJsonNoReplace(options.output, timeline);
  process.stdout.write(`${JSON.stringify({
    status: "semantic-subtitle-timeline-created",
    outputPath: options.output,
    outputSha256: output.sha256,
    sourceTimelineSha256: snapshot.sha256,
    speechSegmentCount: timeline.speechSegments.length,
    previousDisplayCueCount: snapshot.value.displayCues.length,
    displayCueCount: timeline.displayCues.length,
    audioChanged: false,
    acceptedPrefixCuePngsReused: false
  })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  await main();
}
