import test from "node:test";
import assert from "node:assert/strict";
import { assetFileType } from "../src/server/production/assets.mjs";
import { agents } from "../src/server/agents/registry.mjs";
import { readFixtureEpisode } from "./episode-fixture.mjs";
import { agentSkillLongAssetBindingEpisodeFixture } from
  "./agent-skill-long-review.fixture.mjs";

test("素材上传接受图片与视频，并可在浏览器缺少 MIME 时按扩展名识别", () => {
  assert.deepEqual(assetFileType("image/png", "screen.png"), {
    extension: ".png",
    type: "image"
  });
  assert.deepEqual(assetFileType("application/octet-stream", "recording.MOV"), {
    extension: ".mov",
    type: "video"
  });
  assert.deepEqual(assetFileType("audio/mpeg", "licensed-music.mp3"), {
    extension: ".mp3",
    type: "audio"
  });
  assert.equal(assetFileType("application/pdf", "notes.pdf"), null);
});

test("素材 Agent 不会把 public 目录外的现有文件当作已登记素材", async () => {
  const episode = await readFixtureEpisode();
  episode.approvals.storyboard.status = "approved";
  episode.production.assetPlan = {
    artifactPath: "outputs/test-asset-plan.json",
    needsRevision: false,
    content: { items: [] }
  };
  episode.assets = [{ id: "outside", path: "../package.json", planItemId: null }];
  const result = await agents["asset-agent"].run(episode);
  assert.equal(result.status, "failed");
  assert.match(result.message, /缺少素材文件/u);
});

test("分镜重生成后素材 Agent 会按已批准清单恢复场景绑定", async () => {
  const episode = await agentSkillLongAssetBindingEpisodeFixture();
  episode.scenes = episode.scenes.map((scene) => {
    const { asset: _asset, audio: _audio, ...rest } = scene;
    return rest;
  });
  const result = await agents["asset-agent"].run(episode);
  assert.equal(result.status, "complete");
  const evidenceScenes = result.patch.scenes.filter((scene) => scene.type === "evidence");
  assert.equal(evidenceScenes.length, 8);
  assert.equal(evidenceScenes.every((scene) => Boolean(scene.asset)), true);
});
