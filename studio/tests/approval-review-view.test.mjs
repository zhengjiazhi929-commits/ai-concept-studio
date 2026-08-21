import test from "node:test";
import assert from "node:assert/strict";
import {
  approvalBindingComplete,
  approvalDialogShell,
  approvalReviewBelongsToEpisode,
  approvalReviewCanApprove,
  approvalReviewCanReject,
  approvalReviewRequestIsCurrent,
  buildApprovalDecisionRequest,
  isApprovalBindingConflict,
  renderApprovalReview,
  renderApprovalSummaryButton,
  safeApprovalMediaUrl
} from "../src/web/approval-review-view.mjs";
import { buildHumanApprovalView } from "../src/server/reviews/human-approval-view.mjs";
import {
  historicalApprovedStoryboardV3Episode
} from "./historical-approved-storyboard-v3.fixture.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function baseReview(type, binding) {
  return {
    schemaVersion: "human-approval-view-v1",
    type,
    episode: { id: "fixture-episode", title: "自包含测试" },
    status: {
      approvalStatus: "pending",
      workflowStatus: "waiting_approval",
      machineStatus: "passed",
      completeForHumanReview: true,
      readyForHumanApproval: true
    },
    binding,
    approvalObject: { status: "pending" },
    content: {},
    changes: [],
    evidence: [],
    risks: [],
    machineReview: {
      status: "passed",
      checks: [],
      warnings: [],
      blockingIssues: []
    },
    consequences: {
      onApprove: ["允许进入下一道受控流程"],
      doesNotHappen: ["不会自动发布"]
    },
    nextActions: [
      { id: "approve", label: "批准", allowed: true },
      { id: "reject", label: "退回", allowed: true }
    ]
  };
}

function storyboardReview() {
  const review = baseReview("storyboard", {
    artifactVersion: 4,
    artifactHash: HASH_A,
    reviewReportId: "review-storyboard-v4-fixture"
  });
  review.content = {
    draft: {
      visualRules: ["规则一", "规则二 <script>alert(1)</script>"],
      assetChecklist: ["架构图", "透明字幕"]
    },
    scenes: Array.from({ length: 9 }, (_, index) => ({
      id: `S${String(index + 1).padStart(2, "0")}`,
      start: index * 6,
      end: index === 8 ? 60 : (index + 1) * 6,
      title: `镜头 ${index + 1}`,
      statement: `说明 ${index + 1}`,
      subtitle: index === 0 ? "字幕 <img src=x onerror=alert(1)>" : `字幕 ${index + 1}`,
      assetHint: `动画要求 ${index + 1}`
    })),
    subtitles: Array.from({ length: 14 }, (_, index) => ({
      start: index * 4,
      end: Math.min(60, (index + 1) * 4),
      text: `完整字幕 ${index + 1}`
    })),
    renderSpecification: { durationSeconds: 60, width: 540, height: 960, fps: 30 }
  };
  review.machineReview = {
    status: "passed",
    warnings: [{ code: "evidence-assets", evidence: "最终需绑定真实素材" }],
    blockingIssues: [],
    checks: [
      { code: "timeline", label: "时间轴连续", passed: true, actual: 60, expected: 60 },
      { code: "unsafe", label: "恶意 <b>标签</b>", passed: true }
    ]
  };
  review.evidence = [{ label: "脚本绑定", value: HASH_B }];
  review.changes = ["两处硬切改为短交叉过渡"];
  review.risks = ["真实素材仍需下一阶段核验"];
  return review;
}

