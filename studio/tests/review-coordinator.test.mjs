import test from "node:test";
import assert from "node:assert/strict";
import {
  fixtureAssetFileDependencies,
  readFixtureEpisode
} from "./episode-fixture.mjs";
import {
  approveGate,
  exactApprovalBinding,
  recheckGateReview,
  reviewCandidateOutput,
  routeReviewRevision,
  runAgent
} from "../src/server/orchestrator.mjs";
import {
  readReviewConfig,
  reviewAgentOutput
} from "../src/server/reviews/coordinator.mjs";
import { currentGateArtifactHash } from "../src/shared/workflow.mjs";

function waitingForScript(overrides = {}) {
  return {
    status: "waiting_approval",
    message: "脚本候选等待审批",
    requiresApproval: "script",
    artifacts: [],
    findings: [],
    patch: {},
    ...overrides
  };
}

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

test("通过报告绑定当前版本并追加到阶段历史", async () => {
  const source = await readFixtureEpisode();
  const previousReportCount = source.reviews.script.reports.length;
  const result = await reviewAgentOutput({
    sourceEpisode: source,
    candidateEpisode: source,
    agentId: "script-agent",
    output: waitingForScript()
  }, { now: new Date("2026-08-06T00:00:00.000Z") });
  assert.equal(result.report.decision, "pass");
  assert.equal(result.report.artifactVersion, source.approvals.script.currentVersion);
  assert.equal(result.reviewState.status, "passed");
  assert.equal(result.reviewState.reports.length, previousReportCount + 1);
  assert.equal(result.output.status, "waiting_approval");
});

test("编排接缝会把未通过审核的等待审批输出改为阻塞", async () => {
  const source = await readFixtureEpisode();
  source.thesis = "";
  const result = await reviewCandidateOutput({
    sourceEpisode: source,
    agentId: "script-agent",
    output: waitingForScript()
  }, { now: new Date("2026-08-06T00:01:00.000Z") });
  assert.equal(result.review.report.decision, "revise");
  assert.equal(result.output.status, "blocked");
  assert.equal(result.output.requiresApproval, null);
  assert.equal(result.episode.reviews.script.status, "revision_required");
  assert.equal(result.episode.production.scriptDraft.needsRevision, true);
  assert.ok(result.review.report.blockingIssues.some((issue) => issue.code === "thesis"));
});

test("连续两轮出现同类阻断问题时升级人工且不覆盖旧报告", async () => {
  const source = await readFixtureEpisode();
  const previousReportCount = source.reviews.script.reports.length;
  const candidate = structuredClone(source);
  candidate.thesis = "";
  const first = await reviewAgentOutput({
    sourceEpisode: source,
    candidateEpisode: candidate,
    agentId: "script-agent",
    output: waitingForScript()
  }, { now: new Date("2026-08-06T00:02:00.000Z") });
  const retrySource = structuredClone(candidate);
  retrySource.reviews.script = first.reviewState;
  const second = await reviewAgentOutput({
    sourceEpisode: retrySource,
    candidateEpisode: retrySource,
    agentId: "script-agent",
    output: waitingForScript()
  }, { now: new Date("2026-08-06T00:03:00.000Z") });
  assert.equal(first.report.decision, "revise");
  assert.equal(second.report.decision, "escalate");
  assert.equal(second.output.requiresHuman, true);
  assert.equal(second.reviewState.reports.length, previousReportCount + 2);
  assert.notEqual(second.reviewState.reports.at(-2).id, second.reviewState.reports.at(-1).id);
});

test("假语义 Reviewer 的低置信度会安全升级，且不会调用真实模型", async () => {
  const source = await readFixtureEpisode();
  const config = await readReviewConfig();
  config.stages.script.semanticReview = true;
  const result = await reviewAgentOutput({
    sourceEpisode: source,
    candidateEpisode: source,
    agentId: "script-agent",
    output: waitingForScript()
  }, {
    config,
    now: new Date("2026-08-06T00:04:00.000Z"),
    semanticReviewerId: "fake-reviewer-v1",
    semanticReviewerKind: "test-double",
    semanticReviewer: async () => ({
      stage: "script",
      decision: "pass",
      artifactVersion: source.approvals.script.currentVersion,
      rubricVersion: "script-v2",
      confidence: 0.4,
      blockingIssues: [],
      warnings: [],
      passedChecks: ["semantic-consistency"]
    })
  });
  assert.equal(result.report.decision, "escalate");
  assert.equal(result.output.status, "blocked");
  assert.equal(result.output.requiresHuman, true);
  assert.equal(result.report.reviewMode, "deterministic+semantic");
  assert.equal(result.report.semanticReviewerId, "fake-reviewer-v1");
  assert.equal(result.report.semanticReviewerKind, "test-double");
  assert.ok(
    result.report.blockingIssues.some((issue) => issue.code === "LOW_REVIEW_CONFIDENCE")
  );
});

