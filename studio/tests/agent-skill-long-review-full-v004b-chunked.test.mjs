import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";

import {
  FULL_V004B_RENDER_BASE_CONTRACT,
  assertFullV004bRenderBaseJob,
  fullV004bRenderBaseUsageText,
  parseFullV004bRenderBaseCliArguments,
} from "../scripts/render-agent-skill-long-review-full-v004b-chunked.mjs";
import {
  buildAudioDecodeFfmpegArgs,
  buildFirstChunkEta,
  buildLongReviewRenderInputProps,
  buildVideoDecodeFfmpegArgs,
} from "../scripts/render-agent-skill-long-review-wide-v004-chunked.mjs";
import {
  longReviewSourceInputs,
  validateLongReviewRenderJob,
} from "../src/server/production/long-render-job.mjs";

const STUDIO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const JOB_CONFIG_PATH = resolve(
  WORKSPACE_ROOT,
  FULL_V004B_RENDER_BASE_CONTRACT.jobConfigPath,
);

test("v004b 专用入口固定 20x900、5000ms、concurrency=1 且拒绝单次长渲染", () => {
  assert.deepEqual(parseFullV004bRenderBaseCliArguments([]), {
    help: false,
    chunkFrames: 900,
    interChunkPauseMs: 5_000,
  });
  assert.deepEqual(
    parseFullV004bRenderBaseCliArguments([
      "--chunk-frames",
      "900",
      "--inter-chunk-pause-ms",
      "5000",
    ]),
    {help: false, chunkFrames: 900, interChunkPauseMs: 5_000},
  );
  assert.equal(FULL_V004B_RENDER_BASE_CONTRACT.totalChunks, 20);
  assert.equal(FULL_V004B_RENDER_BASE_CONTRACT.concurrency, 1);
  assert.throws(
    () => parseFullV004bRenderBaseCliArguments(["--chunk-frames", "18000"]),
    /requires --chunk-frames 900 exactly/u,
  );
  assert.throws(
    () => parseFullV004bRenderBaseCliArguments(["--inter-chunk-pause-ms", "0"]),
    /requires --inter-chunk-pause-ms 5000 exactly/u,
  );
  assert.throws(
    () => parseFullV004bRenderBaseCliArguments(["--overwrite"]),
    /Unknown option/u,
  );
});

test("v014 job 使用全新不可覆盖目录并明确只是等待外部无框字幕的 render-base", async () => {
  const rawJob = JSON.parse(await readFile(JOB_CONFIG_PATH, "utf8"));
  const job = validateLongReviewRenderJob(rawJob, {workspaceRoot: WORKSPACE_ROOT});
  assert.equal(assertFullV004bRenderBaseJob(job), true);
  assert.match(job.resolvedPaths.finalDirectory, /render-base-v014$/u);
  assert.match(job.resolvedPaths.workDirectory, /\.full-video-.*-v014-work$/u);
  assert.notEqual(job.resolvedPaths.finalDirectory, job.resolvedPaths.workDirectory);
  assert.match(
    job.resolvedPaths.episode,
    /studio\/data\/render-inputs\/full-v004b-attempt-001\/episode\.json$/u,
  );
  assert.match(
    job.resolvedPaths.voice,
    /voice-natural-technical-v004-full\.wav$/u,
  );
  assert.deepEqual(job.renderProfile, {
    schemaVersion: "long-review-render-profile-v1",
    artifactRole: "render-base",
    formalCandidate: false,
    visualSource: "v013@980c4f4be9c1f0bccdcd546873fa1a877c98aac8",
    voice: "v004-full",
    subtitleStyle: "v004b-no-box",
    subtitleDelivery: "external-overlay-required",
    burnInSubtitle: false,
    chunkFrames: 900,
    interChunkPauseMs: 5_000,
    concurrency: 1,
  });
  const frozenSources = longReviewSourceInputs(job, {
    workspaceRoot: WORKSPACE_ROOT,
    scriptPath: resolve(
      STUDIO_ROOT,
      "scripts",
      "render-agent-skill-long-review-wide-v004-chunked.mjs",
    ),
    jobConfigPath: JOB_CONFIG_PATH,
  });
  assert.ok(frozenSources.includes(job.resolvedPaths.runner));
  assert.ok(frozenSources.includes(job.resolvedPaths.episode));
  assert.ok(frozenSources.includes(resolve(STUDIO_ROOT, "public")));
});

