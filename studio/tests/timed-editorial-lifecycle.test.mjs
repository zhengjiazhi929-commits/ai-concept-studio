import test from "node:test";
import {attachSyntheticScreenEditing} from './helpers/screen-editorial-fixture.mjs';
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { approvedScriptFixture } from "./approved-script-fixture.mjs";
import { loadApprovedScriptBinding } from "../src/server/production/approved-script-binding.mjs";
import { createLocalStoryboardImportService } from "../src/server/production/local-storyboard-import-core.mjs";
import { compileTimedEditorialContent, inspectTimedEditorialEpisode }
  from "../src/server/production/timed-editorial-content.mjs";
import { EDITORIAL_TIMING_POLICY, cueFrameForNarration } from "../src/shared/editorial-timing.mjs";
import { localStoryboardCapabilitySpec } from "../src/shared/local-storyboard-import-request.mjs";
import { createCapabilityAuthority } from "../src/server/security/side-effect-capability.mjs";
import { recheckGateReview } from "../src/server/orchestrator.mjs";
import { buildHumanApprovalView } from "../src/server/reviews/human-approval-view.mjs";
import { evaluateProductionQuality } from "../src/server/production/quality.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const paragraph = "首先核对当前任务和来源边界，说明这是一组独立的合成测试数据，不代表现实项目效果。接下来检查原始记录与工作副本的区别，保证每个状态都有明确的归属。最后验证时间顺序和字幕内容，不用修改原文换取测试通过。";
const authorization = request => ({sideEffectGrant: createCapabilityAuthority({
  secret: "synthetic-timed-lifecycle-000000000000000000000000"
}).authorize(localStoryboardCapabilitySpec(request))});

async function fixture(t) {
  const f = await approvedScriptFixture(t, {sectionNarration: `${paragraph}\n\n${paragraph}`});
  const episode = await f.deps.readEpisode();
  episode.pipeline.find(step => step.id === "script").status = "complete";
  episode.pipeline.find(step => step.id === "storyboard").status = "ready";
  await f.deps.writeEpisode(episode);
  const binding = await loadApprovedScriptBinding({workspaceRoot: f.root,
    episode: await f.deps.readEpisode(), reviewConfig: f.config});
  const units = [{id: "hook", text: binding.script.hook, refs: []},
    ...binding.script.sections.flatMap(section => section.narration.split("\n\n").map((text, index) => ({
      id: `${section.id}:p${index + 1}`, text, refs: section.evidenceRefs
    }))), {id: "closing", text: binding.script.closing, refs: []}];
  const groups = units.slice(1, -1).map(unit => [unit]);
  groups[0].unshift(units[0]); groups.at(-1).push(units.at(-1));
  const style = Object.fromEntries(["background", "cardMaterial", "text", "cardText", "illustrationText",
    "connections", "borders", "logo", "captions", "illustrations", "motion", "layout"].map(key => [key, `Synthetic ${key}`]));
  const shots = groups.map((group, index) => ({id: `B${index + 1}`, title: `合成镜头 ${index + 1}`,
    unitIds: group.map(unit => unit.id), narration: group.map(unit => unit.text).join("\n\n"),
    sourceUnits: group.map(unit => ({id: unit.id, sha256: sha(unit.text)})), evidenceRefs: ["c1"],
    form: "合成演示", layout: "独立记录", guard: "不代表真实验收", implementation: "测试对象",
    beats: [{cue: group[0].text.slice(0, 4), action: "显示记录", result: "原记录可见"}],
    timing: {mode: "narration-cues", startSeconds: null, endSeconds: null, note: "原始无时码编辑输入"}}));
  const types = ["title", "evidence", "statement", "summary"];
  const candidate = {schemaVersion: 1, kind: "codex-authored-timed-storyboard-candidate-v1", episodeId: episode.id,
    candidateVersion: 2, author: "Codex", status: "local-timed-draft", humanApproved: false,
    sourceScript: binding.sourceScript, content: {title: binding.script.title, globalStyle: {canvas: [1920, 1080], ...style},
      timingPolicy: "Synthetic original cue policy", implementationBoundary: "Synthetic original implementation note", shots,
      executionPlan: {version: "editorial-execution-v1", timingPolicy: {...EDITORIAL_TIMING_POLICY},
        sceneGroups: shots.map((shot, index) => ({id: `S${index + 1}`, title: shot.title,
          type: types[index % types.length], unitIds: shot.unitIds})),
        motionPlans: shots.map((shot, index) => ({sceneId: `S${index + 1}`, plan: {
          version: "editorial-motion-v1", canvas: {width: 1920, height: 1080},
          objects: [{id: "record", kind: "card", label: "合成记录", detail: "不代表项目结果",
            x: 180, y: 350, width: 500, height: 220, scopeId: "synthetic", sourceId: null, initiallyVisible: false}],
          events: [{id: "show", cue: shot.narration.slice(0, 4), atFrame: 0, durationFrames: 0,
            op: "reveal", objectId: "record", targetId: null, value: null, requires: []},
          {id: "focus", cue: "接下来检查", atFrame: cueFrameForNarration(shot.narration, "接下来检查", EDITORIAL_TIMING_POLICY),
            durationFrames: 0, op: "focus", objectId: "record", targetId: null, value: null, requires: []}]
        }}))}}};
  const candidatePath = "outputs/synthetic-timed/storyboard.json";
  attachSyntheticScreenEditing(candidate);
  await f.put(candidatePath, candidate);
  const service = createLocalStoryboardImportService(f.deps);
  const request = async () => {
    const preview = await service.previewLocalStoryboard({episodeId: episode.id, candidatePath});
    return {episodeId: episode.id, candidatePath, candidateSha256: preview.candidateSha256,
      snapshotHash: preview.snapshotHash, actor: "human:synthetic-timed", reason: "Synthetic timing integration",
      confirmLocalStoryboardImport: true};
  };
  return {...f, candidate, candidatePath, service, request};
}

