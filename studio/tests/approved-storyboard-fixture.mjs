// Synthetic-only approved editorial chain; never reads a live Episode or user output.
import {createApprovedScriptCompletionService} from "../src/server/production/approved-script-completion-core.mjs";
import {approvedScriptCompletionCapabilitySpec} from "../src/shared/approved-script-completion-request.mjs";
import {applyApprovalDecision} from "../src/shared/workflow.mjs";
import { createHash } from "node:crypto";
import { approvedScriptFixture } from "./approved-script-fixture.mjs";
import { loadApprovedScriptBinding } from "../src/server/production/approved-script-binding.mjs";
import { createLocalStoryboardImportService } from "../src/server/production/local-storyboard-import-core.mjs";
import { EDITORIAL_TIMING_POLICY, cueFrameForNarration } from "../src/shared/editorial-timing.mjs";
import { localStoryboardCapabilitySpec } from "../src/shared/local-storyboard-import-request.mjs";
import { createCapabilityAuthority } from "../src/server/security/side-effect-capability.mjs";
import { recheckGateReview } from "../src/server/orchestrator.mjs";
import {attachSyntheticScreenEditing} from './helpers/screen-editorial-fixture.mjs';

const sha = value => createHash("sha256").update(value).digest("hex");
const paragraph = "首先核对当前任务和来源边界，说明这是一组独立的合成测试数据，不代表现实项目效果。接下来检查原始记录与工作副本的区别，保证每个状态都有明确的归属。最后验证时间顺序和字幕内容，不用修改原文换取测试通过。还要核对审批证据是否属于当前版本，避免拿旧报告放行新的内容。";
const authorization = request => ({sideEffectGrant: createCapabilityAuthority({
  secret: "synthetic-timed-lifecycle-000000000000000000000000"
}).authorize(localStoryboardCapabilitySpec(request))});

export async function approvedStoryboardFixture(t) {
  const f = await approvedScriptFixture(t, {sectionNarration: `${paragraph}\n\n${paragraph}`});
  const episode = await f.deps.readEpisode();
  const completion = createApprovedScriptCompletionService(f.deps);
  const completionPreview = await completion.previewApprovedScriptCompletion({episodeId: episode.id});
  const completionRequest = {episodeId: episode.id, artifactVersion: completionPreview.sourceScript.artifactVersion,
    artifactHash: completionPreview.sourceScript.artifactHash, reviewReportId: completionPreview.sourceScript.reviewReportId,
    snapshotHash: completionPreview.snapshotHash, actor: "human:synthetic-fixture",
    reason: "Complete synthetic approved script", confirmApprovedScriptCompletion: true};
  await completion.completeApprovedScript(completionRequest, {sideEffectGrant: createCapabilityAuthority({
    secret: "synthetic-storyboard-fixture-0000000000000000000000"
  }).authorize(approvedScriptCompletionCapabilitySpec(completionRequest))});
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
  const importRequest = await request();
  await service.importLocalStoryboard(importRequest, authorization(importRequest));
  const review = await recheckGateReview(episode.id, "storyboard", {...f.deps, review: {config: f.config}});
  if (review.review.report.decision !== "pass") throw new Error("Synthetic storyboard review did not pass");
  const approved = applyApprovalDecision(await f.deps.readEpisode(), {gate: "storyboard", decision: "approved",
    actor: "human:synthetic-fixture", note: "Explicit synthetic approval, not a production approval"}).episode;
  await f.deps.writeEpisode(approved); f.events.length = 0;
  return {...f, episode: await f.deps.readEpisode(), scriptCandidate: f.candidate,
    candidate, candidatePath, importRequest, service, request};
}
