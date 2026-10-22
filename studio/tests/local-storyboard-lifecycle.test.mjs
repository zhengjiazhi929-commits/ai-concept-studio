import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { approvedScriptFixture } from "./approved-script-fixture.mjs";
import { loadApprovedScriptBinding } from "../src/server/production/approved-script-binding.mjs";
import { createLocalStoryboardImportService } from "../src/server/production/local-storyboard-import-core.mjs";
import { localStoryboardCapabilitySpec } from "../src/shared/local-storyboard-import-request.mjs";
import { createCapabilityAuthority } from "../src/server/security/side-effect-capability.mjs";
import { recheckGateReview, approveGate, exactApprovalBinding } from "../src/server/orchestrator.mjs";
import { buildHumanApprovalView } from "../src/server/reviews/human-approval-view.mjs";
import {attachSyntheticScreenEditing} from './helpers/screen-editorial-fixture.mjs';

const sha = value => createHash("sha256").update(value).digest("hex");
const authorization = request => ({ sideEffectGrant: createCapabilityAuthority({
  secret: "synthetic-lifecycle-only-000000000000000000000000"
}).authorize(localStoryboardCapabilitySpec(request)) });

async function fixture(t) {
  const f = await approvedScriptFixture(t);
  const episode = await f.deps.readEpisode();
  episode.pipeline.find(step => step.id === "script").status = "complete";
  episode.pipeline.find(step => step.id === "storyboard").status = "ready";
  await f.deps.writeEpisode(episode);
  const binding = await loadApprovedScriptBinding({ workspaceRoot: f.root,
    episode: await f.deps.readEpisode(), reviewConfig: f.config });
  const units = [{ id: "hook", text: binding.script.hook, refs: [] },
    ...binding.script.sections.flatMap(section => section.narration.split("\n\n").map((text, index) => ({
      id: `${section.id}:p${index + 1}`, text, refs: section.evidenceRefs
    }))), { id: "closing", text: binding.script.closing, refs: [] }];
  const groups = units.slice(1, -1).map(unit => [unit]);
  groups[0].unshift(units[0]);
  groups.at(-1).push(units.at(-1));
  const style = Object.fromEntries(["background", "cardMaterial", "text", "cardText", "illustrationText",
    "connections", "borders", "logo", "captions", "illustrations", "motion", "layout"]
    .map(key => [key, `Synthetic ${key}`]));
  const candidate = {
    schemaVersion: 1, kind: "codex-authored-storyboard-candidate-v1", episodeId: episode.id,
    candidateVersion: 1, author: "Codex", status: "local-editorial-draft", humanApproved: false,
    sourceScript: binding.sourceScript,
    content: {
      title: binding.script.title, globalStyle: { canvas: [1920, 1080], ...style },
      timingPolicy: "Synthetic unmeasured cue plan", implementationBoundary: "No animation implementation",
      shots: groups.map((group, index) => ({
        id: `E${index + 1}`, title: `合成编辑镜头${index + 1}`, unitIds: group.map(unit => unit.id),
        form: "过程示意", layout: "源记录与副本分区", guard: "来源保留，不提前完成", implementation: "未实现",
        narration: group.map(unit => unit.text).join("\n\n"),
        beats: [{ cue: group[0].text.slice(0, 5), action: "副本进入容器", result: "原件保留" }],
        sourceUnits: group.map(unit => ({ id: unit.id, sha256: sha(unit.text) })),
        evidenceRefs: [...new Set(group.flatMap(unit => unit.refs))],
        timing: { mode: "narration-cues", startSeconds: null, endSeconds: null, note: "Synthetic timing pending" }
      }))
    }
  };
  const candidatePath = "outputs/synthetic-lifecycle/storyboard.json";
  attachSyntheticScreenEditing(candidate);
  await f.put(candidatePath, candidate);
  const service = createLocalStoryboardImportService(f.deps);
  async function requestForCurrentState() {
    const preview = await service.previewLocalStoryboard({ episodeId: episode.id, candidatePath });
    return { episodeId: episode.id, candidatePath, candidateSha256: preview.candidateSha256,
      snapshotHash: preview.snapshotHash, actor: "human:synthetic-lifecycle", reason: "Explicit synthetic lifecycle import",
      confirmLocalStoryboardImport: true };
  }
  return { ...f, candidate, candidatePath, service, requestForCurrentState };
}

const upstream = episode => structuredClone({
  research: episode.research, sourceDocs: episode.sourceDocs, scriptDraft: episode.production.scriptDraft,
  researchApproval: episode.approvals.research, scriptApproval: episode.approvals.script,
  researchReview: episode.reviews.research, scriptReview: episode.reviews.script,
  ai: episode.production.ai, budget: episode.control.budget
});

async function actualReview(f) {
  return recheckGateReview(f.episode.id, "storyboard", {
    ...f.deps, review: { config: f.config, now: new Date("2026-01-15T08:00:00.000Z") }
  });
}

