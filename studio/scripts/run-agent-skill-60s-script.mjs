import { runNextReadyAgent } from "../src/server/orchestrator.mjs";

const EPISODE_ID = "agent-skill-tool-mcp-60s-20260813";
const result = await runNextReadyAgent(EPISODE_ID);

console.log(JSON.stringify({
  episodeId: EPISODE_ID,
  status: result.output.status,
  message: result.output.message,
  requiresApproval: result.output.requiresApproval,
  script: {
    version: result.episode.production.scriptDraft?.version,
    artifactPath: result.episode.production.scriptDraft?.artifactPath,
    provider: result.episode.production.scriptDraft?.provider,
    model: result.episode.production.scriptDraft?.model,
    generationKind: result.episode.production.scriptDraft?.generationKind,
    sourceSnapshotHash: result.episode.production.scriptDraft?.sourceSnapshotHash,
    targetDurationSeconds: result.episode.production.scriptDraft?.content?.targetDurationSeconds,
    sections: result.episode.production.scriptDraft?.content?.sections?.length
  },
  review: {
    decision: result.review?.report.decision,
    reportId: result.review?.report.id,
    reviewMode: result.review?.report.reviewMode,
    semanticReviewerId: result.review?.report.semanticReviewerId,
    semanticReviewerKind: result.review?.report.semanticReviewerKind,
    blockingIssues: result.review?.report.blockingIssues,
    warnings: result.review?.report.warnings
  },
  approval: result.episode.approvals.script
}, null, 2));
