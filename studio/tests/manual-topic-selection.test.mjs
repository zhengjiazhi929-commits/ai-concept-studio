import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createManualSelectionService } from "../src/server/trends/manual-selection-core.mjs";
import { manualTopicCapabilitySpec } from "../src/shared/manual-topic-decision.mjs";
import { createCapabilityAuthority, requireSideEffectGrant } from "../src/server/security/side-effect-capability.mjs";
import { createEpisodeWriterCore } from "../src/shared/episode-store-writer-core.mjs";
import { loadPublicDiscoveryAuthorization } from "../scripts/lib/public-discovery-authority.mjs";
import { selectTrendCandidate } from "../src/server/trends/store.mjs";
import { buildResearchPlan } from "../src/server/research/engine.mjs";
import { readResearchConfig } from "../src/server/research/store.mjs";

const authority = () => createCapabilityAuthority({secret: "synthetic-manual-selection-test-secret-only-000000"});
const grant = (request) => ({sideEffectGrant: authority().authorize(manualTopicCapabilitySpec(request))});
const code = (value) => (error) => error.code === value;

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "manual-topic-test-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const trendsRoot = resolve(root, "trends");
  const episodesRoot = resolve(root, "episodes");
  await mkdir(trendsRoot);
  await mkdir(episodesRoot);
  const signal = {id: "signal-1", creatorId: "source-1", title: "Synthetic context evidence", sourceUrl: "https://example.com/context", publishedAt: "2026-09-08T00:00:00Z", datePrecision: "page-date", conceptIds: ["context-memory"], evidence: {excerpt: "Source excerpt", publishedText: "2026-09-08"}};
  const candidate = {id: "context-memory", concept: "Context Memory", recommendedTitle: "Context and memory", recommendedPool: "observation_pool", productionState: "new", score: {score: 71}, signalCount: 1, productDecisions: ["What should enter context?"], primarySources: [], creatorEvidence: [], evidenceSignals: [signal]};
  const run = {id: "trend-fixture", generatedAt: "2026-09-09T00:00:00Z", selectedCandidateId: null, candidates: [candidate]};
  await writeFile(resolve(trendsRoot, "latest.json"), JSON.stringify(run));
  await writeFile(resolve(trendsRoot, "signals.json"), JSON.stringify({signals: [signal]}));
  const episodePath = (id) => resolve(episodesRoot, id, "episode.json");
  const writer = createEpisodeWriterCore({episodeDataDirectory: (id) => resolve(episodesRoot, id), episodeDataPath: episodePath});
  const dependencies = {
    trendsRoot,
    readEpisode: async (id) => JSON.parse(await readFile(episodePath(id), "utf8")),
    writeEpisode: writer.writeEpisode,
    listEpisodes: async (allowMissingEpisodeId) => (await Promise.all((await readdir(episodesRoot)).map(async (id) => {
      try {return await dependencies.readEpisode(id);} catch (error) {
        if (id === allowMissingEpisodeId && error.code === "ENOENT") return null;
        throw error;
      }
    }))).filter(Boolean)
  };
  const service = createManualSelectionService(dependencies);
  const preview = await service.previewManualTopic(candidate.id);
  const request = {candidateId: candidate.id, runId: preview.runId, snapshotHash: preview.snapshotHash, actor: "human:fixture", reason: "Editorial choice despite incomplete trend coverage", confirmManualSelection: true};
  return {root, trendsRoot, episodesRoot, dependencies, service, request, run, candidate, signal, episodePath};
}

