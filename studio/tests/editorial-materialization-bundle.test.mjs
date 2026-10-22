import test from "node:test";
import assert from "node:assert/strict";
import {readFile, writeFile, symlink, rm, lstat, mkdir} from "node:fs/promises";
import filesystem from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {resolve} from "node:path";
import {approvedStoryboardFixture} from "./approved-storyboard-fixture.mjs";
import {seedEditorialBundleImplementationFixture} from "./editorial-materialization-fixture.mjs";
import {inspectEditorialCodeImplementation} from "../src/server/production/editorial-code-implementation.mjs";
import {buildEditorialAssetPlan} from "../src/server/production/editorial-asset-plan.mjs";
import {buildAssetExecutionCheckpoint, approveAssetExecutionCandidate} from "../src/server/reviews/asset-execution-checkpoint.mjs";
import {createCapabilityAuthority} from "../src/server/security/side-effect-capability.mjs";
import {canonicalJsonDocumentContentSha256 as digest} from "../src/shared/durable-json-store.mjs";
import {editorialAssetsMaterializeCapabilitySpec} from "../src/shared/editorial-assets-materialize-request.mjs";
import {buildEditorialMaterializationBundle} from "../src/server/production/editorial-materialization-bundle.mjs";
import {verifyEditorialMaterializationBundle, editorialMaterializationInputProps,
  editorialMaterializationDirectory} from "../src/server/production/editorial-materialization-integrity.mjs";
import {createEditorialMaterializationSnapshotCore, verifyRegisteredEditorialMaterialization} from "../src/server/production/editorial-materialization-consumption.mjs";
import {currentGateArtifactHash} from "../src/shared/workflow.mjs";
import {approvalValidForGate} from "../src/server/control/policy-engine.mjs";

const authority = createCapabilityAuthority({secret: "synthetic-materialization-bundle-00000000000000000000",
  now: () => Date.parse("2026-09-13T12:00:00.000Z")});

