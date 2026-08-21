import test from "node:test";
import assert from "node:assert/strict";
import { readEpisode } from "../src/shared/store.mjs";
import { validateEpisode } from "../src/shared/schema.mjs";
import {
  currentGateArtifactHash
} from "../src/shared/workflow.mjs";
import {
  approvalValidForGate,
  legalWorkerActions
} from "../src/server/control/policy-engine.mjs";
import { kernelSnapshot } from "../src/server/control/workflow-kernel.mjs";
import { buildDerivedShortEpisode } from "../src/server/production/derived-episode.mjs";
import { evaluateProductionQuality } from "../src/server/production/quality.mjs";
import {
  generateScriptDraft,
  generateStoryboardDraft
} from "../src/server/production/generator.mjs";
import {
  approvedScriptNarrationText,
  SHORT_STORYBOARD_VISUAL_RULES
} from "../src/server/production/short-storyboard-adapter.mjs";
import { agents } from "../src/server/agents/registry.mjs";

async function buildDerived() {
  const parent = await readEpisode("agent-skill-20260806");
  const episode = buildDerivedShortEpisode(parent, {
    id: "test-agent-skill-tool-mcp-60s",
    sourceSectionIds: ["S05"],
    now: new Date("2026-08-13T08:00:00.000Z")
  });
  return { parent, episode };
}

function shortScript() {
  return {
    title: "60 秒讲清 Skill、Tool 与 MCP",
    thesis: "Skill 规定做事方法，Tool 执行动作，MCP 提供标准连接。",
    targetDurationSeconds: 60,
    hook: "这三个词经常一起出现，但它们解决的不是同一个问题。",
    sections: [
      {
        id: "S01",
        heading: "三个层级",
        purpose: "建立准确分工",
        narration:
          "Skill 告诉 Agent 怎样完成一类任务，包括顺序、判断和验收标准。Tool 提供可执行动作，例如查询数据库或写入文档。MCP 则标准化 prompts、resources 和 tools 如何被外部系统暴露和调用。",
        evidenceRefs: ["source-cabdd0de1a74", "source-mcp-overview"],
        visualDirection: "三层架构图展示过程知识、执行动作与连接协议"
      },
      {
        id: "S02",
        heading: "放进同一任务",
        purpose: "用已批准示例澄清边界",
        narration:
          "例如整理周报时，Skill 规定先核对指标、再检查异常、最后按固定结构输出；Tool 执行查询或写入；MCP 让这些外部能力以统一方式被发现和调用。只有 Skill 没有获准工具，只能提供方法；只有工具，也缺少正确顺序和验收标准。",
        evidenceRefs: ["source-openai-plugins", "source-mcp-overview"],
        visualDirection: "用周报任务的流程与调用关系动画辅助说明"
      }
    ],
    closing: "先分清方法、动作和连接层，再决定系统里该补 Skill、Tool 还是 MCP。",
    factCheckNotes: []
  };
}

test("派生短样片只继承内容未变的研究批准，脚本及下游 Gate 全部重新开始", async () => {
  const { parent, episode } = await buildDerived();
  assert.equal(validateEpisode(episode).valid, true);
  assert.equal(episode.derivation.parentEpisodeId, parent.id);
  assert.deepEqual(episode.derivation.sourceSectionIds, ["S05"]);
  assert.equal(episode.productionProfile.id, "short-explainer-60s-v1");
  assert.equal(episode.productionProfile.targetDurationSeconds, 60);
  assert.equal(currentGateArtifactHash(episode, "research"), currentGateArtifactHash(parent, "research"));
  assert.equal(approvalValidForGate(episode, "research"), true);
  assert.equal(episode.approvals.script.status, "pending");
  assert.equal(episode.approvals.storyboard.status, "pending");
  assert.equal(episode.approvals.assets.status, "pending");
  assert.equal(episode.approvals.final.status, "pending");
  assert.equal(episode.production.scriptDraft, undefined);
  assert.equal(episode.scenes.length, 0);
  assert.deepEqual(
    legalWorkerActions(episode).map((action) => action.workerId),
    ["script-agent"]
  );
  assert.equal(
    kernelSnapshot(episode).legalActions.some(
      (action) => action.action === "run_worker" && action.workerId === "script-agent"
    ),
    true
  );
});

test("父 Episode 的研究或脚本批准无效时拒绝创建派生 Episode", async () => {
  const parent = await readEpisode("agent-skill-20260806");
  parent.approvals.script.artifactHash = "0".repeat(64);
  assert.throws(
    () => buildDerivedShortEpisode(parent, {
      id: "invalid-derived-episode",
      sourceSectionIds: ["S05"]
    }),
    /源脚本没有有效/u
  );
});

