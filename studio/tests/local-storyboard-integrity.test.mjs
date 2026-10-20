import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, basename } from "node:path";
import { assertCurrentApprovalArtifactIntegrity } from "../src/server/reviews/approval-artifact-integrity.mjs";

test("local storyboard approval integrity checks inline content AND both immutable files", async t => {
  const root = await mkdtemp(resolve(tmpdir(), "storyboard-integrity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hash = body => createHash("sha256").update(body).digest("hex");
  const content = { title: "Synthetic editorial document", shots: [] };
  const body = JSON.stringify(content, null, 2) + "\n";
  const manifest = JSON.stringify({ kind: "synthetic-import" }) + "\n";
  await writeFile(resolve(root, "board.json"), body);
  await writeFile(resolve(root, "manifest.json"), manifest);
  const episode = { production: { storyboardDraft: { generationKind: "codex-local-storyboard-import", content,
    artifactPath: "studio/data/production/episodes/synthetic/board.json", sha256: hash(body), bytes: Buffer.byteLength(body),
    manifestPath: "studio/data/production/episodes/synthetic/manifest.json", manifestSha256: hash(manifest), manifestBytes: Buffer.byteLength(manifest) } } };
  const visited = [];
  const options = { resolveExistingPathInside: async (_root, path) => resolve(root, basename(path)),
    inspectFileIntegrity: async path => { visited.push(basename(path)); const value = await readFile(path); return { bytes: (await stat(path)).size, sha256: hash(value) }; } };
  await assertCurrentApprovalArtifactIntegrity(episode, "storyboard", options);
  assert.deepEqual(visited.sort(), ["board.json", "manifest.json"]);
  episode.production.storyboardDraft.content.title = "Tampered inline title";
  await assert.rejects(assertCurrentApprovalArtifactIntegrity(episode, "storyboard", options), { code: "storyboard_approval_inline_integrity_mismatch" });
  episode.production.storyboardDraft.content.title = "Synthetic editorial document";
  await writeFile(resolve(root, "manifest.json"), "tampered");
  await assert.rejects(assertCurrentApprovalArtifactIntegrity(episode, "storyboard", options), { code: "storyboard_approval_artifact_integrity_mismatch" });
});