test("editorial bundle really compiles offline with font files and approved logo without rendering", {timeout: 600000}, async t => {
  const f = await approvedStoryboardFixture(t);
  const seeded = await seedEditorialBundleImplementationFixture(f.root);
  await f.put("studio/config/review-rubrics.json", f.config);
  const implementation = await inspectEditorialCodeImplementation({workspaceRoot: f.root});
  const plan = buildEditorialAssetPlan(f.episode, {sourceStoryboard: {
    artifactVersion: f.episode.production.storyboardDraft.version,
    artifactHash: f.episode.approvals.storyboard.artifactHash,
    reviewReportId: f.episode.approvals.storyboard.reviewReportId,
    artifactPath: f.episode.production.storyboardDraft.artifactPath,
    artifactSha256: f.episode.production.storyboardDraft.sha256,
    manifestPath: f.episode.production.storyboardDraft.manifestPath,
    manifestSha256: f.episode.production.storyboardDraft.manifestSha256
  }, implementation});
  const artifactPath = `studio/data/production/episodes/${f.episode.id}/synthetic-materialize-plan.json`;
  await f.put(artifactPath, {episodeId: f.episode.id, plan});
  const episode = structuredClone(f.episode);
  episode.production.assetPlan = {version: 1, artifactPath, content: plan};
  const options = {...f.deps, workspaceRoot: f.root, reviewConfig: f.config, actor: "human:synthetic-materializer"};
  const reviewed = await buildAssetExecutionCheckpoint(episode, {artifactPath, version: 1}, options);
  assert.equal(reviewed.inspected.passed, true);
  episode.reviewCheckpoints.assetExecution = reviewed.checkpoint;
  await f.deps.writeEpisode(episode);
  const {episode: approved} = await approveAssetExecutionCandidate(episode.id, {
    candidateHash: reviewed.checkpoint.currentCandidate.candidateHash,
    machineReviewId: reviewed.checkpoint.machineReview.id, note: "Synthetic local bundle only"
  }, options);
  const request = {episodeId: approved.id, snapshotHash: "1".repeat(64),
    candidateHash: reviewed.checkpoint.currentCandidate.candidateHash,
    machineReviewId: reviewed.checkpoint.machineReview.id,
    implementationHash: implementation.sha256, actor: "human:synthetic-materializer",
    reason: "Produce an isolated synthetic local bundle only", confirmEditorialAssetsMaterialization: true};
  const input = {workspaceRoot: f.root, episode: approved, operationId: digest(request), request};
  await assert.rejects(buildEditorialMaterializationBundle(input), {code: "side_effect_capability_missing"});
  const authorization = {sideEffectGrant: authority.authorize(editorialAssetsMaterializeCapabilitySpec(request))};
  const before = JSON.stringify(approved);
  const built = await buildEditorialMaterializationBundle({...input, ...authorization});
  assert.equal(JSON.stringify(approved), before);
  assert.equal(built.manifest.rendered, false);
  assert.equal(built.manifest.voice.status, "deferred");
  assert.equal(built.manifest.externalApiCalls, 0);
  assert.equal(built.assetRecords.length, plan.items.length);
  assert.ok(built.manifest.files.some(file => file.path.startsWith("bundle/") && file.path.endsWith(".js") && file.bytes > 1000));
  assert.ok(built.manifest.files.some(file => file.path.endsWith("wght.css")));
  assert.equal(built.manifest.files.filter(file => file.role === "approved-logo-frame").length, 120);
  assert.equal(built.manifest.files.filter(file => file.role === "font-license").length, 1);
  assert.ok(built.manifest.files.some(file => file.path.startsWith("bundle/") && file.path.endsWith(".woff2")));
  assert.ok(built.assetRecords.every(asset => asset.path.endsWith("/bundle/index.html") && asset.componentId === "EditorialMotionPreview"));
  const verifyInput = {workspaceRoot: f.root, episode: approved, receipt: built.receipt};
  const verified = await verifyEditorialMaterializationBundle(verifyInput);
  assert.deepEqual(verified.inputProps, editorialMaterializationInputProps(approved));
  assert.deepEqual((await buildEditorialMaterializationBundle({...input, ...authorization})).receipt, built.receipt);

  await t.test("renderer snapshot consumes registered nested bytes and removes only its own temporary tree", async () => {
    const registered = structuredClone(approved);
    registered.production.editorialMaterialization = built.receipt;
    registered.assets = built.assetRecords;
    const snapshot = await createEditorialMaterializationSnapshotCore({workspaceRoot: f.root, episode: registered});
    assert.deepEqual(snapshot.inputProps, editorialMaterializationInputProps(approved));
    assert.equal(snapshot.rendered, false);
    const permanent = resolve(f.root, built.receipt.bundlePath, "index.html");
    assert.deepEqual(await readFile(resolve(snapshot.serveUrl, "index.html")), await readFile(permanent));
    assert.equal(await snapshot.cleanup(), true);
    assert.equal(await snapshot.cleanup(), false);
    await assert.rejects(lstat(snapshot.temporaryRoot), {code: "ENOENT"});
    assert.equal((await lstat(permanent)).isFile(), true);
    const js = built.manifest.files.find(file => file.path.startsWith("bundle/") && file.path.endsWith(".js"));
    const jsPath = resolve(f.root, built.receipt.directory, js.path);
    const original = await readFile(jsPath);
    await writeFile(jsPath, Buffer.concat([original, Buffer.from("\n// changed\n")]));
    await assert.rejects(createEditorialMaterializationSnapshotCore({workspaceRoot: f.root, episode: registered}));
    await writeFile(jsPath, original);
  });
  await t.test("only hash-bound synthetic Gate 4 bookkeeping may add verified acceptance fields", async () => {
    const registered = structuredClone(approved);
    registered.production.editorialMaterialization = built.receipt;
    registered.production.assetBundleRevision = 2;
    registered.assets = structuredClone(built.assetRecords).map(asset => ({...asset, verified: true, verifiedAt: "2026-09-13T12:00:00.000Z"}));
    await assert.rejects(verifyRegisteredEditorialMaterialization({workspaceRoot: f.root, episode: registered}),
      {code: "editorial_materialization_registration_changed"});
    // Synthetic policy bookkeeping only. This does not manufacture physical
    // audio evidence or run/approve an actual production assets/voice Gate.
    const artifactHash = currentGateArtifactHash(registered, "assets");
    const report = {...structuredClone(registered.reviews.storyboard.reports.at(-1)),
      id: "synthetic-assets-policy-only", stage: "assets", rubricVersion: f.config.stages.assets.version,
      decision: "pass", artifactVersion: 2, artifactHash};
    registered.reviews.assets = {...registered.reviews.assets, status: "passed", artifactVersion: 2,
      artifactHash, latestReportId: report.id, reports: [report]};
    registered.approvals.assets = {...registered.approvals.assets, status: "approved", currentVersion: 2,
      artifactHash, reviewReportId: report.id, provenance: "reviewed-v2"};
    assert.equal(approvalValidForGate(registered, "assets"), true);
    const accepted = await verifyRegisteredEditorialMaterialization({workspaceRoot: f.root, episode: registered});
    assert.deepEqual(accepted.assetRecords, built.assetRecords);
    registered.assets[0].rights.license = "changed";
    await assert.rejects(verifyRegisteredEditorialMaterialization({workspaceRoot: f.root, episode: registered}));
  });

  await t.test("body, file set and missing file tampering all fail closed", async () => {
    const js = built.manifest.files.find(file => file.path.startsWith("bundle/") && file.path.endsWith(".js"));
    const path = resolve(f.root, built.receipt.directory, js.path);
    const original = await readFile(path);
    await writeFile(path, Buffer.concat([original, Buffer.from("\n// drift\n")]));
    await assert.rejects(verifyEditorialMaterializationBundle(verifyInput), {code: "editorial_materialization_integrity_changed"});
    await writeFile(path, original);
    const extra = resolve(f.root, built.receipt.directory, "unexpected.txt");
    await writeFile(extra, "unexpected");
    await assert.rejects(verifyEditorialMaterializationBundle(verifyInput), {code: "editorial_materialization_integrity_changed"});
    await rm(extra);
    const logo = built.manifest.files.find(file => file.role === "approved-logo-frame");
    const logoPath = resolve(f.root, built.receipt.directory, logo.path);
    const logoBytes = await readFile(logoPath);
    await rm(logoPath);
    await assert.rejects(verifyEditorialMaterializationBundle(verifyInput), {code: "editorial_materialization_integrity_changed"});
    await writeFile(logoPath, logoBytes);
  });
  await t.test("partial staging is not a receipt and an occupied invalid destination is never overwritten", async () => {
    const other = {...request, reason: "A different synthetic immutable operation"};
    const operationId = digest(other);
    const directory = editorialMaterializationDirectory(approved.id, operationId);
    const staging = resolve(f.root, directory, "..", ".building-orphan", "output");
    await mkdir(staging, {recursive: true});
    await writeFile(resolve(staging, "materialization.json"), "{\"unfinished\":true}\n");
    await assert.rejects(verifyEditorialMaterializationBundle({...verifyInput, receipt: {...built.receipt,
      operationId, directory, request: other, manifestPath: `${directory}/materialization.json`}}));
    const destination = resolve(f.root, directory);
    await mkdir(destination);
    await writeFile(resolve(destination, "preserve.txt"), "Do not overwrite interrupted output");
    await assert.rejects(buildEditorialMaterializationBundle({...input, request: other, operationId,
      sideEffectGrant: authority.authorize(editorialAssetsMaterializeCapabilitySpec(other))}));
    assert.equal(await readFile(resolve(destination, "preserve.txt"), "utf8"), "Do not overwrite interrupted output");
    assert.equal(await readFile(resolve(staging, "materialization.json"), "utf8"), "{\"unfinished\":true}\n");
  });
  await t.test("symlink, candidate, input props and receipt drift reject", async () => {
    const file = built.manifest.files.find(file => file.role === "font-license");
    const path = resolve(f.root, built.receipt.directory, file.path);
    const bytes = await readFile(path);
    await rm(path); await symlink(resolve(f.root, "studio/package.json"), path);
    await assert.rejects(verifyEditorialMaterializationBundle(verifyInput), {code: "editorial_materialization_path_unsafe"});
    await rm(path); await writeFile(path, bytes);
    const changed = structuredClone(approved); changed.scenes[0].title = "Changed scene";
    await assert.rejects(verifyEditorialMaterializationBundle({...verifyInput, episode: changed}));
    await assert.rejects(verifyEditorialMaterializationBundle({...verifyInput, receipt: {...built.receipt, externalApiCalls: 1}}));
    const unapproved = structuredClone(approved); unapproved.reviewCheckpoints.assetExecution.humanApproval = null;
    await assert.rejects(verifyEditorialMaterializationBundle({...verifyInput, episode: unapproved}));
    await seeded.put("studio/src/video/synthetic-transitive.mjs", "export const sample=2;\n");
    await assert.rejects(verifyEditorialMaterializationBundle(verifyInput));
    await seeded.put("studio/src/video/synthetic-transitive.mjs", "export const sample = 1;\n");
  });
  await t.test("source change during the late output read is not hidden by an earlier approval check", async () => {
    const originalRead = filesystem.readFile;
    let mutated = false;
    const mocked = t.mock.method(filesystem, "readFile", async (...args) => {
      if (!mutated && String(args[0]).endsWith(`/${built.receipt.inputPropsPath}`)) {
        mutated = true;
        await seeded.put("studio/src/video/synthetic-transitive.mjs", "export const sample=3;\n");
      }
      return originalRead(...args);
    });
    syncBuiltinESMExports();
    try {
      const verification = verifyEditorialMaterializationBundle(verifyInput);
      await assert.rejects(verification);
      assert.equal(mutated, true);
    } finally {
      mocked.mock.restore(); syncBuiltinESMExports();
      await seeded.put("studio/src/video/synthetic-transitive.mjs", "export const sample = 1;\n");
      assert.equal(mutated, true, "The injected late source mutation must actually occur");
    }
  });
});

test("render input projection excludes private state and does not alter its source", () => {
  const scene = {id: "S1", title: "合成", startFrame: 0, endFrame: 30, narration: "只读", motionPlan: {objects: []}, secret: "not-for-bundle"};
  const episode = {id: "synthetic-input", title: "Title", scenes: [scene], subtitles: [{id: "c1", sceneId: "S1", text: "只读", startFrame: 0, endFrame: 30, privateField: "omit"}],
    render: {compositionId: "ConceptPreview", width: 1920, height: 1080, fps: 30, durationSeconds: 1, outputPath: "private"},
    control: {secret: "never-copy"}, production: {secret: "never-copy"}, research: {secret: "never-copy"}};
  const projected = editorialMaterializationInputProps(episode);
  assert.deepEqual(Object.keys(projected.episode).sort(), ["id", "render", "scenes", "subtitles", "title"]);
  assert.equal(JSON.stringify(projected).includes("private"), false);
  assert.equal(JSON.stringify(projected).includes("never-copy"), false);
  projected.episode.scenes[0].title = "Changed copy";
  assert.equal(scene.title, "合成");
});
