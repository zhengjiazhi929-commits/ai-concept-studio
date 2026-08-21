import { runAgent } from "../src/server/orchestrator.mjs";
import { readReviewConfig } from "../src/server/reviews/coordinator.mjs";
import { readEpisode } from "../src/shared/store.mjs";
import { currentGateVersion } from "../src/shared/workflow.mjs";

const episodeId = process.argv[2] ?? "agent-skill-20260806";
if (episodeId !== "agent-skill-20260806") {
  throw new Error("这个离线审核夹具只允许用于 agent-skill-20260806");
}

const before = await readEpisode(episodeId);
const artifactVersion = currentGateVersion(before, "assets");
const config = await readReviewConfig();
config.stages.assets.semanticReview = true;
let reviewerCalls = 0;

const semanticReviewer = async ({ stage, context }) => {
  reviewerCalls += 1;
  const items = context.artifact?.plan?.content?.items ?? [];
  const incomplete = items.find((item) =>
    item.required && String(item.rightsRequirement ?? "").includes("待确认")
  );
  if (incomplete) {
    return {
      stage,
      decision: "revise",
      artifactVersion,
      rubricVersion: "assets-v3",
      confidence: 0.97,
      blockingIssues: [{
        code: "ASSET_PLAN_RIGHTS_GAP",
        evidence: `${incomplete.id} 的素材版权边界仍标记为待确认。`,
        location: `production.assetPlan.content.items.${incomplete.id}.rightsRequirement`,
        suggestedFix: "由 Asset Agent 明确该素材为项目原创图解，并写明不得复制官方页面视觉资产。",
        ownerAgentId: "asset-agent"
      }],
      warnings: [],
      passedChecks: []
    };
  }
  return {
    stage,
    decision: "pass",
    artifactVersion,
    rubricVersion: "assets-v3",
    confidence: 0.98,
    blockingIssues: [],
    warnings: [],
    passedChecks: ["asset-rights-boundaries"]
  };
};

const result = await runAgent(episodeId, "voice-agent", {
  review: {
    config,
    semanticReviewer,
    semanticReviewerId: "offline-assets-reviewer-v1",
    semanticReviewerKind: "test-double"
  },
  limits: { maxAttempts: 1, maxRevisionRounds: 0 }
});

console.log(JSON.stringify({
  episodeId,
  reviewerCalls,
  output: {
    status: result.output.status,
    message: result.output.message,
    requiresApproval: result.output.requiresApproval,
    requiresHuman: result.output.requiresHuman
  },
  review: result.review ? {
    decision: result.review.report.decision,
    reviewMode: result.review.report.reviewMode,
    semanticReviewerKind: result.review.report.semanticReviewerKind,
    rubricVersion: result.review.report.rubricVersion,
    reviewConfigVersion: result.review.report.reviewConfigVersion,
    revisionTargets: result.review.revisionTargets,
    blockingIssues: result.review.report.blockingIssues
  } : null,
  pipeline: {
    asset: result.episode.pipeline.find((step) => step.agent === "asset-agent")?.status,
    voice: result.episode.pipeline.find((step) => step.agent === "voice-agent")?.status
  },
  assetPlanNeedsRevision: result.episode.production?.assetPlan?.needsRevision
}, null, 2));