test("timed import compiles immutable input, rechecks honestly and preserves upstream and zero spending", async t => {
  const f = await fixture(t);
  const before = await f.deps.readEpisode();
  const req = await f.request();
  const imported = await f.service.importLocalStoryboard(req, authorization(req));
  assert.equal(imported.timingStatus, "editorial-estimate");
  const after = await f.deps.readEpisode();
  assert.equal(inspectTimedEditorialEpisode(after).valid, true);
  assert.equal(after.scenes.length, 12);
  for (const key of ["research", "script"]) assert.deepEqual(after.approvals[key], before.approvals[key]);
  assert.deepEqual(after.production.scriptDraft, before.production.scriptDraft);
  assert.deepEqual(after.control.budget, before.control.budget);
  assert.equal(after.production.ai.requestCount, 0);
  assert.equal(after.approvals.storyboard.status, "pending");
  const result = await recheckGateReview(after.id, "storyboard", {...f.deps, review: {config: f.config}});
  assert.equal(result.review.report.decision, "pass", JSON.stringify(result.review.report.blockingIssues));
  const reviewed = await f.deps.readEpisode();
  const view = buildHumanApprovalView(reviewed, "storyboard");
  assert.equal(view.status.readyForHumanApproval, true);
  assert.equal(view.content.editorialReadiness.audioAligned, false);
  assert.equal(view.content.editorialReadiness.renderReady, false);
  assert.equal(view.risks.some(risk => risk.code === "editorial-execution-unimplemented"), false);
  assert.ok(view.risks.some(risk => risk.code === "editorial-estimate-not-audio"));
  const serialized = await readFile(f.episodePath, "utf8");
  assert.equal((await f.service.importLocalStoryboard(req, authorization(req))).status, "already_committed");
  assert.equal(await readFile(f.episodePath, "utf8"), serialized);
});

test("cue tampering and compiled scene drift fail closed; estimated timing cannot pass final QA", async t => {
  const f = await fixture(t);
  const req = await f.request();
  await f.service.importLocalStoryboard(req, authorization(req));
  const episode = await f.deps.readEpisode();
  const mutated = structuredClone(f.candidate.content);
  mutated.executionPlan.motionPlans[0].plan.events[1].atFrame = 0;
  assert.throws(() => compileTimedEditorialContent(mutated));
  const emptyMotion = structuredClone(f.candidate.content);
  emptyMotion.executionPlan.motionPlans[0].plan.events = [];
  assert.throws(() => compileTimedEditorialContent(emptyMotion));
  const materialMismatch = structuredClone(f.candidate.content);
  Object.assign(materialMismatch.executionPlan.motionPlans[0].plan.objects[0], {
    width: 260, height: 230, label: "合成", detail: ""
  });
  assert.throws(() => compileTimedEditorialContent(materialMismatch), {code: "timed_editorial_geometry_invalid"});
  episode.scenes[0].motionPlan.events[1].atFrame += 1;
  assert.equal(inspectTimedEditorialEpisode(episode).valid, false);
  assert.equal(buildHumanApprovalView(episode, "storyboard").status.readyForHumanApproval, false);
  await f.deps.writeEpisode(episode);
  await assert.rejects(f.service.importLocalStoryboard(req, authorization(req)), {code: "local_storyboard_compiled_timeline_changed"});
  const quality = evaluateProductionQuality(await f.deps.readEpisode(), {stage: "qa"});
  assert.ok(quality.checks.some(check => check.id === "editorial-audio-unmeasured" && !check.passed));
});
