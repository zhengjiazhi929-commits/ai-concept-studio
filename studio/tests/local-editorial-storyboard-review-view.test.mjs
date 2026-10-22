import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReviewMap } from "../src/shared/agent-contracts.mjs";
import { createApprovalMap, currentGateArtifactHash } from "../src/shared/workflow.mjs";
import { buildHumanApprovalView } from "../src/server/reviews/human-approval-view.mjs";
import { evaluateProductionQuality } from "../src/server/production/quality.mjs";
import { renderApprovalReview } from "../src/web/approval-review-view.mjs";

function editorialEpisode() {
  const shots = ["先取得样本。", "然后核对编号。", "最后记录观察。"].map((narration, index) => ({
    id: `E${index + 1}`,
    title: `样本演示 ${index + 1}`,
    unitIds: [`sample:p${index + 1}`],
    form: "独立过程示意",
    layout: `布局说明 ${index + 1}`,
    beats: [{ cue: narration.slice(0, 2), action: `动作 ${index + 1}`, result: `结果 ${index + 1}` }],
    guard: `约束 ${index + 1}`,
    implementation: `待实现 ${index + 1}`,
    narration,
    sourceUnits: [{ id: `sample:p${index + 1}`, sha256: createHash("sha256").update(narration).digest("hex") }],
    evidenceRefs: ["sample-source"],
    timing: { mode: "narration-cues", startSeconds: null, endSeconds: null, note: "等待自然语速对齐" }
  }));
  return {
    id: "editorial-review-synthetic",
    title: "合成样本说明",
    concept: "样本记录",
    thesis: "用合成样本验证审核内容展示不等于渲染完成。",
    audience: "需要核对样本记录的测试人员",
    control: { reviewEnabled: true },
    pipeline: [{ id: "storyboard", gate: "storyboard", status: "waiting_approval" }],
    approvals: createApprovalMap({ storyboard: { currentVersion: 1 } }),
    reviews: createReviewMap(),
    sourceDocs: [1, 2, 3].map((number) => ({ path: `synthetic-source-${number}.md` })),
    production: {
      storyboardDraft: {
        version: 1,
        artifactPath: "synthetic-storyboard-v1.json",
        generationKind: "codex-local-storyboard-import",
        storyboardKind: "editorial-cue-plan-v1",
        content: {
          title: "合成样本说明",
          globalStyle: { background: "synthetic-theme", connections: "orthogonal-only" },
          timingPolicy: "时长尚未实测，不为了目标时长拉慢。",
          implementationBoundary: "编辑计划，不是已实现画面。",
          shots
        }
      }
    },
    scenes: [],
    subtitles: [],
    render: { width: 1920, height: 1080, fps: 30, durationSeconds: null }
  };
}

function bindPassedReview(episode) {
  const artifactHash = currentGateArtifactHash(episode, "storyboard");
  const report = { id: "synthetic-passed-report", decision: "pass", artifactVersion: 1, artifactHash, checks: [], warnings: [], blockingIssues: [] };
  episode.reviews.storyboard = { status: "passed", artifactVersion: 1, artifactHash, latestReportId: report.id, reports: [report] };
}

test("editorial storyboard review exposes all shots, actions and guards without inventing a timed scene", () => {
  const episode = editorialEpisode();
  const before = structuredClone(episode);
  const view = buildHumanApprovalView(episode, "storyboard");
  assert.deepEqual(view.content.editorialPlan, episode.production.storyboardDraft.content);
  assert.deepEqual(view.content.editorialReadiness, {
    timing: "unmeasured", execution: "unimplemented", audioAligned: false, renderReady: false
  });
  assert.equal(view.content.artifactReadable, true);
  assert.deepEqual(view.content.scenes, []);
  assert.deepEqual(view.content.subtitles, []);
  assert.equal(view.changes.currentContentSummary.editorialShotCount, 3);
  assert.deepEqual(view.changes.currentContentSummary.editorialShotIds, ["E1", "E2", "E3"]);
  assert.equal(view.evidence.editorialShotCount, 3);
  assert.equal(view.evidence.playablePreview, null);
  assert.deepEqual(episode, before);
});

