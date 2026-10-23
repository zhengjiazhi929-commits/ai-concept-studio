import { canonicalJsonDocumentContentSha256 as digest } from "../../shared/durable-json-store.mjs";
import { compileEditorialTimeline, cueFrameForNarration } from "../../shared/editorial-timing.mjs";
import { validateEditorialMotionPlan } from "../../shared/editorial-motion.mjs";
import { compileEditorialMotionRenderEpisode, buildEditorialMotionRenderModel }
  from "../../video/editorial-motion-render-model.mjs";
import {assertTimedStoryboardScreenEditing} from './storyboard-screen-editing.mjs';

export const TIMED_EDITORIAL_KIND = "timed-editorial-plan-v1";
export const TIMED_EDITORIAL_CANDIDATE_KIND = "codex-authored-timed-storyboard-candidate-v1";
export const EDITORIAL_EXECUTION_VERSION = "editorial-execution-v1";
const fail = () => { throw Object.assign(new Error("编辑执行合同不完整或编译结果漂移"), {
  code: "timed_editorial_contract_invalid", statusCode: 409
}); };
function closed(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![null, Object.prototype].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length
    || !keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable && Object.hasOwn(descriptor, "value");
    })) fail();
}

// Same immutable content compiles both the render input and review input. A kind
// string, a hand-written timestamp or a green historical report is not evidence.
export function compileTimedEditorialContent(content) {
  closed(content, ["title", "globalStyle", "timingPolicy", "implementationBoundary", "shots", "executionPlan",
    ...(Object.hasOwn(content,'screenEditing')?['screenEditing']:[])]);
  const execution = content.executionPlan;
  closed(execution, ["version", "timingPolicy", "sceneGroups", "motionPlans",
    ...(Object.hasOwn(execution,'chapterPlan')?['chapterPlan']:[])]);
  if (execution.version !== EDITORIAL_EXECUTION_VERSION
    || digest(content.globalStyle?.canvas) !== digest([1920, 1080])) fail();
  const timeline = compileEditorialTimeline({shots: content.shots,
    groups: execution.sceneGroups, timingPolicy: execution.timingPolicy});
  if (!Array.isArray(execution.motionPlans) || execution.motionPlans.length !== timeline.scenes.length) fail();
  const scenes = timeline.scenes.map((scene, index) => {
    const item = execution.motionPlans[index];
    closed(item, ["sceneId", "plan"]);
    if (item.sceneId !== scene.id) fail();
    const inspection = validateEditorialMotionPlan(item.plan, {
      narration: scene.narration, durationInFrames: scene.endFrame - scene.startFrame
    });
    if (!inspection.valid || inspection.warnings?.length
      || digest(item.plan.canvas) !== digest({width: 1920, height: 1080})
      || item.plan.events.length < 2
      || !item.plan.events.some(event => ["reveal", "copy", "summarize", "transfer", "save", "reset-scope", "temporary-override", "invalidate"].includes(event.op))) fail();
    for (const event of [...item.plan.events,...(item.plan.tracks??[]).flatMap(track=>track.states)]) {
      // Chained copy/transfer/arrival may follow one spoken cue. It may not
      // precede that cue or float arbitrarily far away from it.
      const cueFrame = cueFrameForNarration(scene.narration, event.cue, execution.timingPolicy);
      if (event.atFrame < cueFrame || event.atFrame > cueFrame + 90) fail();
    }
    return {...scene, motionPlan: structuredClone(item.plan),
      ...(scene.type === "evidence" ? {label: "来源支持的概念示意（非项目实测）",
        assetHint: "依照已登记事实来源制作的代码插画；声音和最终素材仍需单独验收"} : {})};
  });
  const compiled = {...timeline, scenes,
    ...(Object.hasOwn(execution,'chapterPlan')?{editorialChapterPlan:structuredClone(execution.chapterPlan)}:{})};
  const renderInput = compileEditorialMotionRenderEpisode(compiled, execution.timingPolicy.fps);
  const samples = new Set();
  for (const scene of scenes) {
    samples.add(scene.startFrame); samples.add(scene.endFrame - 1);
    for (const event of [...scene.motionPlan.events,...(scene.motionPlan.tracks??[]).flatMap(track=>track.states)]) {
      const start = scene.startFrame + event.atFrame;
      const end = start + event.durationFrames;
      for (const frame of [start - 1, start, Math.floor((start + end) / 2), end - 1, end, end + 1]) {
        if (frame >= scene.startFrame && frame < scene.endFrame) samples.add(frame);
      }
    }
  }
  for (const cue of compiled.subtitles) samples.add(cue.startFrame);
  for (const frame of samples) {
    try { buildEditorialMotionRenderModel(renderInput, frame, execution.timingPolicy.fps); }
    catch (cause) {
      throw Object.assign(new Error(`逐拍几何预检在第 ${frame} 帧失败`, {cause}), {
        code: "timed_editorial_geometry_invalid", statusCode: 409, frame
      });
    }
  }
  assertTimedStoryboardScreenEditing(content,compiled,renderInput);
  return {...compiled, geometrySampleCount: samples.size};
}

export function isTimedEditorialDraft(draft) {
  return draft?.storyboardKind === TIMED_EDITORIAL_KIND || draft?.content?.executionPlan != null;
}

export function hasTimedEditorialExecution(episode) {
  return isTimedEditorialDraft(episode?.production?.storyboardDraft)
    || (Array.isArray(episode?.scenes) && episode.scenes.some(scene => scene?.motionPlan != null));
}

export function inspectTimedEditorialEpisode(episode) {
  try {
    const draft = episode?.production?.storyboardDraft;
    if (draft?.generationKind !== "codex-local-storyboard-import"
      || draft.storyboardKind !== TIMED_EDITORIAL_KIND || draft.timingStatus !== "editorial-estimate"
      || draft.executionStatus !== "implemented-contract") fail();
    const compiled = compileTimedEditorialContent(draft.content);
    // Validate navigation against the bound draft as well as the scene fields.
    // An extra top-level plan or a pre-filled derived plan cannot replace it.
    compileEditorialMotionRenderEpisode(episode, draft.content.executionPlan.timingPolicy.fps);
    // Physical assets can be materialized later without changing logical
    // storyboard content; every compiled field must still match exactly.
    const logicalScenes = (episode.scenes ?? []).map((scene, index) =>
      Object.fromEntries(Object.keys(compiled.scenes[index] ?? {}).map(key => [key, scene[key]])));
    if (digest(logicalScenes) !== digest(compiled.scenes)
      || digest(episode.subtitles) !== digest(compiled.subtitles)
      || episode.render?.durationSeconds !== compiled.durationSeconds
      || episode.render?.fps !== draft.content.executionPlan.timingPolicy.fps
      || episode.render?.compositionId !== "ConceptPreview"
      || episode.render?.width !== 1920 || episode.render?.height !== 1080) fail();
    return {valid: true, issues: [], timing: "editorial-estimate", audioAligned: false,
      execution: "implemented-contract", renderReady: false};
  } catch (error) {
    return {valid: false, issues: [error.code ?? "timed_editorial_contract_invalid"],
      timing: "invalid", audioAligned: false, execution: "invalid", renderReady: false};
  }
}