test("60 秒 Script Agent 请求使用短样片合同并携带批准源段落，不调用真实 Provider", async () => {
  const { episode } = await buildDerived();
  let clientCalled = false;
  const generated = await generateScriptDraft(episode, {
    writeArtifact: async () => ({
      version: 1,
      path: "/tmp/test-agent-skill-tool-mcp-60s-script-v001.json",
      relativePath: "studio/data/production/test/short-script-v001.json"
    }),
    client: {
      async generateStructured() {
        clientCalled = true;
        throw new Error("派生短脚本不得调用 Provider");
      }
    }
  });
  assert.equal(clientCalled, false);
  assert.equal(generated.provider, "deterministic-local");
  assert.equal(generated.generationKind, "deterministic-approved-source-adapter");
  assert.equal(generated.requestCount, 0);
  assert.equal(generated.value.targetDurationSeconds, 60);
  const sourceNarration = episode.derivation.sourceSections[0].narration;
  assert.equal(generated.value.hook, "");
  assert.equal(generated.value.closing, "");
  for (const section of generated.value.sections) {
    assert.equal(sourceNarration.includes(section.narration), true);
  }
});

test("短样片质量规则接受 2–4 节，但长片规则仍要求 6–12 节", async () => {
  const { episode } = await buildDerived();
  episode.production.scriptDraft = {
    version: 1,
    artifactPath: "studio/data/production/episodes/test/script-draft-v001.json",
    content: shortScript(),
    generationKind: "deterministic-approved-source-adapter",
    sourceSnapshotHash: episode.derivation.sourceSnapshotHash,
    versions: []
  };
  const approvedText = episode.derivation.sourceSections[0].narration;
  const groups = approvedText.match(/[^。！？；]+[。！？；]?/gu).map((item) => item.trim());
  episode.production.scriptDraft.content = {
    ...shortScript(),
    hook: groups[0],
    sections: [
      {
        ...shortScript().sections[0],
        narration: groups.slice(0, 3).join(""),
        visualDirection: episode.derivation.sourceSections[0].visualDirection
      },
      {
        ...shortScript().sections[1],
        narration: groups.slice(3).join(""),
        visualDirection: episode.derivation.sourceSections[0].visualDirection
      }
    ],
    closing: groups.at(-1)
  };
  episode.production.scriptDraft.content.hook = "";
  episode.production.scriptDraft.content.closing = "";
  const shortQuality = evaluateProductionQuality(episode, { stage: "script" });
  assert.equal(shortQuality.checks.find((check) => check.id === "script-section-count").passed, true);
  assert.equal(shortQuality.checks.find((check) => check.id === "script-derived-source-binding").passed, true);
  assert.equal(shortQuality.checks.find((check) => check.id === "script-derived-source-fidelity").passed, true);
  assert.equal(shortQuality.checks.find((check) => check.id === "script-derived-narration-duplication").passed, true);
  assert.equal(shortQuality.checks.find((check) => check.id === "script-derived-visual-fidelity").passed, true);

  const parent = await readEpisode("agent-skill-20260806");
  parent.production.scriptDraft.content = shortScript();
  const longQuality = evaluateProductionQuality(parent, { stage: "script" });
  assert.equal(longQuality.checks.find((check) => check.id === "script-section-count").passed, false);
});

test("60 秒 Storyboard Agent 只拆分已批准脚本并绑定审核哈希，不调用 Provider", async () => {
  const { episode } = await buildDerived();
  const script = await generateScriptDraft(episode, {
    writeArtifact: async () => ({
      version: 1,
      path: "/tmp/test-derived-script-v001.json",
      relativePath: "studio/data/production/test/script-draft-v001.json"
    })
  });
  episode.production.scriptDraft = {
    version: 1,
    artifactPath: script.artifact.relativePath,
    provider: script.provider,
    model: script.model,
    usage: script.usage,
    generatedAt: "2026-08-13T08:01:00.000Z",
    generationKind: script.generationKind,
    sourceSnapshotHash: script.sourceSnapshotHash,
    needsRevision: false,
    content: script.value,
    versions: []
  };
  episode.approvals.script = {
    ...episode.approvals.script,
    status: "approved",
    currentVersion: 1,
    provenance: "reviewed-v2",
    reviewReportId: "review-script-v1",
    artifactHash: currentGateArtifactHash(episode, "script")
  };
  episode.reviews.script = {
    ...episode.reviews.script,
    status: "passed",
    artifactVersion: 1,
    artifactHash: episode.approvals.script.artifactHash,
    latestReportId: "review-script-v1",
    reports: [{
      id: "review-script-v1",
      decision: "pass",
      artifactVersion: 1,
      artifactHash: episode.approvals.script.artifactHash
    }]
  };

  let clientCalled = false;
  const generated = await generateStoryboardDraft(episode, {
    writeArtifact: async () => ({
      version: 1,
      path: "/tmp/test-derived-storyboard-v001.json",
      relativePath: "studio/data/production/test/storyboard-draft-v001.json"
    }),
    client: {
      async generateStructured() {
        clientCalled = true;
        throw new Error("派生短分镜不得调用 Provider");
      }
    }
  });

  assert.equal(clientCalled, false);
  assert.equal(generated.provider, "deterministic-local");
  assert.equal(generated.generationKind, "deterministic-approved-script-storyboard-adapter");
  assert.equal(generated.requestCount, 0);
  assert.equal(generated.sourceScriptVersion, 1);
  assert.equal(generated.sourceScriptArtifactHash, episode.approvals.script.artifactHash);
  assert.equal(generated.sourceScriptReviewReportId, "review-script-v1");
  assert.equal(generated.timeline.durationSeconds, 60);
  assert.ok(generated.timeline.scenes.length >= 6 && generated.timeline.scenes.length <= 10);
  assert.deepEqual(
    [...new Set(generated.timeline.scenes.map((scene) => scene.type))].sort(),
    ["evidence", "statement", "summary", "title"]
  );
  assert.equal(
    generated.timeline.subtitles.map((subtitle) => subtitle.text).join(""),
    approvedScriptNarrationText(script.value)
  );
  assert.ok(
    generated.timeline.subtitles.every(
      (subtitle) => subtitle.end - subtitle.start >= 0.75
    )
  );
  assert.ok(
    generated.timeline.subtitles.every((subtitle) => !/^\s/u.test(subtitle.text))
  );
  assert.deepEqual(generated.value.visualRules, SHORT_STORYBOARD_VISUAL_RULES);
  assert.ok(generated.timeline.scenes.every((scene) => scene.kicker === "" && scene.label === ""));
  assert.ok(generated.timeline.scenes.every((scene) => !scene.assetHint.includes("比喻")));
});