function assetReview() {
  const review = baseReview("asset-execution", {
    candidateVersion: 11,
    candidateHash: HASH_B,
    machineReviewId: "asset-execution-review-v011-fixture",
    planHash: HASH_C
  });
  review.content = {
    plan: {
      content: {
        items: [
          {
            id: "architecture",
            purpose: "技术架构图",
            assetType: "technical-diagram",
            sceneIds: ["S01", "S02"],
            required: true,
            productionMethod: {
              kind: "local-code-animation",
              executor: "render.local",
              externalProvider: null,
              externalModel: null,
              notes: "本地代码动画"
            },
            estimatedCost: { maximumCostUsd: 0 }
          },
          {
            id: "generated-flow",
            purpose: "逐步流程动画",
            assetType: "video",
            sceneIds: ["S05"],
            required: true,
            productionMethod: {
              kind: "external-video",
              executor: "asset-agent",
              externalProvider: "provider <unsafe>",
              externalModel: "video-model"
            },
            estimatedCost: { maximumCostUsd: 2 }
          }
        ],
        executionPolicy: {
          mode: "mixed",
          maximumPaidCostUsd: 2.35,
          currency: "USD",
          humanApprovalRequiredBeforeExecution: true,
          invalidatesOnPlanChange: true,
          externalApiCalls: [{
            id: "video-call",
            providerId: "volcengine-ark",
            model: "video-model",
            purpose: "生成流程动画 <script>bad()</script>",
            estimatedCalls: 1,
            maximumCostUsd: 2,
            billing: { currency: "CNY", maximumAmount: 13 }
          }]
        }
      }
    },
    candidate: {
      summary: { itemCount: 2, externalApiCallCount: 1, maximumPaidCostUsd: 2.35 }
    },
    items: [],
    executionPolicy: null,
    prompts: []
  };
  review.content.items = review.content.plan.content.items;
  review.content.executionPolicy = review.content.plan.content.executionPolicy;
  review.content.prompts = review.content.executionPolicy.externalApiCalls;
  review.machineReview = {
    status: "passed",
    warnings: ["外部调用必须先做零生成预检"],
    blockingIssues: [],
    checks: Array.from({ length: 3 }, (_, index) => ({
      id: `check-${index + 1}`,
      label: `机器检查 ${index + 1}`,
      passed: true,
      actual: { index },
      expected: { passed: true }
    }))
  };
  review.risks = ["最多 CNY 13", "只有列明的 Provider 和模型可用"];
  review.consequences = {
    onApprove: ["仅授权列明的执行范围"],
    doesNotHappen: ["审批动作本身不会调用 API", "不会自动发布视频"]
  };
  review.nextActions = [
    { id: "approve", label: "批准后先运行零生成预检", allowed: true },
    { id: "reject", label: "退回 Asset Agent", allowed: true },
    { id: "execute", label: "再由 Asset Agent 执行", allowed: false }
  ];
  return review;
}

test("Storyboard 审批详情完整展示 9 镜、字幕、规则、警告与精确绑定并转义文本", () => {
  const html = renderApprovalReview(storyboardReview(), "storyboard");
  assert.match(html, /Storyboard 9 镜/u);
  assert.match(html, /自包含测试 · Episode ID：<code>fixture-episode<\/code>/u);
  assert.match(html, /S01/u);
  assert.match(html, /S09/u);
  assert.match(html, /完整字幕 14/u);
  assert.equal((html.match(/<h3>完整字幕<\/h3>/gu) ?? []).length, 1);
  assert.match(html, /规则一/u);
  assert.match(html, /evidence-assets/u);
  assert.match(html, new RegExp(HASH_A, "u"));
  assert.match(html, /review-storyboard-v4-fixture/u);
  assert.doesNotMatch(html, /<img src=x/u);
  assert.doesNotMatch(html, /<script>alert/u);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.match(html, /恶意 &lt;b&gt;标签&lt;\/b&gt;/u);
});

test("Asset 审批详情展示全部 items、外部调用、费用、风险、机器 checks 和影响边界", () => {
  const html = renderApprovalReview(assetReview(), "asset-execution");
  assert.match(html, /全部制作条目/u);
  assert.match(html, /architecture/u);
  assert.match(html, /generated-flow/u);
  assert.match(html, /video-call/u);
  assert.match(html, /CNY 13/u);
  assert.match(html, /最高 USD 2\.35/u);
  assert.match(html, /机器检查 3/u);
  assert.match(html, /审批动作本身不会调用 API/u);
  assert.match(html, /不会自动发布视频/u);
  assert.match(html, /先运行零生成预检/u);
  assert.doesNotMatch(html, /<script>bad/u);
  assert.match(html, /provider &lt;unsafe&gt;/u);
});

test("摘要没有直批或直退，只提供查看并审批入口", () => {
  const html = renderApprovalSummaryButton({
    target: "storyboard",
    status: "waiting_approval"
  });
  assert.match(html, />查看并审批</u);
  assert.match(html, /data-action="open-approval-review"/u);
  assert.doesNotMatch(html, /data-action="approve"/u);
  assert.doesNotMatch(html, /data-action="reject"/u);
  assert.match(renderApprovalSummaryButton({
    target: "storyboard",
    status: "approved"
  }), />查看并审批</u);
});

test("批准和退回请求只使用当前打开审批单的 exact binding", () => {
  const storyboard = storyboardReview();
  const approved = buildApprovalDecisionRequest({
    episodeId: "fixture-episode",
    target: "storyboard",
    review: storyboard,
    decision: "approved",
    note: "通过"
  });
  assert.equal(approved.path, "/api/episodes/fixture-episode/approvals/storyboard");
  assert.deepEqual(approved.body, {
    artifactVersion: 4,
    artifactHash: HASH_A,
    reviewReportId: "review-storyboard-v4-fixture",
    note: "通过"
  });

  const neutralDefault = buildApprovalDecisionRequest({
    episodeId: "fixture-episode",
    target: "storyboard",
    review: storyboard,
    decision: "approved",
    note: ""
  });
  assert.equal(neutralDefault.body.note, "通过本地审批详情提交批准");
  assert.doesNotMatch(neutralDefault.body.note, /完整阅读/u);

  const asset = assetReview();
  const rejected = buildApprovalDecisionRequest({
    episodeId: "fixture-episode",
    target: "asset-execution",
    review: asset,
    decision: "rejected",
    note: "流程动画需修改"
  });
  assert.equal(
    rejected.path,
    "/api/episodes/fixture-episode/asset-execution-review/reject"
  );
  assert.deepEqual(rejected.body, {
    candidateHash: HASH_B,
    machineReviewId: "asset-execution-review-v011-fixture",
    feedback: "流程动画需修改"
  });
});

