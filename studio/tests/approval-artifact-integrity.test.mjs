import assert from "node:assert/strict";
import test from "node:test";

import { assertCurrentApprovalArtifactIntegrity } from
  "../src/server/reviews/approval-artifact-integrity.mjs";

function episodeWithDraft(gate, draft) {
  return {
    research: gate === "research" ? { packPath: draft.path } : null,
    sourceDocs: gate === "research" ? [draft] : [],
    production: {
      scriptDraft: gate === "script" ? draft : null,
      storyboardDraft: gate === "storyboard" ? draft : null
    }
  };
}

for (const gate of ["research", "script", "storyboard"]) {
  test(`${gate} 人工批准前重读当前正文 bytes 与 SHA-256`, async () => {
    const draft = {
      path: `episodes/fixture/${gate}.md`,
      artifactPath: `episodes/fixture/${gate}.md`,
      bytes: 123,
      sha256: "a".repeat(64)
    };
    const inspected = [];
    const result = await assertCurrentApprovalArtifactIntegrity(
      episodeWithDraft(gate, draft),
      gate,
      {
        resolveExistingPathInside: async (_root, target) => target,
        inspectFileIntegrity: async (path) => {
          inspected.push(path);
          return { bytes: 123, sha256: "a".repeat(64) };
        }
      }
    );
    assert.equal(result.bytes, 123);
    assert.equal(inspected.length, 1);
  });
}

test("脚本正文漂移时人工 Gate fail closed", async () => {
  const draft = {
    artifactPath: "episodes/fixture/script.md",
    bytes: 123,
    sha256: "a".repeat(64)
  };
  await assert.rejects(
    assertCurrentApprovalArtifactIntegrity(
      episodeWithDraft("script", draft),
      "script",
      {
        resolveExistingPathInside: async (_root, target) => target,
        inspectFileIntegrity: async () => ({ bytes: 124, sha256: "b".repeat(64) })
      }
    ),
    (error) => error.code === "script_approval_artifact_integrity_mismatch"
      && error.statusCode === 409
  );
});

test("内嵌脚本不依赖外部正文文件", async () => {
  const episode = episodeWithDraft("script", {
    artifactPath: "episodes/fixture/script.md",
    content: { sections: [] }
  });
  assert.equal(await assertCurrentApprovalArtifactIntegrity(episode, "script"), null);
});
