import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createStudioServer } from "../src/server/app.mjs";
import { studioOutputRoot } from "../src/shared/paths.mjs";

test("本地控制台 API 和视频分段读取可用", async () => {
  const { server } = await createStudioServer({ recoverOnStart: false });
  const fixtureDirectory = resolve(studioOutputRoot, ".test-fixtures");
  const fixturePath = resolve(fixtureDirectory, "range.mp4");
  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(fixturePath, Buffer.alloc(256, 0x41));

  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;

    const health = await fetch(`${base}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const forbidden = await fetch(`${base}/api/import/golden`, {
      method: "POST",
      headers: { origin: "https://evil.example" }
    });
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).code, "forbidden_origin");

    const tooLarge = await fetch(`${base}/api/ai/primary`, {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:4317",
        "content-type": "application/json"
      },
      body: JSON.stringify({ providerId: "x".repeat(1024 * 1024) })
    });
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json()).code, "request_too_large");

    const ai = await fetch(`${base}/api/ai/status`).then((response) => response.json());
    assert.equal(ai.providers.some((provider) => provider.id === ai.primaryProvider), true);
    assert.equal(
      typeof ai.providers.find((provider) => provider.primary).configured,
      "boolean"
    );
    assert.equal(JSON.stringify(ai).includes("sk-"), false);
    assert.equal(ai.tasks.script.profile, "creative-structured");
    assert.equal(JSON.stringify(ai).includes("apiKeyEnv"), false);

    const episodes = await fetch(`${base}/api/episodes`).then((response) => response.json());
    assert.equal(episodes.episodes.some((episode) => episode.id === "golden-001"), true);

    const episode = await fetch(`${base}/api/episodes/golden-001`).then((response) =>
      response.json()
    );
    assert.deepEqual(Object.keys(episode.episode.approvals), [
      "research",
      "script",
      "storyboard",
      "assets",
      "final"
    ]);

    const workflow = await fetch(`${base}/api/episodes/golden-001/workflow`).then((response) =>
      response.json()
    );
    assert.equal(workflow.workflow.mode, "shadow");
    assert.equal(Array.isArray(workflow.workflow.legalActions), true);

    const metrics = await fetch(`${base}/api/episodes/golden-001/agent-metrics`).then((response) =>
      response.json()
    );
    assert.equal(metrics.metrics.episodeId, "golden-001");
    assert.equal(typeof metrics.metrics.slo.healthy, "boolean");

    const visualProofReview = await fetch(
      `${base}/api/episodes/golden-001/visual-proof-review`
    ).then((response) => response.json());
    assert.equal(visualProofReview.valid, false);
    assert.equal(visualProofReview.status, "not_started");

    const trends = await fetch(`${base}/api/trends`).then((response) => response.json());
    assert.equal(trends.run.summary.formalCandidateCount, 5);
    assert.equal(trends.run.candidates[0].id, "agent-skill");

    const collector = await fetch(`${base}/api/collector`).then((response) => response.json());
    assert.equal(collector.summary.configuredSources, 18);
    assert.equal(Array.isArray(collector.sources), true);

    const research = await fetch(`${base}/api/research`).then((response) => response.json());
    assert.equal(Object.hasOwn(research, "selection"), true);
    assert.equal(Object.hasOwn(research, "pack"), true);

    const cloud = await fetch(`${base}/api/cloud`).then((response) => response.json());
    assert.equal(typeof cloud.summary, "string");
    assert.equal(typeof cloud.code.configured, "boolean");
    assert.equal(typeof cloud.media.configured, "boolean");

    const approvalModule = await fetch(`${base}/approval-review-view.mjs`);
    assert.equal(approvalModule.status, 200);
    assert.equal(
      approvalModule.headers.get("content-type"),
      "text/javascript; charset=utf-8"
    );
    assert.match(await approvalModule.text(), /renderApprovalReview/u);

    const video = await fetch(`${base}/outputs/.test-fixtures/range.mp4`, {
      headers: { range: "bytes=0-127" }
    });
    assert.equal(video.status, 206);
    assert.equal(video.headers.get("content-length"), "128");
  } finally {
    if (server.listening) {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});
