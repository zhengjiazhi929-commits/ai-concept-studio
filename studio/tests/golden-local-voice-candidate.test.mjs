import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { readFixtureEpisode } from "./episode-fixture.mjs";
import { verifyEpisodeAssets } from "../scripts/build-golden-local-voice-candidate.mjs";
import {
  GOLDEN_LOCAL_VOICE_DURATION_SECONDS,
  GOLDEN_LOCAL_VOICE_ID,
  buildGoldenLocalVoicePlan,
  nextGoldenLocalVoiceCandidateVersion
} from "../src/video/golden-local-voice-plan.mjs";

test("golden-001 本地旁白方案精确绑定六镜字幕、批准哈希和零覆盖版本", async () => {
  const episode = await readFixtureEpisode();
  const plan = buildGoldenLocalVoicePlan(episode);

  assert.equal(plan.episodeId, "golden-001");
  assert.equal(plan.durationSeconds, GOLDEN_LOCAL_VOICE_DURATION_SECONDS);
  assert.equal(plan.voiceId, GOLDEN_LOCAL_VOICE_ID);
  assert.equal(plan.segments.length, 6);
  assert.equal(plan.segments[0].start, 0);
  assert.equal(plan.segments.at(-1).end, 36);
  assert.equal(
    plan.narration,
    episode.subtitles.map((subtitle) => subtitle.text).join("")
  );
  assert.match(plan.sourceBindingHash, /^[a-f0-9]{64}$/u);
  assert.equal(plan.source.approvals.research.artifactHash, episode.approvals.research.artifactHash);
  assert.equal(plan.source.approvals.script.artifactHash, episode.approvals.script.artifactHash);
  assert.equal(
    plan.source.approvals.storyboard.artifactHash,
    episode.approvals.storyboard.artifactHash
  );
  assert.equal(
    nextGoldenLocalVoiceCandidateVersion([
      "golden-local-voice-zm_010-v001.wav",
      "golden-local-voice-zm_010-v002-manifest.json",
      "golden-local-voice-zm_010-v003.rendering.wav",
      "golden-local-voice-zm_010-v004.lock"
    ]),
    5
  );
});

test("旁白候选在时间轴、批准哈希或素材字节证据漂移时 fail closed", async () => {
  const source = await readFixtureEpisode();

  const timelineDrift = structuredClone(source);
  timelineDrift.subtitles[1].start = 5.1;
  assert.throws(() => buildGoldenLocalVoicePlan(timelineDrift), /时间轴不连续/u);

  const approvalDrift = structuredClone(source);
  approvalDrift.approvals.script.artifactHash = null;
  assert.throws(() => buildGoldenLocalVoicePlan(approvalDrift), /script 必须绑定/u);

  const approvedSubtitleDrift = structuredClone(source);
  approvedSubtitleDrift.subtitles[0].text = "这是没有重新经过分镜 Gate 的旁白";
  assert.throws(
    () => buildGoldenLocalVoicePlan(approvedSubtitleDrift),
    /storyboard 必须绑定/u
  );

  const assetDrift = structuredClone(source);
  assetDrift.assets[0].bytes = null;
  assert.throws(() => buildGoldenLocalVoicePlan(assetDrift), /缺少已验证字节证据/u);
});

test("旁白生成前拒绝越界路径和指向允许根外的素材 symlink", async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), "golden-voice-path-boundary-"));
  const allowedRoot = resolve(temporary, "public");
  const outsidePath = resolve(temporary, "outside.bin");
  const linkPath = resolve(allowedRoot, "escape.bin");
  const data = Buffer.from("synthetic fixture only", "utf8");
  const integrity = {
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex")
  };
  await mkdir(allowedRoot, { recursive: true });
  await writeFile(outsidePath, data);
  await symlink(outsidePath, linkPath);

  try {
    await assert.rejects(
      verifyEpisodeAssets({
        assets: [{ id: "outside", path: "../outside.bin", ...integrity }]
      }, { publicRoot: allowedRoot }),
      (error) => error.code === "path_boundary_forbidden"
    );
    await assert.rejects(
      verifyEpisodeAssets({
        assets: [{ id: "symlink", path: "escape.bin", ...integrity }]
      }, { publicRoot: allowedRoot }),
      (error) => error.code === "path_boundary_forbidden"
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
