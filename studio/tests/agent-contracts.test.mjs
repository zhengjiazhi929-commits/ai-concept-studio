import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureAgentArchitecture,
  validateMainAgentPlan,
  validateReviewResult,
  validateRoutingDecision,
  validateWorkerMutation,
  validateWorkerResult
} from "../src/shared/agent-contracts.mjs";

test("旧 Episode 会获得安全的 Agent v2 默认值", () => {
  const episode = ensureAgentArchitecture({ id: "legacy-episode" });
  assert.equal(episode.control.mode, "shadow");
  assert.equal(episode.control.reviewEnabled, true);
  assert.equal(episode.control.revisionLimit, 2);
  assert.deepEqual(episode.control.allowedTools, []);
  assert.equal(episode.control.activeOperation, null);
  assert.deepEqual(episode.control.budget.reservations, []);
  assert.deepEqual(Object.keys(episode.reviews), [
    "research",
    "script",
    "storyboard",
    "assets",
    "final"
  ]);
  assert.equal(episode.reviews.script.status, "not_started");
  assert.deepEqual(episode.planHistory, []);
  assert.deepEqual(episode.routingHistory, []);
  assert.deepEqual(episode.dispatchHistory, []);
});

test("畸形控制字段使用安全默认值，不会通过字符串关闭审核或开启 Agent", () => {
  const episode = ensureAgentArchitecture({
    id: "malformed-control",
    control: {
      reviewEnabled: "false",
      modelRouterEnabled: "true",
      mainAgentEnabled: 1,
      fixedFallbackEnabled: "false",
      stopRequested: "false",
      allowedTools: ["artifact.read", 123, "artifact.read", ""],
      budget: { usedCalls: 1.2, usedCostUsd: 0 }
    }
  });
  assert.equal(episode.control.reviewEnabled, true);
  assert.equal(episode.control.modelRouterEnabled, false);
  assert.equal(episode.control.mainAgentEnabled, false);
  assert.equal(episode.control.fixedFallbackEnabled, true);
  assert.equal(episode.control.stopRequested, true);
  assert.deepEqual(episode.control.allowedTools, ["artifact.read"]);
  assert.equal(episode.control.budget.usedCalls, 2);
  const nullState = ensureAgentArchitecture({ id: "null-state", control: null, reviews: null });
  assert.equal(nullState.control.mode, "shadow");
  assert.equal(nullState.reviews.final.status, "not_started");
});