test("real recheck rejects cue-only storyboard and exact-binding approval cannot write", async t => {
  const f = await fixture(t);
  const request = await f.requestForCurrentState();
  const before = upstream(await f.deps.readEpisode());
  await f.service.importLocalStoryboard(request, authorization(request));
  const review = await actualReview(f);
  assert.equal(review.review.report.decision, "revise");
  assert.equal(review.output.status, "blocked");
  for (const code of ["editorial-timing-unmeasured", "editorial-execution-unimplemented", "scene-timeline", "subtitle-timeline"]) {
    assert.ok(review.review.report.blockingIssues.some(issue => issue.code === code), code);
  }
  const after = await f.deps.readEpisode();
  assert.equal(after.reviews.storyboard.status, "revision_required");
  assert.equal(after.production.storyboardDraft.needsRevision, true);
  assert.equal(after.pipeline.find(step => step.id === "storyboard").status, "blocked");
  assert.equal(after.control.activeOperation, null);
  assert.deepEqual(upstream(after), before);
  assert.equal(buildHumanApprovalView(after, "storyboard").status.readyForHumanApproval, false);
  const serialized = await readFile(f.episodePath, "utf8");
  const events = f.events.length;
  await assert.rejects(approveGate(after.id, "storyboard", exactApprovalBinding(after, "storyboard"), {
    ...f.deps, actor: "human:synthetic-lifecycle", review: { config: f.config }
  }));
  assert.equal(await readFile(f.episodePath, "utf8"), serialized);
  assert.equal(f.events.length, events);
});

test("import retry after actual machine revision preserves report, feedback and blocked state byte-for-byte", async t => {
  const f = await fixture(t);
  const request = await f.requestForCurrentState();
  const imported = await f.service.importLocalStoryboard(request, authorization(request));
  await actualReview(f);
  const before = await f.deps.readEpisode();
  const serialized = await readFile(f.episodePath, "utf8");
  const artifact = await readFile(resolve(f.root, imported.artifactPath));
  const retry = await f.service.importLocalStoryboard(request, authorization(request));
  assert.equal(retry.status, "already_committed");
  assert.equal(retry.version, 1);
  assert.equal(await readFile(f.episodePath, "utf8"), serialized);
  assert.deepEqual((await f.deps.readEpisode()).reviews.storyboard, before.reviews.storyboard);
  assert.deepEqual(await readFile(resolve(f.root, imported.artifactPath)), artifact);
  assert.equal((await f.deps.readEpisode()).production.storyboardDraft.versions.length, 1);
});

test("v2 preserves legacy artifact and timeline while invalidating only storyboard and downstream approvals", async t => {
  const f = await fixture(t);
  const episode = await f.deps.readEpisode();
  const legacyArtifact = await f.put("studio/data/production/episodes/approved-script-fixture/legacy-storyboard-v1.json", {
    kind: "synthetic-legacy-timed", scenes: episode.scenes, subtitles: episode.subtitles
  });
  const oldTimeline = structuredClone({ scenes: episode.scenes, subtitles: episode.subtitles, durationSeconds: episode.render.durationSeconds });
  episode.production.storyboardDraft = { version: 1, artifactPath: legacyArtifact.path,
    bytes: legacyArtifact.bytes, sha256: legacyArtifact.sha256, versions: [], generationKind: "synthetic-legacy" };
  for (const gate of ["storyboard", "assets", "final"]) {
    episode.approvals[gate] = { ...episode.approvals[gate], status: "approved", currentVersion: 1,
      note: `Synthetic old ${gate} approval`, artifactHash: "c".repeat(64), reviewReportId: `old-${gate}` };
    episode.reviews[gate] = { ...episode.reviews[gate], status: "passed", artifactVersion: 1,
      artifactHash: "c".repeat(64), latestReportId: `old-${gate}`,
      reports: [{ id: `old-${gate}`, stage: gate, decision: "pass", artifactVersion: 1, artifactHash: "c".repeat(64),
        rubricVersion: f.config.stages[gate].version, confidence: 1, blockingIssues: [], warnings: [], passedChecks: ["synthetic-history"] }] };
  }
  await f.deps.writeEpisode(episode);
  f.candidate.candidateVersion = 2;
  await f.put(f.candidatePath, f.candidate);
  const before = await f.deps.readEpisode();
  const request = await f.requestForCurrentState();
  const imported = await f.service.importLocalStoryboard(request, authorization(request));
  const after = await f.deps.readEpisode();
  assert.equal(imported.version, 2);
  assert.deepEqual(upstream(after), upstream(before));
  assert.deepEqual(after.production.storyboardDraft.versions.map(entry => entry.version), [1, 2]);
  assert.deepEqual(after.production.storyboardDraft.versions[0].timelineSnapshot, oldTimeline);
  assert.equal(sha(await readFile(resolve(f.root, legacyArtifact.path))), legacyArtifact.sha256);
  const manifest = JSON.parse(await readFile(resolve(f.root, imported.manifestPath), "utf8"));
  assert.deepEqual(manifest.previousTimeline, oldTimeline);
  assert.deepEqual(after.scenes, []);
  assert.deepEqual(after.subtitles, []);
  assert.equal(after.render.durationSeconds, null);
  for (const gate of ["storyboard", "assets", "final"]) {
    assert.equal(after.approvals[gate].status, "pending", gate);
    assert.equal(after.approvals[gate].artifactHash, null, gate);
    assert.equal(after.reviews[gate].status, "not_started", gate);
    assert.deepEqual(after.reviews[gate].reports, before.reviews[gate].reports, gate);
  }
});

