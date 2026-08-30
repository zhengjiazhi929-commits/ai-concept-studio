import test from "node:test";
import assert from "node:assert/strict";
import {
  generateAssetPlan,
  generateScriptDraft,
  generateStoryboardDraft
} from "../src/server/production/generator.mjs";
import {
  buildWorkerPrompt,
  readWorkerPromptSetBinding,
  WORKER_PROMPT_SET_VERSION
} from "../src/server/production/worker-prompts.mjs";
import { integrityHash } from "../src/shared/integrity.mjs";
import {
  VISUAL_EXPRESSION_CONTRACT_VERSION,
  VISUAL_EXPRESSION_STYLE_PROFILE_ID
} from "../src/shared/visual-expression-contract.mjs";
import { agents } from "../src/server/agents/registry.mjs";
import { readFixtureEpisode } from "./episode-fixture.mjs";

function textOnlyVisualIntent(takeaway) {
  return {
    schemaVersion: VISUAL_EXPRESSION_CONTRACT_VERSION,
    question: `如何理解“${takeaway}”？`,
    takeaway,
    role: "statement",
    objective: "orient",
    informationNeed: "none",
    contribution: "none",
    contributionRationale: "这是单一判断，清晰标题比装饰图更直接。",
    relationKind: "none",
    compositionProfile: "text-first",
    claims: [{
      id: "claim-main",
      text: takeaway,
      visualRequired: false,
      evidenceRefs: []
    }],
    entities: [],
    relations: [],
    evidenceRefs: [],
    mustNotShow: ["无语义贡献的装饰图"]
  };
}

function fakeResult(value) {
  return {
    provider: "fixture-provider",
    model: "fixture-model",
    responseId: "fixture-response",
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    attempts: [],
    value
  };
}

function artifactWriter(records) {
  return async (episodeId, prefix, document) => {
    records.push({ episodeId, prefix, document });
    return {
      version: records.length,
      path: `/tmp/${prefix}-fixture.json`,
      relativePath: `studio/tests/generated/${prefix}-fixture.json`
    };
  };
}