test("preview is read-only; manual selection preserves evidence and all pending approvals", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await readdir(f.trendsRoot), ["latest.json", "signals.json"]);
  const before = await readFile(resolve(f.trendsRoot, "latest.json"), "utf8");
  const result = await f.service.approveManualTopic(f.request, grant(f.request));
  assert.equal(result.status, "committed");
  assert.equal(await readFile(resolve(f.trendsRoot, "latest.json"), "utf8"), before);
  const episode = await f.dependencies.readEpisode(result.episodeId);
  assert.equal(episode.trendSelection.selectionMode, "manual");
  assert.equal(episode.trendSelection.manualDecision.originalPool, "observation_pool");
  assert.equal(episode.pipeline.find((step) => step.id === "research").status, "ready");
  assert.ok(Object.values(episode.approvals).every((approval) => approval.status === "pending"));
  assert.equal(episode.research.version, 0);
  assert.equal(episode.production.ai.requestCount, 0);
  const decision = JSON.parse(await readFile(result.decisionPath, "utf8"));
  assert.equal(decision.snapshot.signals[0].evidence.excerpt, f.signal.evidence.excerpt);
  assert.equal(decision.snapshot.run.candidates[0].score.score, 71);
  await assert.rejects(selectTrendCandidate(f.candidate.id, "", {trendsRoot: f.trendsRoot}), /正式候选门槛/u);
});

test("missing, forged and discovery grants cannot write a manual selection", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.approveManualTopic(f.request), code("side_effect_capability_missing"));
  await assert.rejects(f.service.approveManualTopic(f.request, {sideEffectGrant: {}}));
  const discovery = await loadPublicDiscoveryAuthorization({environment: {AI_CONCEPT_STUDIO_OPERATOR_ACTOR: "human:fixture", AI_CONCEPT_STUDIO_OPERATOR_TOKEN: "synthetic-public-operator-token-not-real-000000", AI_CONCEPT_STUDIO_CAPABILITY_SECRET: "synthetic-public-capability-secret-not-real-000000"}});
  await assert.rejects(f.service.approveManualTopic(f.request, discovery.forOperation("trend:run")));
  assert.deepEqual(await readdir(f.episodesRoot), []);
  assert.deepEqual(await readdir(f.trendsRoot), ["latest.json", "signals.json"]);
});

test("all request fields are signed; manual grants cannot be reused at other sinks", async (t) => {
  const f = await fixture(t);
  for (const [field, value] of Object.entries({candidateId: "other", runId: "other", snapshotHash: "a".repeat(64), actor: "human:other", reason: "Different editorial reason"})) {
    await assert.rejects(f.service.approveManualTopic({...f.request, [field]: value}, grant(f.request)), code("side_effect_capability_episode_mismatch"));
  }
  const options = grant(f.request);
  for (const sink of [undefined, "research:run", "trend:approve-candidate", "trend:run"]) {
    assert.throws(() => requireSideEffectGrant(options, manualTopicCapabilitySpec(f.request), sink), code("manual_topic_sink_forbidden"));
  }
});

test("rejects unknown parameters, missing confirmation, unsafe IDs and empty reason", async (t) => {
  const f = await fixture(t);
  for (const request of [{...f.request, extra: true}, {...f.request, confirmManualSelection: false}, {...f.request, candidateId: "../escape"}, {...f.request, reason: " "}, {...f.request, actor: "agent:fixture"}]) {
    assert.throws(() => manualTopicCapabilitySpec(request), code("manual_topic_request_invalid"));
  }
});

test("run and raw evidence drift require another preview without creating an Episode", async (t) => {
  const f = await fixture(t);
  await writeFile(resolve(f.trendsRoot, "signals.json"), JSON.stringify({signals: [{...f.signal, evidence: {excerpt: "Changed"}}]}));
  await assert.rejects(f.service.approveManualTopic(f.request, grant(f.request)), code("manual_topic_snapshot_changed"));
  assert.deepEqual(await readdir(f.episodesRoot), []);
  await writeFile(resolve(f.trendsRoot, "signals.json"), JSON.stringify({signals: []}));
  await assert.rejects(f.service.previewManualTopic(f.candidate.id), code("manual_topic_evidence_missing"));
});

test("retry and concurrent calls create only one Episode and preserve later progress", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([1, 2].map(() => f.service.approveManualTopic(f.request, grant(f.request))));
  assert.equal(new Set(results.map((result) => result.episodeId)).size, 1);
  assert.equal((await readdir(f.episodesRoot)).length, 1);
  const episode = await f.dependencies.readEpisode(results[0].episodeId);
  episode.research.status = "human-work-in-progress";
  await f.dependencies.writeEpisode(episode);
  const before = await readFile(f.episodePath(episode.id), "utf8");
  assert.equal((await f.service.approveManualTopic(f.request, grant(f.request))).status, "already_committed");
  assert.equal(await readFile(f.episodePath(episode.id), "utf8"), before);
});