test("binding 不完整时 fail-closed，详情不提供可用批准按钮", () => {
  const review = storyboardReview();
  delete review.binding.reviewReportId;
  assert.equal(approvalBindingComplete(review, "storyboard"), false);
  assert.equal(approvalReviewCanApprove(review, "storyboard"), false);
  assert.throws(
    () => buildApprovalDecisionRequest({
      episodeId: "fixture-episode",
      target: "storyboard",
      review,
      decision: "approved"
    }),
    (error) => error.code === "approval_binding_incomplete"
  );
  const html = renderApprovalReview(review, "storyboard");
  assert.match(html, /data-action="approve-open-approval" disabled/u);
  assert.match(html, /精确绑定字段不完整/u);
});

test("审批提交阶段的任何 409 都必须关闭旧详情并重新阅读", () => {
  assert.equal(isApprovalBindingConflict({
    status: 409,
    code: "storyboard_approval_binding_conflict"
  }), true);
  assert.equal(isApprovalBindingConflict({
    status: 409,
    code: "asset_execution_review_conflict"
  }), true);
  assert.equal(isApprovalBindingConflict({
    status: 409,
    code: "state_version_conflict"
  }), true);
  assert.equal(isApprovalBindingConflict({ status: 409, code: "unknown_conflict" }), true);
  assert.equal(isApprovalBindingConflict({ status: 500, code: "internal_error" }), false);
});

test("异步审批响应只在 nonce、Episode、target 和 dialog 均仍匹配时可落 UI", () => {
  const current = {
    requestToken: 8,
    currentToken: 8,
    requestedEpisodeId: "episode-a",
    selectedEpisodeId: "episode-a",
    openEpisodeId: "episode-a",
    requestedTarget: "storyboard",
    openTarget: "storyboard",
    dialogOpen: true
  };
  assert.equal(approvalReviewRequestIsCurrent(current), true);
  assert.equal(approvalReviewRequestIsCurrent({ ...current, currentToken: 9 }), false);
  assert.equal(approvalReviewRequestIsCurrent({ ...current, selectedEpisodeId: "episode-b" }), false);
  assert.equal(approvalReviewRequestIsCurrent({ ...current, openTarget: "assets" }), false);
  assert.equal(approvalReviewRequestIsCurrent({ ...current, dialogOpen: false }), false);
  assert.equal(approvalReviewBelongsToEpisode({ episode: { id: "episode-a" } }, "episode-a"), true);
  assert.equal(approvalReviewBelongsToEpisode({ episode: { id: "episode-b" } }, "episode-a"), false);
  assert.equal(approvalReviewBelongsToEpisode({}, "episode-a"), false);
});

test("原生 dialog shell 提供标题和描述关联，支持浏览器 Escape 与焦点语义", () => {
  const html = approvalDialogShell();
  assert.match(html, /^<dialog/u);
  assert.match(html, /id="approvalDialog"/u);
  assert.match(html, /aria-labelledby="approvalDialogTitle"/u);
  assert.match(html, /aria-describedby="approvalDialogDescription"/u);
});

test("真实 server presenter 输出可直接交给前端渲染，不依赖另一套手写字段", () => {
  const episode = historicalApprovedStoryboardV3Episode();
  const step = episode.pipeline.find((item) => item.id === "storyboard");
  step.status = "waiting_approval";
  step.requiresApproval = "storyboard";
  episode.approvals.storyboard = {
    ...episode.approvals.storyboard,
    status: "pending",
    at: null,
    note: "",
    provenance: null,
    reviewReportId: null,
    artifactHash: null
  };
  const review = buildHumanApprovalView(episode, "storyboard");
  assert.equal(review.status.readyForHumanApproval, true);
  assert.equal(approvalReviewCanApprove(review, "storyboard"), true);
  const html = renderApprovalReview(review, "storyboard");
  assert.match(html, new RegExp(`Storyboard ${episode.scenes.length} 镜`, "u"));
  assert.match(html, /批准此精确版本/u);
  assert.match(html, /不会执行素材方案或产生费用/u);
});

