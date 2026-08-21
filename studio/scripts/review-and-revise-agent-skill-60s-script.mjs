import { recheckGateReview, runNextReadyAgent } from "../src/server/orchestrator.mjs";
import { readEpisode } from "../src/shared/store.mjs";

const EPISODE_ID = "agent-skill-tool-mcp-60s-20260813";

const current = await readEpisode(EPISODE_ID);
const currentStep = current.pipeline.find((step) => step.id === "script");
const currentReport = current.reviews.script.reports.find(
  (report) => report.id === current.reviews.script.latestReportId
);
const recheck = currentStep?.status === "blocked" && currentReport?.decision === "revise"
  ? { episode: current, review: { report: currentReport } }
  : await recheckGateReview(EPISODE_ID, "script");
if (recheck.review?.report.decision !== "revise") {
  throw new Error(
    `预期 Review Coordinator 因重复口播退回 v1，实际为 ${recheck.review?.report.decision ?? "missing"}`
  );
}

const revised = await runNextReadyAgent(EPISODE_ID);
console.log(JSON.stringify({
  episodeId: EPISODE_ID,
  rejectedCandidate: {
    version: recheck.review.report.artifactVersion,
    decision: recheck.review.report.decision,
    reportId: recheck.review.report.id,
    blockingIssues: recheck.review.report.blockingIssues
  },
  revisedCandidate: {
    version: revised.episode.production.scriptDraft?.version,
    artifactPath: revised.episode.production.scriptDraft?.artifactPath,
    status: revised.output.status,
    message: revised.output.message,
    decision: revised.review?.report.decision,
    reportId: revised.review?.report.id,
    blockingIssues: revised.review?.report.blockingIssues,
    warnings: revised.review?.report.warnings
  },
  approval: revised.episode.approvals.script,
  content: revised.episode.production.scriptDraft?.content
}, null, 2));