test("语义 Reviewer 只收到阶段最小上下文，并明确候选产物是不可信数据", async () => {
  const source = await readFixtureEpisode();
  source.system = { localPath: "/private/path" };
  source.history.push({ at: "2026-08-06", type: "secret-history", message: "hidden" });
  const config = await readReviewConfig();
  config.stages.script.semanticReview = true;
  let received;
  await reviewAgentOutput({
    sourceEpisode: source,
    candidateEpisode: source,
    agentId: "script-agent",
    output: waitingForScript()
  }, {
    config,
    semanticReviewer: async (input) => {
      received = input;
      return {
        stage: "script",
        decision: "pass",
        artifactVersion: source.approvals.script.currentVersion,
        rubricVersion: "script-v2",
        confidence: 0.95,
        blockingIssues: [],
        warnings: [],
        passedChecks: ["semantic-consistency"]
      };
    }
  });
  assert.equal(Object.hasOwn(received, "episode"), false);
  assert.equal(Object.hasOwn(received.context, "history"), false);
  assert.equal(JSON.stringify(received.context).includes("/private/path"), false);
  assert.match(received.context.trustBoundary, /untrusted/u);
  assert.match(received.context.contextHash, /^[a-f0-9]{64}$/u);
});

test("语义 Reviewer 不能一边通过一边返回阻断问题", async () => {
  const source = await readFixtureEpisode();
  const config = await readReviewConfig();
  config.stages.script.semanticReview = true;
  await assert.rejects(
    reviewAgentOutput({
      sourceEpisode: source,
      candidateEpisode: source,
      agentId: "script-agent",
      output: waitingForScript()
    }, {
      config,
      semanticReviewer: async () => ({
        stage: "script",
        decision: "pass",
        artifactVersion: source.approvals.script.currentVersion,
        rubricVersion: "script-v2",
        confidence: 0.95,
        blockingIssues: [{ code: "FACT_GAP", evidence: "事实依据不足" }],
        warnings: [],
        passedChecks: []
      })
    }),
    /passing review cannot contain blocking issues/u
  );
});

test("语义审核问题完整保留位置和建议修法并交回产出 Agent", async () => {
  const source = await readFixtureEpisode();
  const config = await readReviewConfig();
  config.stages.script.semanticReview = true;
  const result = await reviewAgentOutput({
    sourceEpisode: source,
    candidateEpisode: source,
    agentId: "script-agent",
    output: waitingForScript()
  }, {
    config,
    semanticReviewer: async () => ({
      stage: "script",
      decision: "revise",
      artifactVersion: source.approvals.script.currentVersion,
      rubricVersion: "script-v2",
      confidence: 0.96,
      blockingIssues: [{
        code: "FACT_GAP",
        evidence: "第二节的结论缺少来源",
        location: "script.sections[1]",
        suggestedFix: "补充来源或删除该结论"
      }],
      warnings: [],
      passedChecks: []
    })
  });
  assert.equal(result.report.blockingIssues[0].location, "script.sections[1]");
  assert.equal(result.report.blockingIssues[0].suggestedFix, "补充来源或删除该结论");
});

test("Main Agent 指定的审核规则必须与阶段实际 Rubric 一致", async () => {
  const source = await readFixtureEpisode();
  await assert.rejects(
    reviewAgentOutput({
      sourceEpisode: source,
      candidateEpisode: source,
      agentId: "script-agent",
      output: waitingForScript()
    }, { expectedReviewProfile: "script-v0" }),
    /Main Agent 审核规则不匹配/u
  );
});

