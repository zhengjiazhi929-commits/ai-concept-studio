import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { studioRoot } from "../src/shared/paths.mjs";
import { LOCAL_OFFLINE_TTS_V002_REGISTRATION } from
  "../src/server/production/local-offline-voice.mjs";
import {
  SHORT_LOCAL_TTS_DURATION_SECONDS,
  SHORT_LOCAL_TTS_NETWORK_GUARDS,
  SHORT_LOCAL_TTS_PACING_PROFILE_VERSION,
  SHORT_LOCAL_TTS_SEGMENT_PACING,
  SHORT_LOCAL_TTS_VOICE_ID,
  assertShortLocalTtsRenderedSegments,
  assertShortLocalTtsSpeechParts,
  buildShortLocalTtsSegments,
  nextShortLocalTtsCandidateVersion
} from "../src/video/agent-skill-short-local-tts-candidate.mjs";
import { assertShortLocalTtsCandidateApprovals } from "../scripts/build-agent-skill-short-local-tts-candidate.mjs";
import { createLocalOfflineVoiceFixture } from "./local-offline-voice.fixture.mjs";

const execute = promisify(execFile);
const episodeId = "agent-skill-tool-mcp-60s-20260813";
const candidateFixture = createLocalOfflineVoiceFixture(
  LOCAL_OFFLINE_TTS_V002_REGISTRATION
);

async function loadCurrentInputs() {
  const episode = structuredClone(candidateFixture.episode);
  const voicePlanData = candidateFixture.files.get(
    episode.production.voicePlan.artifactPath
  );
  assert.ok(voicePlanData, "tracked fixture must include voice plan JSON");
  return {
    episode,
    voicePlan: JSON.parse(voicePlanData.toString("utf8"))
  };
}

function episodeWaitingForAuthorizedVoice(sourceEpisode) {
  const episode = structuredClone(sourceEpisode);
  episode.voice = {
    ...episode.voice,
    status: "unconfigured",
    mode: null,
    audioPath: null
  };
  const voiceStep = episode.pipeline.find((step) => step.agent === "voice-agent");
  voiceStep.status = "blocked";
  voiceStep.requiresHuman = true;
  return episode;
}

test("当前批准短片的 voice plan 逐字拆成九个连续 60 秒试听段", async () => {
  const { episode, voicePlan } = await loadCurrentInputs();
  const plan = buildShortLocalTtsSegments(episode, voicePlan);

  assert.equal(plan.durationSeconds, SHORT_LOCAL_TTS_DURATION_SECONDS);
  assert.equal(plan.segments.length, 9);
  assert.equal(plan.segments[0].start, 0);
  assert.equal(plan.segments.at(-1).end, 60);
  assert.deepEqual(
    plan.segments.map(({ id, start, end }) => ({ id, start, end })),
    episode.scenes.map(({ id, start, end }) => ({ id, start, end }))
  );
  assert.equal(plan.segments.map(({ text }) => text).join(""), plan.narration);
  assert.equal(plan.pacingProfileVersion, SHORT_LOCAL_TTS_PACING_PROFILE_VERSION);
  assert.deepEqual(
    plan.segments.find(({ id }) => id === "S03"),
    {
      id: "S03",
      start: 8.708,
      end: 17.402,
      text: "MCP 标准化 prompts、resources 和 tools 如何被外部系统暴露和调用。",
      subtitleCount: 2,
      ...SHORT_LOCAL_TTS_SEGMENT_PACING.S03
    }
  );
  assert.equal(plan.segments.find(({ id }) => id === "S06").maximumSpeed, 1.18);
  assert.equal(
    plan.narration,
    voicePlan.narration.replace(/[\r\n]/gu, "")
  );
  assert.equal(
    plan.narration,
    episode.production.scriptDraft.content.sections.map(({ narration }) => narration).join("")
  );
});