test("pre-commit failure leaves immutable orphan evidence and same request recovers without replacing it", async t => {
  const f = await fixture(t);
  const request = await f.requestForCurrentState();
  const serialized = await readFile(f.episodePath, "utf8");
  const failing = createLocalStoryboardImportService({ ...f.deps,
    writeEpisode: async () => { throw new Error("synthetic pre-commit failure"); } });
  await assert.rejects(failing.importLocalStoryboard(request, authorization(request)), /synthetic pre-commit failure/u);
  assert.equal(await readFile(f.episodePath, "utf8"), serialized);
  const root = resolve(f.root, `studio/data/production/episodes/${request.episodeId}/local-storyboard`);
  const [orphan] = await readdir(root);
  const manifestBefore = await readFile(resolve(root, orphan, "import.json"));
  const artifactBefore = await readFile(resolve(root, orphan, "storyboard-v001.json"));
  const recovered = await f.service.importLocalStoryboard(request, authorization(request));
  assert.equal(recovered.status, "committed");
  assert.deepEqual(await readdir(root), [orphan]);
  assert.deepEqual(await readFile(resolve(f.root, recovered.manifestPath)), manifestBefore);
  assert.deepEqual(await readFile(resolve(f.root, recovered.artifactPath)), artifactBefore);
});

test("real stale-writer CAS preserves concurrent state and requires a freshly bound retry", async t => {
  const f = await fixture(t);
  const request = await f.requestForCurrentState();
  let raced = false;
  const racing = createLocalStoryboardImportService({ ...f.deps, writeEpisode: async candidate => {
    const concurrent = await f.deps.readEpisode();
    concurrent.title = "Synthetic concurrent title update";
    await f.deps.writeEpisode(concurrent);
    raced = true;
    return f.deps.writeEpisode(candidate);
  } });
  await assert.rejects(racing.importLocalStoryboard(request, authorization(request)));
  assert.equal(raced, true);
  const afterRace = await f.deps.readEpisode();
  assert.equal(afterRace.title, "Synthetic concurrent title update");
  assert.equal(afterRace.production.storyboardDraft, undefined);
  const serialized = await readFile(f.episodePath, "utf8");
  await assert.rejects(f.service.importLocalStoryboard(request, authorization(request)), { code: "local_storyboard_snapshot_changed" });
  assert.equal(await readFile(f.episodePath, "utf8"), serialized);
  const refreshed = await f.requestForCurrentState();
  const imported = await f.service.importLocalStoryboard(refreshed, authorization(refreshed));
  assert.equal(imported.version, 1);
  assert.equal((await f.deps.readEpisode()).title, "Synthetic concurrent title update");
  const root = resolve(f.root, `studio/data/production/episodes/${request.episodeId}/local-storyboard`);
  assert.equal((await readdir(root)).length, 2);
});

test("post-commit audit retry retains actual machine report and does not resubmit or reset the draft", async t => {
  const f = await fixture(t);
  const request = await f.requestForCurrentState();
  let failAudit = true;
  const deliveries = [];
  const service = createLocalStoryboardImportService({ ...f.deps, appendEvent: async event => {
    deliveries.push(event);
    if (failAudit) throw new Error("synthetic audit unavailable");
  } });
  const first = await service.importLocalStoryboard(request, authorization(request));
  assert.equal(first.status, "committed_with_warning");
  assert.equal(first.audit.errorCode, "local_storyboard_audit_pending");
  await actualReview(f);
  const serialized = await readFile(f.episodePath, "utf8");
  const reviewCount = (await f.deps.readEpisode()).reviews.storyboard.reports.length;
  failAudit = false;
  const retry = await service.importLocalStoryboard(request, authorization(request));
  assert.equal(retry.status, "already_committed");
  assert.equal(retry.version, first.version);
  assert.equal(await readFile(f.episodePath, "utf8"), serialized);
  assert.equal(deliveries.length, 2);
  assert.equal(deliveries[0].idempotencyKey, deliveries[1].idempotencyKey);
  assert.equal((await f.deps.readEpisode()).reviews.storyboard.reports.length, reviewCount);
});