test("worker 保留完整 episode 时间线与旧语音证据，但无声 render-base 不挂载音频", () => {
  const episode = Object.freeze({
    id: "fixture",
    subtitles: Object.freeze([
      Object.freeze({startFrame: 0, endFrame: 89, text: "完整时间线"}),
    ]),
    voice: Object.freeze({
      publicPath: "episodes/agent-skill-20260806/voice-v001.wav",
    }),
  });
  const inputProps = buildLongReviewRenderInputProps(episode, false);
  assert.equal(inputProps.episode, episode);
  assert.equal(inputProps.episode.subtitles, episode.subtitles);
  assert.equal(
    inputProps.episode.voice.publicPath,
    "episodes/agent-skill-20260806/voice-v001.wav",
  );
  assert.equal(inputProps.burnInSubtitle, false);
  assert.equal(inputProps.renderAudio, false);
  assert.equal(Object.isFrozen(inputProps), true);
});

test("composition 用显式 renderAudio 开关阻断无声 worker 请求 episode 内的过期语音", async () => {
  const [rootSource, componentSource] = await Promise.all([
    readFile(
      resolve(STUDIO_ROOT, "src", "video", "agent-skill-long-review-root.jsx"),
      "utf8",
    ),
    readFile(
      resolve(STUDIO_ROOT, "src", "video", "agent-skill-long-review.jsx"),
      "utf8",
    ),
  ]);
  assert.match(rootSource, /renderAudio: true/u);
  assert.match(componentSource, /renderAudio = true/u);
  assert.match(
    componentSource,
    /renderAudio && episode\?\.voice\?\.publicPath/u,
  );
  assert.match(
    componentSource,
    /<Audio src=\{staticFile\(episode\.voice\.publicPath\)\}/u,
  );
});

test("逐段、concat 与 mux 使用 xerror 顺序完整解码合同", () => {
  const video = buildVideoDecodeFfmpegArgs("candidate.mp4").join(" ");
  const audio = buildAudioDecodeFfmpegArgs("candidate.mp4").join(" ");
  assert.match(video, /-xerror/u);
  assert.match(video, /-map 0:v:0/u);
  assert.match(video, /-c:v rawvideo -f null -$/u);
  assert.match(audio, /-xerror/u);
  assert.match(audio, /-map 0:a:0/u);
  assert.match(audio, /-c:a pcm_s16le -f null -$/u);
});

test("首段 ETA 使用真实首段吞吐并明确自动续跑与后续 overlay 门禁", () => {
  const eta = buildFirstChunkEta({
    firstChunkElapsedSeconds: 100,
    calculatedAtMs: Date.parse("2026-09-02T00:00:00.000Z"),
    runFingerprint: "e".repeat(64),
  });
  assert.equal(eta.remainingChunks, 19);
  assert.equal(eta.remainingPauses, 19);
  assert.equal(eta.estimatedRemainingSeconds, 1_995);
  assert.equal(eta.automaticContinuation, true);
  assert.match(eta.scope, /subtitle overlay/u);
});

test("专用入口文案固定绝对 taskpolicy/nice 前缀且不冒充正式候选", () => {
  const usage = fullV004bRenderBaseUsageText();
  assert.match(usage, /\/usr\/sbin\/taskpolicy -b \/usr\/bin\/nice -n 20/u);
  assert.match(usage, /--chunk-frames 900 --inter-chunk-pause-ms 5000/u);
  assert.match(usage, /not the formal subtitle candidate/u);
  assert.match(usage, /20x900 frames, concurrency=1/u);
});

test("core 将 profile 写入 manifest 合同并在发布前记录完整解码与首段 ETA", async () => {
  const source = await readFile(
    resolve(STUDIO_ROOT, "scripts", "render-agent-skill-long-review-wide-v004-chunked.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /const inputProps = \{episode\};/u);
  assert.match(source, /buildLongReviewRenderInputProps\(episode\)/u);
  assert.match(source, /render-base-requires-external-subtitle-overlay/u);
  assert.match(source, /firstChunkEta/u);
  assert.ok(
    (source.match(/await assertVideoFullyDecodable\(/gu) ?? []).length >= 3,
    "chunk、concat、mux 都必须完整解码视频",
  );
  assert.equal(
    (source.match(/await assertAudioFullyDecodable\(/gu) ?? []).length,
    1,
    "mux 必须完整解码音频",
  );
});