test("等待人工审批的旧候选可按新规则复审，失败后会阻塞且不能批准", async () => {
  const source = await readFixtureEpisode();
  const scriptStep = source.pipeline.find((step) => step.gate === "script");
  scriptStep.status = "waiting_approval";
  scriptStep.message = "旧规则下等待审批的脚本";
  scriptStep.artifacts = ["studio/data/production/episodes/golden-001/script-draft-v002.json"];
  source.approvals.script = {
    ...source.approvals.script,
    status: "pending",
    at: null,
    note: "",
    feedback: "",
    currentVersion: 2,
    provenance: null,
    reviewReportId: null,
    artifactHash: null
  };
  source.production.scriptDraft = {
    version: 2,
    artifactPath: scriptStep.artifacts[0],
    needsRevision: false,
    content: {
      targetDurationSeconds: 600,
      hook: "简短开场",
      sections: Array.from({ length: 6 }, (_, index) => ({
        id: `S${index + 1}`,
        narration: "明显不足的旁白",
        evidenceRefs: ["source-1"]
      })),
      closing: "简短结尾"
    }
  };
  const store = memoryStore(source);

  const result = await recheckGateReview(source.id, "script", {
    ...store,
    review: { now: new Date("2026-08-06T00:04:30.000Z") }
  });
  assert.equal(result.review.report.decision, "revise");
  assert.equal(result.output.status, "blocked");
  assert.ok(
    result.review.report.blockingIssues.some(
      (issue) => issue.code === "script-narration-density"
    )
  );
  assert.equal(store.episode.pipeline.find((step) => step.gate === "script").status, "blocked");
  assert.equal(store.episode.production.scriptDraft.needsRevision, true);
  assert.equal(store.episode.control.activeOperation, null);
  await assert.rejects(
    approveGate(source.id, "script", {
      ...exactApprovalBinding(store.episode, "script"),
      note: "不应批准"
    }, store),
    /尚未进入人工审批状态/u
  );
});

test("旧审核配置留下的通过报告不能直接用于人工批准", async () => {
  const source = await readFixtureEpisode();
  const scriptStep = source.pipeline.find((step) => step.gate === "script");
  scriptStep.status = "waiting_approval";
  source.approvals.script = {
    ...source.approvals.script,
    status: "pending",
    at: null,
    currentVersion: 1,
    provenance: null,
    reviewReportId: null,
    artifactHash: null
  };
  const reviewed = await reviewCandidateOutput({
    sourceEpisode: source,
    candidateEpisode: source,
    agentId: "script-agent",
    output: waitingForScript()
  });
  reviewed.episode.pipeline.find((step) => step.gate === "script").status = "waiting_approval";
  const report = reviewed.episode.reviews.script.reports.at(-1);
  report.reviewConfigVersion = "review-rubrics-v1";
  const store = memoryStore(reviewed.episode);
  await assert.rejects(
    approveGate(source.id, "script", {
      ...exactApprovalBinding(store.episode, "script"),
      note: "不应批准"
    }, store),
    /审核规则已更新/u
  );
});

test("素材总审能把资产计划问题退回真正的 Asset Agent", async () => {
  const source = await readFixtureEpisode();
  source.pipeline.find((step) => step.agent === "voice-agent").status = "ready";
  source.approvals.assets.status = "pending";
  const config = await readReviewConfig();
  const fixtureFiles = fixtureAssetFileDependencies(source);
  let reviewAccessCalls = 0;
  config.stages.assets.semanticReview = true;
  const result = await reviewAgentOutput({
    sourceEpisode: source,
    candidateEpisode: source,
    agentId: "voice-agent",
    output: {
      status: "waiting_approval",
      message: "素材与旁白等待总审",
      requiresApproval: "assets",
      artifacts: [],
      findings: [],
      patch: {}
    }
  }, {
    config,
    access: async (path) => {
      reviewAccessCalls += 1;
      return fixtureFiles.access(path);
    },
    semanticReviewer: async ({ context }) => ({
      stage: "assets",
      decision: "revise",
      artifactVersion: context.artifact?.plan?.version
        ?? source.approvals.assets.currentVersion,
      rubricVersion: "assets-v8",
      confidence: 0.96,
      blockingIssues: [{
        code: "ASSET_PLAN_RIGHTS_GAP",
        evidence: "素材清单没有逐项版权要求。",
        location: "production.assetPlan.content.items",
        suggestedFix: "由 Asset Agent 补充每项素材的来源与版权边界。",
        ownerAgentId: "asset-agent"
      }],
      warnings: [],
      passedChecks: []
    })
  });
  assert.equal(reviewAccessCalls, source.assets.length);
  assert.equal(result.report.decision, "revise");
  assert.deepEqual(result.revisionTargets, ["asset-agent"]);
  assert.equal(result.shouldAutoRevise, false);
  assert.equal(result.output.requiresHuman, false);
  assert.equal(result.output.patch.production.assetPlan.needsRevision, true);
  assert.equal(result.output.patch.voice, undefined);

  source.pipeline.find((step) => step.agent === "asset-agent").status = "complete";
  source.pipeline.find((step) => step.agent === "voice-agent").status = "blocked";
  const routed = routeReviewRevision(source, "voice-agent", result);
  assert.equal(routed.pipeline.find((step) => step.agent === "asset-agent").status, "ready");
  assert.equal(routed.pipeline.find((step) => step.agent === "voice-agent").status, "pending");
  assert.match(
    routed.pipeline.find((step) => step.agent === "asset-agent").message,
    /版权要求/u
  );
});

