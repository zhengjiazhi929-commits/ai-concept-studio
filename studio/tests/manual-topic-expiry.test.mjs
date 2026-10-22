import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, writeFile, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {createManualSelectionService} from "../src/server/trends/manual-selection-core.mjs";
import {manualTopicCapabilitySpec} from "../src/shared/manual-topic-decision.mjs";
import {createCapabilityAuthority} from "../src/server/security/side-effect-capability.mjs";
import {createEpisodeWriterCore} from "../src/shared/episode-store-writer-core.mjs";
import {jsonDocumentContentSha256, withDurableJsonStoreLock} from "../src/shared/durable-json-store.mjs";

const expired = (error) => error.code === "side_effect_capability_expired";
const missing = (error) => error.code === "ENOENT";
const ttlMs = 300000;

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "manual-topic-expiry-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const trendsRoot = resolve(root, "trends");
  const episodesRoot = resolve(root, "episodes");
  await mkdir(trendsRoot);
  await mkdir(episodesRoot);
  const signal = {id: "synthetic-signal", creatorId: "synthetic-source", title: "Synthetic context evidence",
    sourceUrl: "https://example.com/synthetic", publishedAt: "2026-10-20T00:00:00Z",
    datePrecision: "page-date", conceptIds: ["context-memory"]};
  const candidate = {id: "context-memory", concept: "Synthetic Context Memory", recommendedTitle: "Synthetic context and memory",
    recommendedPool: "observation_pool", productionState: "new", score: {score: 71}, signalCount: 1,
    primarySources: [], creatorEvidence: [], evidenceSignals: [signal]};
  const run = {id: "synthetic-trend", generatedAt: "2026-10-20T01:00:00Z", candidates: [candidate]};
  await writeFile(resolve(trendsRoot, "latest.json"), JSON.stringify(run));
  await writeFile(resolve(trendsRoot, "signals.json"), JSON.stringify({signals: [signal]}));
  const episodePath = (id) => resolve(episodesRoot, id, "episode.json");
  const writer = createEpisodeWriterCore({episodeDataDirectory: (id) => resolve(episodesRoot, id), episodeDataPath: episodePath});
  let clock = Date.parse("2026-10-21T00:00:00Z");
  let observeClock = null;
  const authority = createCapabilityAuthority({secret: "synthetic-manual-expiry-test-secret-only-000000",
    now: () => {observeClock?.(); return clock;}, defaultTtlMs: ttlMs, maximumTtlMs: ttlMs});
  let episodeWrites = 0;
  const dependencies = {
    trendsRoot,
    readEpisode: async (id) => JSON.parse(await readFile(episodePath(id), "utf8")),
    writeEpisode: async (episode) => {episodeWrites++; return writer.writeEpisode(episode);},
    listEpisodes: async (allowMissingEpisodeId) => (await Promise.all((await readdir(episodesRoot)).map(async (id) => {
      try {return await dependencies.readEpisode(id);} catch (error) {
        if (id === allowMissingEpisodeId && error.code === "ENOENT") return null;
        throw error;
      }
    }))).filter(Boolean)
  };
  const service = createManualSelectionService(dependencies);
  const preview = await service.previewManualTopic(candidate.id);
  const request = {candidateId: candidate.id, runId: preview.runId, snapshotHash: preview.snapshotHash,
    actor: "human:synthetic", reason: "Synthetic expiry regression only", confirmManualSelection: true};
  return {trendsRoot, episodesRoot, episodePath, writer, dependencies, service, request,
    grant: () => ({sideEffectGrant: authority.authorize(manualTopicCapabilitySpec(request))}),
    expire: () => {clock += ttlMs + 1;}, observeClock: (callback) => {observeClock = callback;},
    episodeWrites: () => episodeWrites};
}

async function assertNoEpisodeOrPointer(f) {
  assert.deepEqual(await readdir(f.episodesRoot), []);
  await assert.rejects(readFile(resolve(f.trendsRoot, "selection.json")), missing);
  assert.equal(f.episodeWrites(), 0);
}

test("expired entry grant cannot create lock, intent, Episode or pointer", async (t) => {
  const f = await fixture(t);
  const options = f.grant(); f.expire();
  await assert.rejects(f.service.approveManualTopic(f.request, options), expired);
  assert.deepEqual((await readdir(f.trendsRoot)).sort(), ["latest.json", "signals.json"]);
  await assertNoEpisodeOrPointer(f);
});

