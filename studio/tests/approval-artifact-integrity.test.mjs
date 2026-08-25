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

function inlineResearchEpisode() {
  return {
    id: "inline-research-fixture",
    research: {
      readiness: { verifiedSourceCount: 2, supportedClaimCount: 1 },
      content: {
        sources: [{
          id: "SRC-1",
          label: "来源一",
          url: "https://example.test/source-1",
          publisher: "Example",
          sourceType: "official-doc"
        }, {
          id: "SRC-2",
          label: "来源二",
          url: "https://example.test/source-2",
          publisher: "Example",
          sourceType: "official-doc"
        }],
        claims: [{
          id: "C01",
          text: "完整研究结论",
          category: "definition",
          support: "supported",
          boundary: "只用于当前测试边界",
          sourceIds: ["SRC-1", "SRC-2"]
        }]
      }
    },
    sourceDocs: [
      { path: "episodes/fixture/source-a.md", bytes: 10, sha256: "a".repeat(64) },
      { path: "episodes/fixture/source-b.md", bytes: 20, sha256: "b".repeat(64) }
    ],
    production: {}
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

test("内嵌研究候选在人工批准前重读全部来源文件", async () => {
  const episode = inlineResearchEpisode();
  const inspected = [];
  const result = await assertCurrentApprovalArtifactIntegrity(episode, "research", {
    resolveExistingPathInside: async (_root, target) => target,
    inspectFileIntegrity: async (path) => {
      inspected.push(path);
      return path.endsWith("source-a.md")
        ? { bytes: 10, sha256: "a".repeat(64) }
        : { bytes: 20, sha256: "b".repeat(64) };
    }
  });
  assert.equal(result.documents.length, 2);
  assert.equal(inspected.length, 2);
});

test("内嵌研究候选任一来源漂移即阻止批准", async () => {
  const episode = inlineResearchEpisode();
  await assert.rejects(
    assertCurrentApprovalArtifactIntegrity(episode, "research", {
      resolveExistingPathInside: async (_root, target) => target,
      inspectFileIntegrity: async (path) => path.endsWith("source-a.md")
        ? { bytes: 10, sha256: "a".repeat(64) }
        : { bytes: 21, sha256: "c".repeat(64) }
    }),
    (error) => error.code === "research_approval_artifact_integrity_mismatch"
  );
});

test("内嵌研究候选缺少来源文件时审批完整性检查 fail closed", async () => {
  const episode = inlineResearchEpisode();
  episode.sourceDocs = [];
  episode.research.readiness.verifiedSourceCount = 0;
  await assert.rejects(
    assertCurrentApprovalArtifactIntegrity(episode, "research"),
    (error) => error.code === "research_approval_evidence_registry_invalid"
      && error.issues.some((issue) => issue.code === "research-source-documents-insufficient")
  );
});

test("内嵌研究候选拒绝重复文件和未登记的 claim 来源", async () => {
  const episode = inlineResearchEpisode();
  episode.sourceDocs[1].path = "episodes/fixture/../fixture/source-a.md";
  episode.research.content.claims[0].sourceIds = ["SRC-UNKNOWN"];
  await assert.rejects(
    assertCurrentApprovalArtifactIntegrity(episode, "research"),
    (error) => error.code === "research_approval_evidence_registry_invalid"
      && error.issues.some((issue) => issue.code === "research-source-document-duplicate")
      && error.issues.some((issue) => issue.code === "research-claim-source-unknown")
  );
});

test("内嵌研究候选拒绝两个登记路径解析到同一真实文件", async () => {
  const episode = inlineResearchEpisode();
  await assert.rejects(
    assertCurrentApprovalArtifactIntegrity(episode, "research", {
      resolveExistingPathInside: async () => "/private/tmp/same-research-source.md",
      inspectFileIntegrity: async () => ({ bytes: 10, sha256: "a".repeat(64) })
    }),
    (error) => error.code === "research_approval_artifact_duplicate"
  );
});

test("内嵌研究候选拒绝只有 ID、没有可读来源与结论正文的空壳", async () => {
  const episode = inlineResearchEpisode();
  episode.research.content = {
    sources: [{ id: "SRC-1" }, { id: "SRC-2" }],
    claims: [{ id: "C01", sourceIds: ["SRC-1", "SRC-2"] }]
  };
  await assert.rejects(
    assertCurrentApprovalArtifactIntegrity(episode, "research"),
    (error) => error.code === "research_approval_evidence_registry_invalid"
      && error.issues.some((issue) => issue.code === "research-source-label-missing")
      && error.issues.some((issue) => issue.code === "research-claim-text-missing")
      && error.issues.some((issue) => issue.code === "research-claim-boundary-missing")
  );
});

test("golden-001 内嵌研究必须登记 source register 与 claim ledger", async () => {
  const episode = inlineResearchEpisode();
  episode.id = "golden-001";
  episode.research.generationKind = "deterministic-golden-m1-fixed-evidence";
  await assert.rejects(
    assertCurrentApprovalArtifactIntegrity(episode, "research"),
    (error) => error.code === "research_approval_evidence_registry_invalid"
      && error.issues.filter((issue) => issue.code === "golden-research-document-missing")
        .length === 2
  );
});