test("最终 QA 发现字幕硬切时退回 Storyboard Agent 并失效下游审批", async () => {
  const source = structuredClone(await readFixtureEpisode());
  source.render = {
    ...source.render,
    version: 1,
    status: "complete",
    outputPath: "outputs/studio/golden-001/preview-v001.mp4",
    bytes: 60_001,
    sha256: "a".repeat(64)
  };
  source.qa = {
    ...source.qa,
    status: "passed",
    reportPath: "outputs/studio/golden-001/preview-qa-v001.json",
    checks: [
      { id: "render-bytes", passed: true, actual: 60_001, expected: 60_001 },
      {
        id: "render-sha256",
        passed: true,
        actual: "a".repeat(64),
        expected: "a".repeat(64)
      }
    ]
  };
  source.approvals.final.currentVersion = 1;
  source.subtitles[0].text = "Agent Skil";
  source.subtitles[1].text = "l 可以反复调用";
  const result = await reviewAgentOutput({
    sourceEpisode: source,
    candidateEpisode: source,
    agentId: "qa-agent",
    output: {
      status: "waiting_approval",
      message: "最终 QA 候选等待审核",
      requiresApproval: "final",
      artifacts: [],
      findings: [],
      patch: {}
    }
  });
  assert.equal(result.report.decision, "revise");
  assert.deepEqual(result.revisionTargets, ["storyboard-agent"]);
  assert.equal(result.output.requiresApproval, null);
  assert.ok(
    result.report.blockingIssues.some((issue) => issue.code === "subtitle-boundaries")
  );

  const routed = routeReviewRevision(source, "qa-agent", result);
  assert.equal(routed.pipeline.find((step) => step.agent === "storyboard-agent").status, "ready");
  assert.equal(routed.pipeline.find((step) => step.agent === "qa-agent").status, "pending");
  assert.equal(routed.approvals.storyboard.status, "pending");
  assert.equal(routed.approvals.assets.status, "pending");
  assert.equal(routed.approvals.final.status, "pending");
  assert.equal(Array.isArray(routed.production.feedback.storyboard.text), true);
  assert.equal(
    routed.production.feedback.storyboard.text[0].ownerAgentId,
    "storyboard-agent"
  );
});

test("编排器会持久化审核状态并在一次自动修改后进入人工审批", async () => {
  let stored = await readFixtureEpisode();
  stored.productionProfile = {
    id: "long-form-explainer-v1",
    targetDurationSeconds: 600
  };
  const initialScriptReportCount = stored.reviews.script.reports.length;
  const originalThesis = stored.thesis;
  stored.sourceDocs = stored.sourceDocs.filter((source) => !source.path.endsWith("07-script.md"));
  const researchArtifactHash = currentGateArtifactHash(stored, "research");
  stored.approvals.research.artifactHash = researchArtifactHash;
  stored.reviews.research.artifactHash = researchArtifactHash;
  for (const report of stored.reviews.research.reports) {
    report.artifactHash = researchArtifactHash;
  }
  stored.production.scriptDraft = {
    ...(stored.production.scriptDraft ?? {}),
    artifactPath: "outputs/test-script-v1.json",
    needsRevision: false
  };
  const scriptStep = stored.pipeline.find((step) => step.agent === "script-agent");
  scriptStep.status = "ready";
  stored.approvals.script.status = "pending";
  stored.approvals.script.currentVersion = 1;
  let calls = 0;
  const receivedReviewFeedback = [];
  const events = [];
  const fakeAgent = {
    async run(episode, context) {
      calls += 1;
      receivedReviewFeedback.push(structuredClone(context.reviewFeedback));
      const version = calls + 1;
      return waitingForScript({
        message: `脚本候选 v${version}`,
        patch: {
          approvals: {
            script: {
              ...episode.approvals.script,
              status: "pending",
              currentVersion: version,
              at: null,
              note: "",
              feedback: "",
              provenance: null,
              reviewReportId: null,
              artifactHash: null
            }
          },
          production: {
            scriptDraft: {
              ...episode.production.scriptDraft,
              version,
              artifactPath: calls === 1 ? null : "outputs/test-script-v3.json",
              needsRevision: false,
              ...(calls === 1 ? {} : {
                content: {
                  targetDurationSeconds: 600,
                  hook: "有证据的完整旁白".repeat(10),
                  sections: Array.from({ length: 6 }, () => ({
                    narration: "有证据的完整旁白".repeat(35),
                    evidenceRefs: ["source-1"]
                  })),
                  closing: "有证据的完整旁白".repeat(10)
                }
              })
            }
          }
        }
      });
    }
  };
  const result = await runAgent("golden-001", "script-agent", {
    agent: fakeAgent,
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = JSON.parse(JSON.stringify(episode));
    },
    appendEvent: async (event) => {
      events.push(structuredClone(event));
    },
    review: { now: new Date("2026-08-06T00:05:00.000Z") },
    limits: { maxAttempts: 2, maxRevisionRounds: 1 }
  });
  assert.equal(calls, 2);
  assert.deepEqual(receivedReviewFeedback[0], []);
  assert.equal(receivedReviewFeedback[1].length > 0, true);
  assert.equal(receivedReviewFeedback[1].every((issue) => issue.code && issue.evidence), true);
  assert.equal(result.output.status, "waiting_approval");
  assert.equal(stored.reviews.script.status, "passed");
  assert.equal(stored.reviews.script.artifactVersion, 3);
  assert.equal(stored.reviews.script.reports.length, initialScriptReportCount + 2);
  assert.equal(stored.pipeline.find((step) => step.agent === "script-agent").attempts, 2);
  assert.equal(events.filter((event) => event.type === "agent.revision_started").length, 1);
  assert.equal(originalThesis, stored.thesis);
});