test("expiry while waiting for the store lock cannot recover a pending publication or start new writes", async (t) => {
  const f = await fixture(t);
  const journalPath = resolve(f.trendsRoot, ".trend-publication.json");
  const pending = {candidateId: "other-synthetic-topic", episodeId: "other-synthetic-episode"};
  const journal = JSON.stringify({schemaVersion: 1, publicationId: "synthetic-pending-publication",
    documents: [{targetPath: "selection.json", sha256: jsonDocumentContentSha256(pending), value: pending}]});
  await writeFile(journalPath, journal);
  let releaseLock;
  let lockEntered;
  const held = new Promise((resolve) => {lockEntered = resolve;});
  const release = new Promise((resolve) => {releaseLock = resolve;});
  const holder = withDurableJsonStoreLock(f.trendsRoot, {}, async () => {lockEntered(); await release;});
  await held;
  try {
    const options = f.grant();
    let checked;
    const entryChecked = new Promise((resolve) => {checked = resolve;});
    f.observeClock(checked);
    const approval = f.service.approveManualTopic(f.request, options);
    const rejection = assert.rejects(approval, expired);
    await entryChecked;
    f.expire(); releaseLock(); await holder;
    await rejection;
  } finally {releaseLock(); await holder;}
  assert.equal(await readFile(journalPath, "utf8"), journal);
  await assert.rejects(readdir(resolve(f.trendsRoot, "manual-selections")), missing);
  await assertNoEpisodeOrPointer(f);
  const resumed = await f.service.approveManualTopic(f.request, f.grant());
  assert.equal(resumed.status, "committed"); assert.equal(f.episodeWrites(), 1);
  await assert.rejects(readFile(journalPath), missing);
  assert.equal(JSON.parse(await readFile(resolve(f.trendsRoot, "selection.json"), "utf8")).episodeId, resumed.episodeId);
});

test("expiry during the first Episode scan cannot persist a new immutable intent", async (t) => {
  const f = await fixture(t);
  const service = createManualSelectionService({...f.dependencies, listEpisodes: async (...args) => {
    const episodes = await f.dependencies.listEpisodes(...args); f.expire(); return episodes;
  }});
  await assert.rejects(service.approveManualTopic(f.request, f.grant()), expired);
  await assert.rejects(readdir(resolve(f.trendsRoot, "manual-selections")), missing);
  await assertNoEpisodeOrPointer(f);
});

test("expiry during the second Episode scan preserves intent but cannot write Episode; fresh grant resumes it", async (t) => {
  const f = await fixture(t); let scans = 0;
  const service = createManualSelectionService({...f.dependencies, listEpisodes: async (...args) => {
    const episodes = await f.dependencies.listEpisodes(...args);
    if (++scans === 2) f.expire();
    return episodes;
  }});
  await assert.rejects(service.approveManualTopic(f.request, f.grant()), expired);
  await assertNoEpisodeOrPointer(f);
  const decisionDirectory = resolve(f.trendsRoot, "manual-selections");
  const names = await readdir(decisionDirectory); assert.equal(names.length, 1);
  const decisionPath = resolve(decisionDirectory, names[0]);
  const before = await readFile(decisionPath, "utf8");
  const result = await f.service.approveManualTopic(f.request, f.grant());
  assert.equal(result.status, "committed"); assert.equal(f.episodeWrites(), 1);
  assert.equal(await readFile(decisionPath, "utf8"), before);
});

test("expiry after Episode commit reports pending pointer and retry preserves all later Episode state", async (t) => {
  const f = await fixture(t);
  const service = createManualSelectionService({...f.dependencies, writeEpisode: async (episode) => {
    const path = await f.dependencies.writeEpisode(episode); f.expire(); return path;
  }});
  const result = await service.approveManualTopic(f.request, f.grant());
  assert.equal(result.status, "committed_with_warning");
  assert.equal(result.warning, "selection_pointer_pending");
  assert.equal(result.errorCode, "side_effect_capability_expired");
  await assert.rejects(readFile(resolve(f.trendsRoot, "selection.json")), missing);
  assert.equal(f.episodeWrites(), 1);
  const later = await f.dependencies.readEpisode(result.episodeId);
  assert.ok(Object.values(later.approvals).every((approval) => approval.status === "pending"));
  later.title = "Subsequent human edit must survive pointer recovery";
  later.history.push({at: "2026-10-21T01:00:00Z", type: "synthetic-later-note", message: "Preserve this later state"});
  await f.writer.writeEpisode(later);
  const bytes = await readFile(f.episodePath(result.episodeId), "utf8");
  const retry = await f.service.approveManualTopic(f.request, f.grant());
  assert.equal(retry.status, "already_committed"); assert.equal(retry.episodeId, result.episodeId);
  assert.equal(f.episodeWrites(), 1);
  assert.equal(await readFile(f.episodePath(result.episodeId), "utf8"), bytes);
  assert.deepEqual(JSON.parse(await readFile(resolve(f.trendsRoot, "selection.json"), "utf8")), result.selection);
});

test("the operation retains its entry grant instead of invoking a callback again to renew expired authority", async (t) => {
  const f = await fixture(t); let authorizations = 0;
  const service = createManualSelectionService({...f.dependencies, listEpisodes: async (...args) => {
    const episodes = await f.dependencies.listEpisodes(...args); f.expire(); return episodes;
  }});
  await assert.rejects(service.approveManualTopic(f.request, {authorizeSideEffect: () => {
    authorizations++; return f.grant().sideEffectGrant;
  }}), expired);
  assert.equal(authorizations, 1);
  await assertNoEpisodeOrPointer(f);
});