test("v2 节奏合同会拒绝 S03 长尾静音和 S06 过快语速", async () => {
  const { episode, voicePlan } = await loadCurrentInputs();
  const plan = buildShortLocalTtsSegments(episode, voicePlan);
  const rendered = plan.segments.map((segment) => {
    const explicitPauseSeconds = assertShortLocalTtsSpeechParts(segment);
    const durationSeconds = Number((segment.end - segment.start - 0.2).toFixed(3));
    return {
      ...segment,
      speed: segment.preferredSpeed,
      durationSeconds,
      speechDurationSeconds: Number((durationSeconds - explicitPauseSeconds).toFixed(3)),
      explicitPauseSeconds,
      speechPartMetrics: (segment.speechParts ?? []).map((part, index) => ({
        index,
        text: part.text,
        pauseAfterSeconds: part.pauseAfterSeconds
      })),
      trailingSilenceSeconds: 0.2
    };
  });

  assert.equal(assertShortLocalTtsRenderedSegments(plan, rendered), true);

  const longTail = structuredClone(rendered);
  longTail[2].trailingSilenceSeconds = 3.019;
  assert.throws(
    () => assertShortLocalTtsRenderedSegments(plan, longTail),
    /S03 返回尾静音超过 2 秒/u
  );

  const rushed = structuredClone(rendered);
  rushed[5].speed = 1.253;
  assert.throws(
    () => assertShortLocalTtsRenderedSegments(plan, rushed),
    /S06 返回语速超过 1.18/u
  );

  const tooSlow = structuredClone(rendered);
  tooSlow[2].speed = 0.69;
  assert.throws(
    () => assertShortLocalTtsRenderedSegments(plan, tooSlow),
    /S03 返回语速低于 0.72/u
  );

  const wrongResultPart = structuredClone(rendered);
  wrongResultPart[2].speechPartMetrics[0].text += "改";
  assert.throws(
    () => assertShortLocalTtsRenderedSegments(plan, wrongResultPart),
    /S03 返回的 speechParts 与显式停顿明细不一致/u
  );
});

test("S03 speechParts 必须逐字拼回原文且显式停顿保持 0.40–0.60 秒", async () => {
  const { episode, voicePlan } = await loadCurrentInputs();
  const segment = buildShortLocalTtsSegments(episode, voicePlan).segments[2];
  assert.equal(assertShortLocalTtsSpeechParts(segment), 0.5);
  assert.equal(segment.speechParts.map(({ text }) => text).join(""), segment.text);
  assert.equal(segment.speechParts[0].text.endsWith("tools "), true);

  const changedText = structuredClone(segment);
  changedText.speechParts[0].text = changedText.speechParts[0].text.replace("tools ", "tool ");
  assert.throws(
    () => assertShortLocalTtsSpeechParts(changedText),
    /speechParts 拼接文本与批准旁白不一致/u
  );

  const invalidPause = structuredClone(segment);
  invalidPause.speechParts[0].pauseAfterSeconds = 0.7;
  assert.throws(
    () => assertShortLocalTtsSpeechParts(invalidPause),
    /显式停顿不在批准范围内/u
  );
});

test("试听分段对字幕改字、时间轴缺口和跨镜字幕失败关闭", async () => {
  const { episode, voicePlan } = await loadCurrentInputs();

  const changedText = structuredClone(episode);
  changedText.subtitles[0].text += "改";
  assert.throws(
    () => buildShortLocalTtsSegments(changedText, voicePlan),
    /字幕逐字内容与 voice plan 旁白不一致/u
  );

  const gap = structuredClone(episode);
  gap.scenes[1].start += 0.1;
  assert.throws(() => buildShortLocalTtsSegments(gap, voicePlan), /分镜\[1\] 未从/u);

  const crossScene = structuredClone(episode);
  crossScene.subtitles[1].end = episode.scenes[1].end + 0.1;
  crossScene.subtitles[2].start = crossScene.subtitles[1].end;
  assert.throws(
    () => buildShortLocalTtsSegments(crossScene, voicePlan),
    /包含跨越镜头终点的字幕/u
  );
});