test("Main Agent 的能力档位和执行上限会传入 Worker 上下文", async () => {
  let stored = await readFixtureEpisode();
  stored.pipeline.find((item) => item.agent === "script-agent").status = "ready";
  stored.control.allowedTools = ["artifact.read"];
  let received = null;
  const result = await runAgent("golden-001", "script-agent", {
    taskProfile: "critical-review",
    toolIds: ["artifact.read"],
    limits: { maxAttempts: 1, maxRevisionRounds: 0 },
    agent: {
      async run(_episode, context) {
        received = {
          taskProfile: context.taskProfile,
          reviewProfile: context.reviewProfile,
          toolIds: [...context.toolIds],
          limits: structuredClone(context.limits)
        };
        return {
          status: "blocked",
          message: "等待人工补充输入",
          artifacts: [],
          findings: [],
          requiresHuman: true
        };
      }
    },
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async () => {}
  });
  assert.equal(result.output.status, "blocked");
  assert.equal(received.taskProfile, "critical-review");
  assert.deepEqual(received.toolIds, ["artifact.read"]);
  assert.deepEqual(received.limits, { maxAttempts: 1, maxRevisionRounds: 0 });
});

test("编排器拒绝 Worker 越权补丁并保留原审批状态", async () => {
  let stored = await readFixtureEpisode();
  const step = stored.pipeline.find((item) => item.agent === "script-agent");
  step.status = "ready";
  stored.approvals.script.status = "pending";
  await assert.rejects(
    runAgent("golden-001", "script-agent", {
      agent: {
        async run() {
          return {
            status: "complete",
            message: "试图直接完成",
            artifacts: [],
            findings: [],
            patch: {
              approvals: {
                script: { ...stored.approvals.script, status: "approved" }
              },
              pipeline: []
            }
          };
        }
      },
      readEpisode: async () => structuredClone(stored),
      writeEpisode: async (episode) => {
        stored = structuredClone(episode);
      },
      appendEvent: async () => {}
    }),
    /Worker 状态或补丁越权/u
  );
  assert.equal(stored.approvals.script.status, "pending");
  assert.equal(stored.pipeline.find((item) => item.agent === "script-agent").status, "failed");
});

test("编排器持久化失败时会清除错误中的疑似凭据文本", async () => {
  let stored = await readFixtureEpisode();
  stored.pipeline.find((item) => item.agent === "script-agent").status = "ready";
  const marker = ["Bearer", "unit-marker-12345678"].join(" ");
  await assert.rejects(
    runAgent("golden-001", "script-agent", {
      agent: {
        async run() {
          const error = new Error(marker);
          error.attempts = [{
            provider: "test",
            model: "model-a",
            attempt: 1,
            status: "failed",
            message: marker,
            durationMs: 1
          }];
          throw error;
        }
      },
      readEpisode: async () => structuredClone(stored),
      writeEpisode: async (episode) => {
        stored = structuredClone(episode);
      },
      appendEvent: async () => {}
    })
  );
  assert.equal(JSON.stringify(stored).includes(marker), false);
  assert.equal(stored.pipeline.find((item) => item.agent === "script-agent").lastError.includes("[REDACTED]"), true);
});