test("派生分镜质量规则会拦截脚本哈希漂移和未经批准的镜头文案", async () => {
  const episode = structuredClone(await readEpisode("agent-skill-tool-mcp-60s-20260813"));
  const generated = await generateStoryboardDraft(episode, {
    writeArtifact: async () => ({
      version: 1,
      path: "/tmp/test-derived-storyboard-quality-v001.json",
      relativePath: "studio/data/production/test/storyboard-quality-v001.json"
    })
  });
  episode.scenes = generated.timeline.scenes;
  episode.subtitles = generated.timeline.subtitles;
  episode.render.durationSeconds = generated.timeline.durationSeconds;
  episode.production.storyboardDraft = {
    version: 1,
    artifactPath: generated.artifact.relativePath,
    generationKind: generated.generationKind,
    sourceSnapshotHash: generated.sourceSnapshotHash,
    sourceScriptVersion: generated.sourceScriptVersion,
    sourceScriptArtifactHash: generated.sourceScriptArtifactHash,
    sourceScriptReviewReportId: generated.sourceScriptReviewReportId,
    visualRules: generated.value.visualRules,
    versions: []
  };
  let quality = evaluateProductionQuality(episode, { stage: "storyboard" });
  assert.equal(quality.checks.find((check) => check.id === "storyboard-derived-script-binding").passed, true);
  assert.equal(quality.checks.find((check) => check.id === "storyboard-derived-script-fidelity").passed, true);
  assert.equal(quality.checks.find((check) => check.id === "storyboard-derived-visual-contract").passed, true);
  assert.equal(quality.checks.find((check) => check.id === "storyboard-derived-display-chrome").passed, true);

  episode.production.storyboardDraft.sourceScriptArtifactHash = "0".repeat(64);
  episode.scenes[0].title = "未经批准的新比喻";
  quality = evaluateProductionQuality(episode, { stage: "storyboard" });
  assert.equal(quality.passed, false);
  assert.equal(quality.checks.find((check) => check.id === "storyboard-derived-script-binding").passed, false);
  assert.equal(quality.checks.find((check) => check.id === "storyboard-derived-script-fidelity").passed, false);
});

test("Storyboard Agent 的本地结构检查失败时把候选标成待修改", async () => {
  const episode = structuredClone(await readEpisode("agent-skill-tool-mcp-60s-20260813"));
  episode.approvals.storyboard = {
    ...episode.approvals.storyboard,
    status: "pending"
  };
  episode.production.storyboardDraft = {
    ...(episode.production.storyboardDraft ?? {}),
    needsRevision: true
  };
  episode.pipeline.find((step) => step.id === "storyboard").status = "ready";
  episode.sourceDocs = [];
  const originalMinimumDuration = episode.render.durationSeconds;
  const result = await agents["storyboard-agent"].run(episode, {
    writeArtifact: async () => ({
      version: 3,
      path: "/tmp/test-derived-storyboard-agent-v003.json",
      relativePath: "studio/data/production/test/storyboard-agent-v003.json"
    })
  });
  assert.equal(result.status, "failed");
  assert.equal(result.patch.production.storyboardDraft.needsRevision, true);
  assert.equal(originalMinimumDuration, episode.render.durationSeconds);
});