test("recover durable intent after Episode writer failure; do not invent success", async (t) => {
  const f = await fixture(t);
  const broken = createManualSelectionService({...f.dependencies, writeEpisode: async () => {throw Object.assign(new Error("synthetic write failure"), {code: "synthetic_write_failure"});}});
  await assert.rejects(broken.approveManualTopic(f.request, grant(f.request)), code("synthetic_write_failure"));
  assert.deepEqual(await readdir(f.episodesRoot), []);
  const result = await f.service.approveManualTopic(f.request, grant(f.request));
  assert.equal(result.status, "committed");
  assert.equal((await readdir(f.episodesRoot)).length, 1);
});

test("retry recovers after real writer creates the target directory but no episode.json", async (t) => {
  const f = await fixture(t);
  const interrupted = createManualSelectionService({...f.dependencies, writeEpisode: async (episode) => {
    await mkdir(resolve(f.episodesRoot, episode.id), {recursive: true});
    throw Object.assign(new Error("directory created before failure"), {code: "synthetic_write_failure"});
  }});
  await assert.rejects(interrupted.approveManualTopic(f.request, grant(f.request)), code("synthetic_write_failure"));
  const result = await f.service.approveManualTopic(f.request, grant(f.request));
  assert.equal(result.status, "committed");
  assert.equal((await readdir(f.episodesRoot)).length, 1);
});

test("an existing formal reservation prevents manual duplication even before its Episode exists", async (t) => {
  const f = await fixture(t);
  await writeFile(resolve(f.trendsRoot, "selection.json"), JSON.stringify({candidateId: f.request.candidateId, episodeId: "formal-pending-episode"}));
  await assert.rejects(f.service.approveManualTopic(f.request, grant(f.request)), code("manual_topic_already_in_production"));
  assert.deepEqual(await readdir(f.episodesRoot), []);
});

test("an existing manual selection prevents the formal path from duplicating its concept", async (t) => {
  const f = await fixture(t);
  const run = {...f.run, candidates: [{...f.candidate, recommendedPool: "formal_candidate"}]};
  await writeFile(resolve(f.trendsRoot, "latest.json"), JSON.stringify(run));
  const preview = await f.service.previewManualTopic(f.request.candidateId);
  const request = {...f.request, snapshotHash: preview.snapshotHash};
  await f.service.approveManualTopic(request, grant(request));
  await assert.rejects(selectTrendCandidate(request.candidateId, "", {trendsRoot: f.trendsRoot}), code("manual_topic_already_in_production"));
  await writeFile(resolve(f.trendsRoot, "selection.json"), JSON.stringify({candidateId: "another-topic", episodeId: "another-episode"}));
  await assert.rejects(selectTrendCandidate(request.candidateId, "", {trendsRoot: f.trendsRoot}), code("manual_topic_already_in_production"));
  const [decisionName] = await readdir(resolve(f.trendsRoot, "manual-selections"));
  const decisionPath = resolve(f.trendsRoot, "manual-selections", decisionName);
  const decision = JSON.parse(await readFile(decisionPath, "utf8"));
  decision.request.candidateId = "another-topic";
  decision.selection.candidateId = "another-topic";
  await writeFile(decisionPath, JSON.stringify(decision));
  await assert.rejects(selectTrendCandidate(request.candidateId, "", {trendsRoot: f.trendsRoot}), code("manual_topic_decision_conflict"));
});

test("different decision cannot duplicate an existing concept", async (t) => {
  const f = await fixture(t);
  await f.service.approveManualTopic(f.request, grant(f.request));
  const other = {...f.request, reason: "Another request for the same concept"};
  await assert.rejects(f.service.approveManualTopic(other, grant(other)), code("manual_topic_already_in_production"));
  assert.equal((await readdir(f.episodesRoot)).length, 1);
});

