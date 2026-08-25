import { createHash } from "node:crypto";

import {
  currentGateArtifactHash,
  currentGateVersion
} from "../shared/workflow.mjs";

export const GOLDEN_LOCAL_VOICE_EPISODE_ID = "golden-001";
export const GOLDEN_LOCAL_VOICE_DURATION_SECONDS = 36;
export const GOLDEN_LOCAL_VOICE_SCENE_COUNT = 6;
export const GOLDEN_LOCAL_VOICE_ID = "zm_010";
export const GOLDEN_LOCAL_VOICE_PACING_VERSION = "golden-local-voice-pacing-v1";

const EPSILON = 0.001;

function fail(message) {
  throw new Error(`golden-001 本地旁白候选无效：${message}`);
}

function sameTime(left, right) {
  return Number.isFinite(left)
    && Number.isFinite(right)
    && Math.abs(left - right) <= EPSILON;
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function approvedIdentity(episode, gate) {
  const approval = episode?.approvals?.[gate];
  const currentVersion = currentGateVersion(episode, gate);
  const currentArtifactHash = currentGateArtifactHash(episode, gate);
  if (
    approval?.status !== "approved"
    || !Number.isInteger(approval.currentVersion)
    || approval.currentVersion < 1
    || !/^[a-f0-9]{64}$/u.test(String(approval.artifactHash ?? ""))
    || approval.currentVersion !== currentVersion
    || approval.artifactHash !== currentArtifactHash
  ) {
    fail(`${gate} 必须绑定当前已批准版本和 SHA-256`);
  }
  return {
    version: approval.currentVersion,
    artifactHash: approval.artifactHash,
    provenance: approval.provenance ?? null
  };
}

export function buildGoldenLocalVoicePlan(episode) {
  if (episode?.id !== GOLDEN_LOCAL_VOICE_EPISODE_ID) {
    fail(`Episode 必须为 ${GOLDEN_LOCAL_VOICE_EPISODE_ID}`);
  }
  if (!sameTime(episode?.render?.durationSeconds, GOLDEN_LOCAL_VOICE_DURATION_SECONDS)) {
    fail(`成片时长必须为 ${GOLDEN_LOCAL_VOICE_DURATION_SECONDS} 秒`);
  }
  const scenes = episode.scenes;
  const subtitles = episode.subtitles;
  if (
    !Array.isArray(scenes)
    || !Array.isArray(subtitles)
    || scenes.length !== GOLDEN_LOCAL_VOICE_SCENE_COUNT
    || subtitles.length !== GOLDEN_LOCAL_VOICE_SCENE_COUNT
  ) {
    fail(`必须有 ${GOLDEN_LOCAL_VOICE_SCENE_COUNT} 个逐镜旁白段`);
  }

  const segments = [];
  let cursor = 0;
  for (let index = 0; index < GOLDEN_LOCAL_VOICE_SCENE_COUNT; index += 1) {
    const scene = scenes[index];
    const subtitle = subtitles[index];
    const expectedId = `S${String(index + 1).padStart(2, "0")}`;
    if (scene?.id !== expectedId) fail(`第 ${index + 1} 镜必须为 ${expectedId}`);
    if (
      !sameTime(scene.start, cursor)
      || !sameTime(subtitle?.start, scene.start)
      || !sameTime(subtitle?.end, scene.end)
      || !Number.isFinite(scene.end)
      || scene.end <= scene.start
    ) {
      fail(`${expectedId} 的镜头与字幕时间轴不连续`);
    }
    const text = String(subtitle.text ?? "").trim();
    if (!text) fail(`${expectedId} 旁白为空`);
    const slotSeconds = scene.end - scene.start;
    segments.push({
      id: expectedId,
      start: scene.start,
      end: scene.end,
      text,
      preferredSpeed: 0.9,
      targetTrailingSilenceSeconds: 0.55,
      minimumSpeed: 0.55,
      maximumEstimatedSpeed: 1.35,
      maximumSpeed: 1.45,
      maximumTrailingSilenceSeconds: Math.min(3.25, slotSeconds - 0.5)
    });
    cursor = scene.end;
  }
  if (!sameTime(cursor, GOLDEN_LOCAL_VOICE_DURATION_SECONDS)) {
    fail(`时间轴未覆盖 ${GOLDEN_LOCAL_VOICE_DURATION_SECONDS} 秒`);
  }

  const assets = episode.assets ?? [];
  if (assets.length < 4) fail("登记素材少于 4 项");
  for (const asset of assets) {
    if (
      !asset?.id
      || !asset.path
      || !Number.isSafeInteger(asset.bytes)
      || asset.bytes <= 0
      || !/^[a-f0-9]{64}$/u.test(String(asset.sha256 ?? ""))
      || asset.verified !== true
    ) {
      fail(`素材 ${asset?.id ?? "unknown"} 缺少已验证字节证据`);
    }
  }

  const source = {
    approvals: {
      research: approvedIdentity(episode, "research"),
      script: approvedIdentity(episode, "script"),
      storyboard: approvedIdentity(episode, "storyboard")
    },
    render: {
      width: episode.render.width,
      height: episode.render.height,
      fps: episode.render.fps,
      durationSeconds: episode.render.durationSeconds,
      compositionId: episode.render.compositionId
    },
    scenesSha256: sha256Json(scenes),
    subtitlesSha256: sha256Json(subtitles),
    assetsSha256: sha256Json(assets.map((asset) => ({
      id: asset.id,
      path: asset.path,
      bytes: asset.bytes,
      sha256: asset.sha256,
      source: asset.source ?? null,
      privacy: asset.privacy ?? null
    })))
  };

  return {
    episodeId: episode.id,
    durationSeconds: GOLDEN_LOCAL_VOICE_DURATION_SECONDS,
    voiceId: GOLDEN_LOCAL_VOICE_ID,
    pacingProfileVersion: GOLDEN_LOCAL_VOICE_PACING_VERSION,
    narration: segments.map((segment) => segment.text).join(""),
    source,
    sourceBindingHash: sha256Json(source),
    segments
  };
}

export function nextGoldenLocalVoiceCandidateVersion(files) {
  const highest = files.reduce((current, file) => {
    const match = /^golden-local-voice-zm_010-v(\d{3})(?:\.wav|-manifest\.json|\.rendering\.wav|\.lock)$/u.exec(
      file
    );
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return highest + 1;
}