test("媒体预览只接受规范化本地 outputs 或 public 路径", () => {
  assert.equal(
    safeApprovalMediaUrl("outputs/studio/episode/review v1.mp4"),
    "/outputs/episode/review%20v1.mp4"
  );
  assert.equal(
    safeApprovalMediaUrl("studio/public/episodes/demo/voice.wav"),
    "/assets/episodes/demo/voice.wav"
  );
  assert.equal(
    safeApprovalMediaUrl("episodes/demo/still.png"),
    "/assets/episodes/demo/still.png"
  );
  assert.equal(safeApprovalMediaUrl("/Users/example/secret.mp4"), null);
  assert.equal(safeApprovalMediaUrl("https://example.com/video.mp4"), null);
  assert.equal(safeApprovalMediaUrl("outputs/studio/../secret.mp4"), null);
});

test("Assets 与 Final 详情只为安全本地路径生成媒体控件", () => {
  const assets = baseReview("assets", {
    artifactVersion: 2,
    artifactHash: HASH_A,
    reviewReportId: "review-assets-v2"
  });
  assets.content = {
    assetPlan: { content: { items: [] } },
    assets: [
      { id: "safe-image", type: "image", path: "episodes/demo/still.png", sha256: HASH_B },
      { id: "unsafe-video", type: "video", path: "/tmp/private.mp4", sha256: HASH_C }
    ],
    voiceIntegrity: {
      status: "ready",
      publicPath: "episodes/demo/voice.wav",
      sha256: HASH_C
    }
  };
  const assetsHtml = renderApprovalReview(assets, "assets");
  assert.match(assetsHtml, /<img loading="lazy" src="\/assets\/episodes\/demo\/still\.png"/u);
  assert.match(assetsHtml, /<audio controls preload="metadata" src="\/assets\/episodes\/demo\/voice\.wav"/u);
  assert.doesNotMatch(assetsHtml, /src="\/tmp\/private\.mp4"/u);
  assert.match(assetsHtml, /SHA-256/u);

  const final = baseReview("final", {
    artifactVersion: 3,
    artifactHash: HASH_A,
    reviewReportId: "review-final-v3"
  });
  final.content = {
    video: {
      outputPath: "outputs/studio/demo/final.mp4",
      sha256: HASH_B,
      width: 540,
      height: 960,
      fps: 30,
      durationSeconds: 60
    },
    qa: { status: "passed" }
  };
  final.consequences = {
    onApprove: ["批准项目内最终版本"],
    doesNotHappen: ["不会自动发布"]
  };
  const finalHtml = renderApprovalReview(final, "final");
  assert.match(finalHtml, /<video controls preload="metadata" src="\/outputs\/demo\/final\.mp4"/u);
  assert.match(finalHtml, /不会自动发布/u);
});

test("Visual Proof 使用独立精确绑定和视频预览，且没有前端伪造的退回入口", () => {
  const review = baseReview("visualProof", {
    candidateVersion: 14,
    candidateHash: HASH_B,
    machineReviewId: "visual-proof-review-v014"
  });
  review.content = {
    candidate: {
      version: 14,
      sourceRenderVersion: 9,
      candidateHash: HASH_B,
      video: {
        path: "outputs/studio/fixture-episode/visual-proof-v014.mp4",
        sha256: HASH_C,
        bytes: 123456
      }
    }
  };
  review.nextActions = [{ id: "approve", label: "批准视觉样片", allowed: true }];
  review.consequences = {
    onApprove: ["只批准视觉样片检查点"],
    doesNotHappen: ["不会批准最终成片", "不会自动发布"]
  };
  assert.equal(approvalBindingComplete(review, "visual-proof"), true);
  assert.equal(approvalReviewCanApprove(review, "visual-proof"), true);
  assert.equal(approvalReviewCanReject(review, "visual-proof"), false);
  const html = renderApprovalReview(review, "visual-proof");
  assert.match(html, /当前视觉样片/u);
  assert.match(html, /src="\/outputs\/fixture-episode\/visual-proof-v014\.mp4"/u);
  assert.doesNotMatch(html, /data-action="reject-open-approval"/u);
  assert.match(html, /不会批准最终成片/u);
  const request = buildApprovalDecisionRequest({
    episodeId: "fixture-episode",
    target: "visual-proof",
    review,
    decision: "approved"
  });
  assert.deepEqual(request, {
    path: "/api/episodes/fixture-episode/visual-proof-review/approve",
    body: {
      candidateHash: HASH_B,
      machineReviewId: "visual-proof-review-v014",
      note: "通过本地审批详情提交批准"
    }
  });
  assert.throws(
    () => buildApprovalDecisionRequest({
      episodeId: "fixture-episode",
      target: "visual-proof",
      review,
      decision: "rejected",
      note: "退回"
    }),
    (error) => error.code === "approval_rejection_unavailable"
  );
});