test("Worker 不能返回未声明闸门的等待审批结果", () => {
  const result = validateWorkerResult({
    status: "waiting_approval",
    message: "ready",
    artifacts: [],
    findings: []
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("waiting worker result must declare requiresApproval"));
});

test("审核结果必须绑定正整数产物版本并提供问题证据", () => {
  const result = validateReviewResult({
    stage: "script",
    decision: "revise",
    artifactVersion: null,
    rubricVersion: "script-v1",
    confidence: 0.9,
    blockingIssues: [{ code: "MISSING_SOURCE", evidence: "" }],
    warnings: [],
    passedChecks: []
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("review artifactVersion must be a positive integer"));
  assert.ok(result.errors.includes("review issue MISSING_SOURCE must declare evidence"));
});

test("审核决定与阻断问题必须一致", () => {
  const base = {
    stage: "script",
    artifactVersion: 1,
    rubricVersion: "script-v1",
    confidence: 0.9,
    warnings: [],
    passedChecks: []
  };
  const passing = validateReviewResult({
    ...base,
    decision: "pass",
    blockingIssues: [{ code: "FACT_GAP", evidence: "缺少事实支持" }]
  });
  assert.ok(passing.errors.includes("passing review cannot contain blocking issues"));
  const revision = validateReviewResult({
    ...base,
    decision: "revise",
    blockingIssues: []
  });
  assert.ok(revision.errors.includes("revision review must contain at least one blocking issue"));
});

test("Main Agent 计划拒绝未知动作、非法工具结构和负预算", () => {
  const result = validateMainAgentPlan({
    action: "write_episode",
    reason: "直接修改状态",
    acceptanceCriteria: [],
    toolIds: [""],
    estimatedCostUsd: -1,
    estimatedCalls: -1
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("invalid main action: write_episode"));
  assert.ok(result.errors.includes("toolIds must be an array of non-empty strings"));
  assert.ok(result.errors.includes("estimatedCostUsd must be a non-negative number"));
  assert.ok(result.errors.includes("estimatedCalls must be a non-negative integer"));
});

test("Main Agent 计划必须完整且不能夹带 Schema 外字段", () => {
  const result = validateMainAgentPlan({
    action: "noop",
    workerId: null,
    taskProfile: null,
    reason: "没有合法动作",
    acceptanceCriteria: [],
    reviewProfile: null,
    toolIds: [],
    estimatedCalls: 0,
    estimatedCostUsd: 0,
    limits: { maxAttempts: 1, maxRevisionRounds: 0 },
    fallbackAction: "noop",
    state: { status: "approved" }
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("unexpected main plan field: state"));

  const incomplete = validateMainAgentPlan({ action: "noop", reason: "缺少字段" });
  assert.equal(incomplete.valid, false);
  assert.ok(incomplete.errors.includes("main plan field is required: limits"));
});

test("Worker 只能修改所属候选数据，不能改控制面或绕过人工闸门", () => {
  const source = ensureAgentArchitecture({
    id: "mutation-test",
    approvals: {
      script: {
        status: "pending",
        currentVersion: 1,
        at: null,
        note: "",
        feedback: "",
        history: []
      }
    },
    routingHistory: []
  });
  const base = {
    status: "waiting_approval",
    message: "脚本候选已生成",
    requiresApproval: "script",
    artifacts: [],
    findings: []
  };
  const safe = validateWorkerMutation(source, "script-agent", {
    ...base,
    patch: {
      production: { scriptDraft: { version: 2 } },
      approvals: {
        script: {
          ...source.approvals.script,
          currentVersion: 2
        }
      }
    }
  });
  assert.equal(safe.valid, true);

  const controlPlane = validateWorkerMutation(source, "script-agent", {
    ...base,
    patch: { pipeline: [], control: { mode: "active" } }
  });
  assert.equal(controlPlane.valid, false);
  assert.ok(controlPlane.errors.includes("script-agent cannot patch top-level field: pipeline"));
  assert.ok(controlPlane.errors.includes("worker cannot patch control.mode"));

  const bypass = validateWorkerMutation(source, "script-agent", {
    status: "complete",
    message: "伪造完成",
    artifacts: [],
    findings: [],
    patch: {
      approvals: {
        script: { ...source.approvals.script, status: "approved" }
      }
    }
  });
  assert.equal(bypass.valid, false);
  assert.ok(bypass.errors.includes("script-agent cannot complete before script approval"));
  assert.ok(bypass.errors.includes("script-agent may only reset script approval to pending"));

  const escapedPath = validateWorkerMutation(source, "script-agent", {
    ...base,
    patch: { production: { scriptDraft: { artifactPath: "../../outside.json" } } }
  });
  assert.equal(escapedPath.valid, false);
  assert.ok(
    escapedPath.errors.some((error) => error.includes("worker patch path must stay workspace-relative"))
  );
});

test("Asset Agent 只能按素材清单恢复绑定，不能改写分镜内容", () => {
  const source = ensureAgentArchitecture({
    id: "asset-binding-contract",
    scenes: [{ id: "S01", title: "原始标题", type: "evidence" }],
    assets: [{
      id: "material-v001",
      planItemId: "diagram-1",
      type: "image",
      path: "episodes/test/material-v001.png"
    }],
    production: {
      assetPlan: {
        content: {
          items: [{ id: "diagram-1", sceneIds: ["S01"] }]
        }
      }
    }
  });
  const base = {
    status: "complete",
    message: "素材已重新绑定",
    artifacts: [],
    findings: []
  };
  const safe = validateWorkerMutation(source, "asset-agent", {
    ...base,
    patch: {
      scenes: [{
        ...source.scenes[0],
        asset: "episodes/test/material-v001.png"
      }]
    }
  });
  assert.equal(safe.valid, true);

  const tampered = validateWorkerMutation(source, "asset-agent", {
    ...base,
    patch: {
      scenes: [{
        ...source.scenes[0],
        title: "被素材 Agent 改写",
        asset: "episodes/test/material-v001.png"
      }]
    }
  });
  assert.equal(tampered.valid, false);
  assert.ok(tampered.errors.includes("asset-agent cannot modify storyboard content: S01"));
});

test("Asset Agent 只能登记已批准方案内的零费用本地代码动画", () => {
  const source = ensureAgentArchitecture({
    id: "local-code-asset-contract",
    scenes: [{ id: "S01", title: "原始标题", type: "evidence" }],
    assets: [],
    production: {
      assetPlan: {
        version: 1,
        content: {
          items: [{
            id: "diagram-1",
            sceneIds: ["S01"],
            productionMethod: { kind: "local-code-animation", executor: "render.local" }
          }]
        }
      }
    },
    reviewCheckpoints: {
      assetExecution: {
        currentCandidate: {
          candidateHash: "c".repeat(64)
        }
      }
    }
  });
  const asset = {
    id: "local-code-diagram-1-v1",
    planItemId: "diagram-1",
    version: 1,
    type: "code-animation",
    path: "episodes/test/local-code-assets/diagram-1-v001.json",
    source: "local-code-animation",
    executor: "render.local",
    componentId: "AgentSkillShortExplainer",
    implementationSha256: "b".repeat(64),
    assetPlanVersion: 1,
    candidateHash: "c".repeat(64),
    visualContractHash: null,
    bytes: 128,
    sha256: "a".repeat(64),
    verified: true,
    externalApiCalls: 0,
    maximumPaidCostUsd: 0
  };
  const safe = validateWorkerMutation(source, "asset-agent", {
    status: "complete",
    message: "本地代码动画已登记",
    artifacts: [asset.path],
    findings: [],
    patch: { assets: [asset], scenes: [{ ...source.scenes[0], asset: asset.path }] }
  });
  assert.equal(safe.valid, true);

  const paid = validateWorkerMutation(source, "asset-agent", {
    status: "complete",
    message: "越权登记",
    artifacts: [asset.path],
    findings: [],
    patch: { assets: [{ ...asset, externalApiCalls: 1 }] }
  });
  assert.equal(paid.valid, false);
  assert.ok(paid.errors.includes("asset-agent local code asset does not match approved plan: diagram-1"));
});

test("只有 Asset Agent 能写素材执行检查点，且不能覆盖其他检查点", () => {
  const source = ensureAgentArchitecture({ id: "asset-checkpoint-contract" });
  const checkpoint = { schemaVersion: 1, status: "not_started", history: [] };
  const safe = validateWorkerMutation(source, "asset-agent", {
    status: "blocked",
    message: "等待素材执行审批",
    artifacts: [],
    findings: [],
    patch: { reviewCheckpoints: { assetExecution: checkpoint } }
  });
  assert.equal(safe.valid, true, safe.errors.join("; "));

  const foreign = validateWorkerMutation(source, "asset-agent", {
    status: "blocked",
    message: "越权写入",
    artifacts: [],
    findings: [],
    patch: { reviewCheckpoints: { visualProof: checkpoint } }
  });
  assert.equal(foreign.valid, false);
  assert.ok(foreign.errors.includes("asset-agent cannot patch review checkpoint: visualProof"));

  const forged = validateWorkerMutation(source, "asset-agent", {
    status: "blocked",
    message: "伪造人工批准",
    artifacts: [],
    findings: [],
    patch: {
      reviewCheckpoints: {
        assetExecution: {
          status: "approved",
          humanApproval: { decision: "approved" },
          history: []
        }
      }
    }
  });
  assert.equal(forged.valid, false);
  assert.ok(
    forged.errors.includes("asset-agent cannot create an approved or rejected asset execution checkpoint")
  );
  assert.ok(forged.errors.includes("asset-agent cannot write asset execution human approval"));
});

test("Asset Agent 替换候选时只能先保存与旧候选完全一致的 superseded 快照", () => {
  const oldCandidate = {
    version: 11,
    candidateHash: "1".repeat(64),
    artifact: {
      path: "studio/data/production/episodes/test/asset-plan-v011.json",
      bytes: 128,
      sha256: "2".repeat(64)
    },
    planHash: "3".repeat(64),
    sourceStoryboard: {
      version: 4,
      artifactHash: "4".repeat(64),
      reviewReportId: "review-storyboard-v4"
    },
    localCodeImplementation: {
      schemaVersion: "local-code-implementation-v3",
      componentId: "AgentSkillShortExplainer",
      files: [
        "studio/src/video/agent-skill-short.jsx",
        "studio/src/video/agent-skill-short-plan.mjs",
        "studio/src/video/components/chrome.jsx",
        "studio/src/video/episode-preview.jsx",
        "studio/src/shared/technical-diagram-contract.mjs"
      ].map((path, index) => ({
        path,
        bytes: 1_000 + index,
        sha256: String(index + 1).repeat(64)
      })),
      sha256: "9".repeat(64)
    },
    summary: {
      itemCount: 6,
      externalApiCallCount: 0,
      maximumPaidCostUsd: 0
    }
  };
  const newCandidate = {
    ...oldCandidate,
    version: 12,
    candidateHash: "5".repeat(64),
    artifact: {
      path: "studio/data/production/episodes/test/asset-plan-v012.json",
      bytes: 129,
      sha256: "6".repeat(64)
    },
    planHash: "7".repeat(64)
  };
  const previousHistory = [{
    type: "human-approval",
    version: 11,
    candidateHash: oldCandidate.candidateHash,
    decision: "rejected"
  }];
  const source = ensureAgentArchitecture({
    id: "asset-candidate-superseded-contract",
    reviewCheckpoints: {
      assetExecution: {
        schemaVersion: 1,
        status: "rejected",
        currentCandidate: oldCandidate,
        machineReview: {
          id: "asset-review-v11",
          status: "passed",
          candidateHash: oldCandidate.candidateHash,
          checks: []
        },
        humanApproval: { decision: "rejected", candidateHash: oldCandidate.candidateHash },
        history: previousHistory
      }
    }
  });
  const superseded = {
    type: "candidate-superseded",
    at: "2026-08-18T00:00:00.000Z",
    candidate: structuredClone(oldCandidate),
    supersededByVersion: newCandidate.version,
    supersededByCandidateHash: newCandidate.candidateHash
  };
  const machineReviewHistory = {
    type: "machine-review",
    at: "2026-08-18T00:00:00.000Z",
    version: newCandidate.version,
    candidateHash: newCandidate.candidateHash,
    reviewId: "asset-review-v12",
    status: "passed"
  };
  const checkpoint = {
    schemaVersion: 1,
    status: "waiting_approval",
    currentCandidate: newCandidate,
    machineReview: {
      id: "asset-review-v12",
      status: "passed",
      candidateHash: newCandidate.candidateHash,
      checks: []
    },
    humanApproval: null,
    history: [...previousHistory, superseded, machineReviewHistory]
  };
  const safe = validateWorkerMutation(source, "asset-agent", {
    status: "blocked",
    message: "新候选等待人工审批",
    artifacts: [newCandidate.artifact.path],
    findings: [],
    requiresHuman: true,
    patch: { reviewCheckpoints: { assetExecution: checkpoint } }
  });
  assert.equal(safe.valid, true, safe.errors.join("; "));

  const tampered = validateWorkerMutation(source, "asset-agent", {
    status: "blocked",
    message: "伪造旧候选快照",
    artifacts: [newCandidate.artifact.path],
    findings: [],
    requiresHuman: true,
    patch: {
      reviewCheckpoints: {
        assetExecution: {
          ...checkpoint,
          history: [
            ...previousHistory,
            { ...superseded, candidate: { ...superseded.candidate, planHash: "8".repeat(64) } },
            machineReviewHistory
          ]
        }
      }
    }
  });
  assert.equal(tampered.valid, false);
  assert.ok(tampered.errors.includes("asset-agent may only append machine review checkpoint history"));

  const tamperedImplementation = validateWorkerMutation(source, "asset-agent", {
    status: "blocked",
    message: "篡改旧候选实现摘要",
    artifacts: [newCandidate.artifact.path],
    findings: [],
    requiresHuman: true,
    patch: {
      reviewCheckpoints: {
        assetExecution: {
          ...checkpoint,
          history: [
            ...previousHistory,
            {
              ...superseded,
              candidate: {
                ...superseded.candidate,
                localCodeImplementation: {
                  ...superseded.candidate.localCodeImplementation,
                  sha256: "0".repeat(64)
                }
              }
            },
            machineReviewHistory
          ]
        }
      }
    }
  });
  assert.equal(tamperedImplementation.valid, false);
  assert.ok(
    tamperedImplementation.errors.includes(
      "asset-agent may only append machine review checkpoint history"
    )
  );
});

test("Worker 产物路径必须留在工作区，路由记录不能持久化敏感字段", () => {
  const result = validateWorkerResult({
    status: "blocked",
    message: "bad path",
    artifacts: ["../outside.txt"],
    findings: []
  });
  assert.ok(result.errors.includes("worker artifacts must contain safe workspace-relative paths"));

  const sensitiveField = ["api", "Key"].join("");
  const decision = {
    id: "route-sensitive-test",
    profile: "planner",
    reason: "test",
    candidates: [],
    selected: { providerId: "primary", model: "model-a" },
    estimatedCostUsd: 0,
    [sensitiveField]: "placeholder"
  };
  assert.equal(validateRoutingDecision(decision).valid, false);
});
