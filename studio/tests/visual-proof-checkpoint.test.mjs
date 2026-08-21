import test from "node:test";
import assert from "node:assert/strict";
import { readEpisode } from "../src/shared/store.mjs";
import {
  approveVisualProofCandidate,
  reviewVisualProofCandidate,
  verifyVisualProofApproval
} from "../src/server/reviews/visual-proof-checkpoint.mjs";

const EPISODE_ID = "golden-001";
const MANIFEST_PATH = `outputs/studio/${EPISODE_ID}/visual-proof-v014-manifest.json`;
const VIDEO_PATH = `outputs/studio/${EPISODE_ID}/visual-proof-v014.mp4`;
const QA_PATH = `outputs/studio/${EPISODE_ID}/visual-proof-v014-design-qa.md`;
const COMPARISON_PATH = `outputs/studio/${EPISODE_ID}/visual-proof-v014-comparison.png`;
const VIDEO_SHA256 = "a".repeat(64);

function memoryStore(initialEpisode) {
  let stored = structuredClone(initialEpisode);
  const events = [];
  return {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async (event) => events.push(structuredClone(event)),
    get episode() {
      return structuredClone(stored);
    },
    events
  };
}

function evidenceHarness() {
  const manifest = {
    schemaVersion: 1,
    id: "agent-skill-visual-proof-v014",
    episodeId: EPISODE_ID,
    sourceRenderVersion: 15,
    durationSeconds: 60,
    fps: 30,
    width: 540,
    height: 960,
    outputPath: VIDEO_PATH,
    bytes: 600_014,
    sha256: VIDEO_SHA256,
    stills: Array.from(
      { length: 6 },
      (_, index) => `outputs/studio/${EPISODE_ID}/visual-proof-v014-stills/frame-${index}.png`
    ),
    generation: {
      mode: "local-code-motion",
      paidApiCalls: 0,
      externalInferenceCalls: 0,
      generatedImageCalls: 0,
      generatedVideoCalls: 0,
      textUploadCalls: 0
    }
  };
  const text = new Map([
    [MANIFEST_PATH, JSON.stringify(manifest)],
    [QA_PATH, `${VIDEO_PATH}\n${COMPARISON_PATH}\nfinal result: passed\n`]
  ]);
  const integrity = new Map([
    [MANIFEST_PATH, { bytes: 1_014, sha256: "b".repeat(64) }],
    [VIDEO_PATH, { bytes: manifest.bytes, sha256: VIDEO_SHA256 }],
    [QA_PATH, { bytes: 714, sha256: "c".repeat(64) }],
    [COMPARISON_PATH, { bytes: 80_014, sha256: "d".repeat(64) }]
  ]);
  function relativeFromAbsolute(path) {
    const marker = "/ai-concept-studio/";
    return String(path).split(marker).at(-1);
  }
  return {
    text,
    integrity,
    readFile: async (path) => text.get(relativeFromAbsolute(path)),
    inspectFileIntegrity: async (path) => structuredClone(integrity.get(relativeFromAbsolute(path)))
  };
}

test("视觉样片先机器检查再人工审批，并且不篡改完整成片终审", async () => {
  const source = structuredClone(await readEpisode(EPISODE_ID));
  const originalFinalApproval = structuredClone(source.approvals.final);
  const originalRender = structuredClone(source.render);
  const store = memoryStore(source);
  const evidence = evidenceHarness();
  const reviewed = await reviewVisualProofCandidate(EPISODE_ID, {
    manifestPath: MANIFEST_PATH,
    qaReportPath: QA_PATH,
    comparisonPath: COMPARISON_PATH
  }, {
    ...store,
    ...evidence,
    now: "2026-08-13T00:00:00.000Z"
  });
  assert.equal(reviewed.checkpoint.status, "waiting_approval");
  assert.equal(reviewed.checkpoint.machineReview.status, "passed");
  assert.equal(reviewed.checkpoint.currentCandidate.version, 14);
  assert.equal(reviewed.checkpoint.currentCandidate.video.sha256, VIDEO_SHA256);
  assert.deepEqual(store.episode.approvals.final, originalFinalApproval);
  assert.deepEqual(store.episode.render, originalRender);
  assert.deepEqual(Object.keys(store.episode.approvals), [
    "research",
    "script",
    "storyboard",
    "assets",
    "final"
  ]);

  await assert.rejects(
    approveVisualProofCandidate(EPISODE_ID, {
      candidateHash: reviewed.checkpoint.currentCandidate.candidateHash,
      note: "缺少机器审核绑定"
    }, { ...store, ...evidence }),
    (error) => error.code === "visual_proof_review_conflict" && error.statusCode === 409
  );

  await assert.rejects(
    approveVisualProofCandidate(EPISODE_ID, {
      candidateHash: "f".repeat(64),
      machineReviewId: reviewed.checkpoint.machineReview.id,
      note: "不应通过"
    }, { ...store, ...evidence }),
    (error) => error.code === "visual_proof_review_conflict" && error.statusCode === 409
  );

  const approved = await approveVisualProofCandidate(EPISODE_ID, {
    candidateHash: reviewed.checkpoint.currentCandidate.candidateHash,
    machineReviewId: reviewed.checkpoint.machineReview.id,
    note: "Zhengjiazhi 人工审核通过 v014"
  }, {
    ...store,
    ...evidence,
    now: "2026-08-13T00:01:00.000Z"
  });
  assert.equal(approved.checkpoint.status, "approved");
  assert.equal(approved.checkpoint.humanApproval.decision, "approved");
  assert.equal(
    approved.checkpoint.humanApproval.candidateHash,
    reviewed.checkpoint.currentCandidate.candidateHash
  );
  assert.deepEqual(store.episode.approvals.final, originalFinalApproval);
  assert.deepEqual(store.episode.render, originalRender);
  assert.equal(store.events.some((event) => event.type === "visual-proof.reviewed"), true);
  assert.equal(store.events.some((event) => event.type === "visual-proof.approved"), true);

  const verified = await verifyVisualProofApproval(EPISODE_ID, { ...store, ...evidence });
  assert.equal(verified.valid, true);
  assert.equal(verified.status, "approved");

  evidence.integrity.set(VIDEO_PATH, { bytes: 600_014, sha256: "e".repeat(64) });
  const stale = await verifyVisualProofApproval(EPISODE_ID, { ...store, ...evidence });
  assert.equal(stale.valid, false);
  assert.equal(stale.checks.find((check) => check.id === "video-integrity").passed, false);
});

test("机器检查未通过的视觉样片不能进入人工审批", async () => {
  const source = structuredClone(await readEpisode(EPISODE_ID));
  const store = memoryStore(source);
  const evidence = evidenceHarness();
  evidence.text.set(QA_PATH, `${VIDEO_PATH}\n${COMPARISON_PATH}\nfinal result: blocked\n`);
  const reviewed = await reviewVisualProofCandidate(EPISODE_ID, {
    manifestPath: MANIFEST_PATH,
    qaReportPath: QA_PATH,
    comparisonPath: COMPARISON_PATH
  }, { ...store, ...evidence });
  assert.equal(reviewed.checkpoint.status, "blocked");
  assert.equal(reviewed.checkpoint.machineReview.status, "blocked");
  await assert.rejects(
    approveVisualProofCandidate(EPISODE_ID, {
      candidateHash: reviewed.checkpoint.currentCandidate.candidateHash,
      machineReviewId: reviewed.checkpoint.machineReview.id,
      note: "不应绕过机器检查"
    }, { ...store, ...evidence }),
    (error) => error.code === "visual_proof_review_stale"
  );
});