test("Worker Prompt 文件具有稳定 ID、版本和内容哈希", async () => {
  const binding = await readWorkerPromptSetBinding();
  assert.equal(binding.version, WORKER_PROMPT_SET_VERSION);
  assert.equal(binding.version, "worker-prompts-v2");
  assert.equal(binding.hash, "2613350755a96e044c8fbdef87e359d79089aea172fc2b6e3bb289cddb8d62e2");
  assert.deepEqual(
    binding.prompts.map(({ workerId, id, version }) => ({ workerId, id, version })),
    [
      { workerId: "asset-agent", id: "acs.worker.asset-plan", version: "1.1.0" },
      { workerId: "script-agent", id: "acs.worker.script-draft", version: "1.0.0" },
      { workerId: "storyboard-agent", id: "acs.worker.storyboard-draft", version: "1.1.0" }
    ]
  );

  const rendered = await buildWorkerPrompt("script-agent", {
    profileInstruction: "保持 60 秒结构"
  });
  assert.match(rendered.instructions, /保持 60 秒结构/u);
  assert.doesNotMatch(rendered.instructions, /\{\{/u);
  assert.equal(rendered.binding.renderedHash, integrityHash(rendered.instructions));
  await assert.rejects(
    buildWorkerPrompt("script-agent", {}),
    /variables mismatch/u
  );
});

test("Script、Storyboard、Asset 生成产物记录实际 Prompt 绑定", async () => {
  const episode = await readFixtureEpisode();
  const records = [];
  const writeArtifact = artifactWriter(records);

  let scriptRequest = null;
  const script = await generateScriptDraft(episode, {
    client: {
      async generateStructured(task, request) {
        assert.equal(task, "script");
        scriptRequest = request;
        return fakeResult({ title: "fixture" });
      }
    },
    writeArtifact
  });
  assert.equal(script.promptBinding.id, "acs.worker.script-draft");
  assert.equal(script.promptBinding.renderedHash, integrityHash(scriptRequest.instructions));
  assert.deepEqual(records.at(-1).document.promptBinding, script.promptBinding);

  episode.production.scriptDraft.content = { title: "approved fixture script" };
  let storyboardRequest = null;
  const storyboard = await generateStoryboardDraft(episode, {
    client: {
      async generateStructured(task, request) {
        assert.equal(task, "storyboard");
        storyboardRequest = request;
        return fakeResult({
          visualContractVersion: VISUAL_EXPRESSION_CONTRACT_VERSION,
          visualStyleProfileId: VISUAL_EXPRESSION_STYLE_PROFILE_ID,
          targetDurationSeconds: 600,
          scenes: [
            { type: "title", durationSeconds: 150, kicker: "A", title: "A", statement: "A", subtitle: "A", label: "A", assetHint: "A", visualIntent: textOnlyVisualIntent("A"), subtitleLines: [{ text: "A", weight: 1 }] },
            { type: "evidence", durationSeconds: 150, kicker: "B", title: "B", statement: "B", subtitle: "B", label: "B", assetHint: "B", visualIntent: textOnlyVisualIntent("B"), subtitleLines: [{ text: "B", weight: 1 }] },
            { type: "statement", durationSeconds: 150, kicker: "C", title: "C", statement: "C", subtitle: "C", label: "C", assetHint: "C", visualIntent: textOnlyVisualIntent("C"), subtitleLines: [{ text: "C", weight: 1 }] },
            { type: "summary", durationSeconds: 150, kicker: "D", title: "D", statement: "D", subtitle: "D", label: "D", assetHint: "D", visualIntent: textOnlyVisualIntent("D"), subtitleLines: [{ text: "D", weight: 1 }] }
          ],
          assetChecklist: []
        });
      }
    },
    writeArtifact
  });
  assert.equal(storyboard.promptBinding.id, "acs.worker.storyboard-draft");
  assert.match(storyboardRequest.instructions, /visual-expression-contract-v1/u);
  assert.match(storyboardRequest.instructions, /禁止写坐标、SVG、图标、文件夹/u);
  assert.equal(
    storyboard.promptBinding.renderedHash,
    integrityHash(storyboardRequest.instructions)
  );
  assert.deepEqual(records.at(-1).document.promptBinding, storyboard.promptBinding);

  let assetRequest = null;
  const assets = await generateAssetPlan(episode, {
    client: {
      async generateStructured(task, request) {
        assert.equal(task, "assets");
        assetRequest = request;
        return fakeResult({
          visualSystem: "fixture",
          items: [],
          voiceDirection: {
            tone: "fixture",
            pacing: "fixture",
            pronunciationNotes: []
          },
          executionPolicy: {
            mode: "local-only",
            costScope: "external-api-only",
            externalApiCalls: [],
            maximumPaidCostUsd: 0,
            currency: "USD",
            pricingConfirmed: true,
            humanApprovalRequiredBeforeExecution: true,
            invalidatesOnPlanChange: true
          },
          risks: []
        });
      }
    },
    writeArtifact
  });
  assert.equal(assets.promptBinding.id, "acs.worker.asset-plan");
  assert.match(assetRequest.instructions, /已批准的 visualIntent 与 visualPlan/u);
  assert.match(assetRequest.instructions, /禁止把未批准的装饰图、人物、图标或文字卡片/u);
  assert.equal(assets.promptBinding.renderedHash, integrityHash(assetRequest.instructions));
  assert.deepEqual(records.at(-1).document.promptBinding, assets.promptBinding);
});

test("Worker 运行补丁把 Prompt 版本写入产物版本与 AI 运行记录", async () => {
  const episode = await readFixtureEpisode();
  episode.approvals.script.status = "pending";
  episode.production.scriptDraft.needsRevision = true;
  const output = await agents["script-agent"].run(episode, {
    aiClient: {
      async generateStructured() {
        return fakeResult({ title: "versioned worker output" });
      }
    },
    writeArtifact: async () => ({
      version: 7,
      path: "/tmp/script-draft-v007.json",
      relativePath: "studio/tests/generated/script-draft-v007.json"
    })
  });

  assert.equal(output.status, "waiting_approval");
  assert.equal(
    output.patch.production.scriptDraft.promptBinding.id,
    "acs.worker.script-draft"
  );
  assert.deepEqual(
    output.patch.production.scriptDraft.promptBinding,
    output.patch.production.ai.lastPromptBinding
  );
  assert.deepEqual(
    output.patch.production.scriptDraft.versions.at(-1).promptBinding,
    output.patch.production.ai.lastPromptBinding
  );
});