test("editorial storyboard remains non-approvable even with a stale or constructed passed report", () => {
  const episode = editorialEpisode();
  bindPassedReview(episode);
  const view = buildHumanApprovalView(episode, "storyboard");
  assert.equal(view.status.bindingComplete, true);
  assert.equal(view.status.completeForHumanReview, true);
  assert.equal(view.status.readyForHumanApproval, false);
  assert.equal(view.status.needsRevision, true);
  assert.equal(view.nextActions.find((action) => action.id === "approve").allowed, false);
  for (const code of ["editorial-timing-unmeasured", "editorial-execution-unimplemented"]) {
    assert.ok(view.risks.some((risk) => risk.code === code && risk.level === "blocking"));
  }
});

test("editorial quality reports missing timing and execution without dropping old timed checks", () => {
  for (const stage of ["storyboard", "voice", "qa"]) {
    const quality = evaluateProductionQuality(editorialEpisode(), { stage });
    assert.equal(quality.passed, false);
    for (const id of ["editorial-timing-unmeasured", "editorial-execution-unimplemented"]) {
      const check = quality.checks.find((item) => item.id === id);
      assert.equal(check?.passed, false);
      assert.equal(check.severity, "error");
      assert.equal(check.ownerAgentId, "storyboard-agent");
    }
    assert.equal(quality.checks.find((item) => item.id === "scene-count").passed, false);
    assert.equal(quality.checks.find((item) => item.id === "subtitle-timeline").passed, false);
  }
});

test("either editorial discriminator fails closed instead of silently becoming a legacy draft", () => {
  for (const removed of ["generationKind", "storyboardKind"]) {
    const episode = editorialEpisode();
    delete episode.production.storyboardDraft[removed];
    const quality = evaluateProductionQuality(episode, { stage: "storyboard" });
    assert.equal(quality.checks.find((item) => item.id === "editorial-execution-unimplemented")?.passed, false);
    const view = buildHumanApprovalView(episode, "storyboard");
    assert.equal(view.content.editorialPlan.shots.length, 3);
    assert.equal(view.status.readyForHumanApproval, false);
  }
});

test("editorial browser review shows full narrative beats and escaped content with no invented zero-second clock", () => {
  const episode = editorialEpisode();
  episode.production.storyboardDraft.content.shots[2].beats[0].action = "动作 <img src=x onerror=alert(1)>";
  const view = buildHumanApprovalView(episode, "storyboard");
  const html = renderApprovalReview(view, "storyboard");
  for (const value of ["编辑分镜 3 镜", "尚未配音或对齐", "尚未实现动作", "布局说明 3", "最后记录观察。", "约束 3", "待实现 3", "结果 3", "orthogonal-only", "sample:p3"]) {
    assert.ok(html.includes(value), value);
  }
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("0s–0s"));
  assert.match(html, /data-action="approve-open-approval" disabled/);
});

test("legacy timed storyboard view and quality do not gain editorial fields or new blockers", () => {
  const episode = editorialEpisode();
  delete episode.production.storyboardDraft.generationKind;
  delete episode.production.storyboardDraft.storyboardKind;
  delete episode.production.storyboardDraft.content;
  episode.scenes = [{ id: "S01", start: 0, end: 4, title: "原有定时画面", type: "title" }];
  episode.subtitles = [{ start: 0, end: 4, text: "原有定时字幕。" }];
  episode.render.durationSeconds = 4;
  bindPassedReview(episode);
  const view = buildHumanApprovalView(episode, "storyboard");
  assert.equal(Object.hasOwn(view.content, "editorialPlan"), false);
  assert.equal(Object.hasOwn(view.content, "editorialReadiness"), false);
  assert.equal(view.status.readyForHumanApproval, true);
  const quality = evaluateProductionQuality(episode, { stage: "storyboard" });
  assert.ok(!quality.checks.some((check) => check.id.startsWith("editorial-")));
  const html = renderApprovalReview(view, "storyboard");
  assert.ok(html.includes("Storyboard 1 镜"));
  assert.ok(html.includes("0s–4s"));
  assert.ok(html.includes("原有定时字幕。"));
});
