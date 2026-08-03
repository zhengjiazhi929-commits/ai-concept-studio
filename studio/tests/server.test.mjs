import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createStudioServer } from "../src/server/app.mjs";

test("本地控制台 API 和视频分段读取可用", async () => {
  const { server } = await createStudioServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const health = await fetch(`${base}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const episodes = await fetch(`${base}/api/episodes`).then((response) => response.json());
    assert.equal(episodes.episodes.some((episode) => episode.id === "golden-001"), true);

    const episode = await fetch(`${base}/api/episodes/golden-001`).then((response) =>
      response.json()
    );
    assert.equal(episode.episode.qa.status, "passed");

    const trends = await fetch(`${base}/api/trends`).then((response) => response.json());
    assert.equal(trends.run.summary.formalCandidateCount, 5);
    assert.equal(trends.run.candidates[0].id, "agent-skill");

    const collector = await fetch(`${base}/api/collector`).then((response) => response.json());
    assert.equal(collector.summary.configuredSources, 18);
    assert.equal(Array.isArray(collector.sources), true);

    const research = await fetch(`${base}/api/research`).then((response) => response.json());
    assert.equal(Object.hasOwn(research, "selection"), true);
    assert.equal(Object.hasOwn(research, "pack"), true);

    const video = await fetch(`${base}/outputs/golden-001/preview-v001.mp4`, {
      headers: { range: "bytes=0-127" }
    });
    assert.equal(video.status, 206);
    assert.equal(video.headers.get("content-length"), "128");
  } finally {
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }
});
