import test from "node:test";
import assert from "node:assert/strict";
import { PIPELINE_DEFINITIONS, summarizePipeline, validateEpisode } from "../src/shared/schema.mjs";
import { readEpisode } from "../src/shared/store.mjs";

test("黄金样例符合系统数据契约", async () => {
  const episode = await readEpisode("golden-001");
  const validation = validateEpisode(episode);

  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.deepEqual(
    episode.pipeline.map((step) => step.id),
    PIPELINE_DEFINITIONS.map((step) => step.id)
  );
  assert.equal(episode.scenes.at(-1).end, episode.render.durationSeconds);
  assert.equal(episode.assets.every((asset) => asset.verified), true);
});

test("流水线摘要反映真实完成比例", async () => {
  const episode = await readEpisode("golden-001");
  const summary = summarizePipeline(episode.pipeline);

  assert.equal(summary.total, 8);
  assert.equal(summary.complete, 7);
  assert.equal(summary.percent, 88);
});