test("manual provenance survives into the research pack without implying heat qualification", async (t) => {
  const f = await fixture(t);
  const result = await f.service.approveManualTopic(f.request, grant(f.request));
  const episode = await f.dependencies.readEpisode(result.episodeId);
  const pack = buildResearchPlan({episode, config: await readResearchConfig()});
  assert.equal(pack.selection.selectionMode, "manual");
  assert.deepEqual(pack.selection.manualDecision, episode.trendSelection.manualDecision);
  assert.equal(pack.selection.manualDecision.automaticThresholdPassed, false);
});

test("committed Episode with failed pointer publication reports warning then recovers without rewriting", async (t) => {
  const f = await fixture(t);
  const pointer = resolve(f.trendsRoot, "selection.json");
  const interrupted = createManualSelectionService({...f.dependencies, writeEpisode: async (episode) => {
    await f.dependencies.writeEpisode(episode);
    await mkdir(pointer);
  }});
  const first = await interrupted.approveManualTopic(f.request, grant(f.request));
  assert.equal(first.status, "committed_with_warning");
  const before = await readFile(f.episodePath(first.episodeId), "utf8");
  await rmdir(pointer);
  const resumed = await f.service.approveManualTopic(f.request, grant(f.request));
  assert.equal(resumed.status, "already_committed");
  assert.equal(await readFile(f.episodePath(first.episodeId), "utf8"), before);
  assert.equal(JSON.parse(await readFile(pointer, "utf8")).episodeId, first.episodeId);
});

test("resume uses immutable evidence when Radar later changes; old selection cannot replace a newer selection", async (t) => {
  const f = await fixture(t);
  const first = await f.service.approveManualTopic(f.request, grant(f.request));
  await writeFile(resolve(f.trendsRoot, "latest.json"), JSON.stringify({...f.run, id: "new-run", candidates: []}));
  const retry = await f.service.approveManualTopic(f.request, grant(f.request));
  assert.equal(retry.episodeId, first.episodeId);
  const pointer = resolve(f.trendsRoot, "selection.json");
  await writeFile(pointer, JSON.stringify({episodeId: "a-later-episode"}));
  const before = await readFile(pointer, "utf8");
  assert.equal((await f.service.approveManualTopic(f.request, grant(f.request))).status, "committed_selection_superseded");
  assert.equal(await readFile(pointer, "utf8"), before);
});

test("invalid stored decisions and occupied Episode IDs fail closed", async (t) => {
  const f = await fixture(t);
  const first = await f.service.approveManualTopic(f.request, grant(f.request));
  const episode = await f.dependencies.readEpisode(first.episodeId);
  episode.conceptId = "another-concept";
  await writeFile(f.episodePath(episode.id), JSON.stringify(episode));
  await assert.rejects(f.service.approveManualTopic(f.request, grant(f.request)), code("manual_topic_episode_conflict"));
  const decision = JSON.parse(await readFile(first.decisionPath, "utf8"));
  decision.snapshot.signals[0].evidence.excerpt = "corrupted";
  await writeFile(first.decisionPath, JSON.stringify(decision));
  await assert.rejects(f.service.approveManualTopic(f.request, grant(f.request)), code("manual_topic_decision_conflict"));
});

test("matching decision ID does not hide a corrupted pointer or Episode selection provenance", async (t) => {
  const f = await fixture(t);
  const result = await f.service.approveManualTopic(f.request, grant(f.request));
  const pointerPath = resolve(f.trendsRoot, "selection.json");
  const originalPointer = await readFile(pointerPath, "utf8");
  await writeFile(pointerPath, JSON.stringify({...JSON.parse(originalPointer), episodeId: "wrong-episode"}));
  await assert.rejects(f.service.approveManualTopic(f.request, grant(f.request)), code("manual_topic_selection_conflict"));
  await writeFile(pointerPath, originalPointer);
  const episode = await f.dependencies.readEpisode(result.episodeId);
  episode.trendSelection.evidenceSignals[0].sourceUrl = "https://example.com/changed";
  await writeFile(f.episodePath(result.episodeId), JSON.stringify(episode));
  await assert.rejects(f.service.approveManualTopic(f.request, grant(f.request)), code("manual_topic_episode_conflict"));
});