test("构建器只接受当前 script、storyboard 和本地零调用素材方案的精确批准", async () => {
  const loaded = await loadCurrentInputs();
  const episode = episodeWaitingForAuthorizedVoice(loaded.episode);
  const approvals = assertShortLocalTtsCandidateApprovals(episode, {
    validateAssetExecutionApproval: () => true
  });

  assert.equal(approvals.script.version, 2);
  assert.equal(approvals.storyboard.version, 3);
  assert.equal(approvals.assetExecution.version, 9);
  assert.match(approvals.assetExecution.candidateHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(approvals.assetExecution.authorizedToolIds, []);

  const staleStoryboard = structuredClone(episode);
  staleStoryboard.approvals.storyboard.currentVersion = 2;
  assert.throws(
    () => assertShortLocalTtsCandidateApprovals(staleStoryboard, {
      validateAssetExecutionApproval: () => true
    }),
    /storyboard 必须是当前机器审核通过且人工批准/u
  );

  const staleAssetCandidate = structuredClone(episode);
  staleAssetCandidate.reviewCheckpoints.assetExecution.humanApproval.candidateHash = "f".repeat(64);
  assert.throws(
    () => assertShortLocalTtsCandidateApprovals(staleAssetCandidate, {
      validateAssetExecutionApproval: () => true
    }),
    /素材执行方案必须保持当前本地零调用候选/u
  );

  const configuredVoice = structuredClone(episode);
  configuredVoice.voice.status = "ready";
  assert.throws(
    () => assertShortLocalTtsCandidateApprovals(configuredVoice, {
      validateAssetExecutionApproval: () => true
    }),
    /等待人工授权音频的 Voice Agent Gate/u
  );
});

test("当前稿试听候选固定 zm_010、本地输出、版本递增且不写 live Episode", async () => {
  const builder = await readFile(
    resolve(studioRoot, "scripts", "build-agent-skill-short-local-tts-candidate.mjs"),
    "utf8"
  );

  assert.equal(SHORT_LOCAL_TTS_VOICE_ID, "zm_010");
  assert.match(builder, /episodeOutputDirectory\(episode\.id\)/u);
  assert.match(builder, /voice\.sha256/u);
  assert.match(builder, /LOCAL_TTS_MODEL\.configSha256/u);
  assert.match(builder, /networkPolicy: "deny-all"/u);
  assert.match(builder, /paidApiCalls:\s*0/u);
  assert.match(builder, /maximumPaidCostUsd:\s*0/u);
  assert.match(builder, /status: "human-review-candidate"/u);
  assert.match(builder, /approvalValidForGate\(episode, stage\)/u);
  assert.match(builder, /assertShortLocalTtsRenderedSegments\(plan, result\.proof\?\.segments\)/u);
  assert.match(builder, /pacingProfileVersion: SHORT_LOCAL_TTS_PACING_PROFILE_VERSION/u);
  assert.doesNotMatch(builder, /writeEpisode|saveVoiceUpload|episodePublicDirectory/u);
  assert.equal(nextShortLocalTtsCandidateVersion([]), 1);
  assert.equal(nextShortLocalTtsCandidateVersion(["short-local-tts-zm_010-v001.wav"]), 2);
  assert.equal(
    nextShortLocalTtsCandidateVersion(["short-local-tts-zm_010-v009-manifest.json"]),
    10
  );
});

test("Python 离线推理器行为上阻断 DNS、TCP 与 UDP 出站", async () => {
  const generatorPath = resolve(
    studioRoot,
    "scripts",
    "generate-agent-skill-local-tts.py"
  );
  const generator = await readFile(generatorPath, "utf8");
  assert.match(generator, /socket\.getaddrinfo = block_network/u);
  assert.match(generator, /socket\.socket\.sendto = block_network/u);
  assert.match(generator, /targetTrailingSilenceSeconds/u);
  assert.match(generator, /maximumTrailingSilenceSeconds/u);
  assert.match(generator, /maximumSpeed/u);
  assert.match(generator, /speechDurationSeconds/u);
  assert.match(generator, /explicitPauseSeconds/u);
  assert.equal(generator.match(/sf\.write\(/gu)?.length, 1);

  const { stdout } = await execute("python3", [generatorPath, "--network-guard-self-test"], {
    timeout: 10_000
  });
  const result = JSON.parse(stdout);
  assert.equal(result.networkGuard, "python-socket-connect-blocked");
  assert.deepEqual(result.networkGuards, [...SHORT_LOCAL_TTS_NETWORK_GUARDS]);

  const validSegment = {
    id: "S03",
    start: 8.708,
    end: 17.402,
    text: "tools 如何",
    minimumExplicitPauseSeconds: 0.4,
    maximumExplicitPauseSeconds: 0.6,
    speechParts: [
      { text: "tools ", pauseAfterSeconds: 0.5 },
      { text: "如何", pauseAfterSeconds: 0 }
    ]
  };
  const pacingResult = await execute("python3", [
    generatorPath,
    "--validate-pacing-segment",
    JSON.stringify(validSegment)
  ], { timeout: 10_000 });
  assert.deepEqual(JSON.parse(pacingResult.stdout), {
    explicitPauseSeconds: 0.5,
    speechPartCount: 2
  });

  const invalidSegment = structuredClone(validSegment);
  invalidSegment.speechParts[0].text = "tool ";
  await assert.rejects(
    execute("python3", [
      generatorPath,
      "--validate-pacing-segment",
      JSON.stringify(invalidSegment)
    ], { timeout: 10_000 }),
    /speechParts text does not match segment text/u
  );
});
