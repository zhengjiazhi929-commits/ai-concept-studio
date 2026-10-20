import { createHash } from "node:crypto";
import { canonicalJsonDocumentContentSha256 as digest } from "../../shared/durable-json-store.mjs";
import { readLocalScriptJson } from "./local-script-candidate.mjs";
import { compileTimedEditorialContent, TIMED_EDITORIAL_CANDIDATE_KIND } from "./timed-editorial-content.mjs";
import {assertCueStoryboardScreenEditing} from './storyboard-screen-editing.mjs';

export function localStoryboardError(code, message = "本地分镜与当前批准脚本或编辑合同不一致") {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}
function requireValue(value, code = "local_storyboard_candidate_invalid") {
  if (!value) throw localStoryboardError(code);
}
function closed(value, fields) {
  requireValue(value && typeof value === "object" && !Array.isArray(value) &&
    [null, Object.prototype].includes(Object.getPrototypeOf(value)) &&
    Reflect.ownKeys(value).length === fields.length && fields.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable && Object.hasOwn(descriptor, "value");
    }));
}
const text = value => typeof value === "string" && value.trim().length > 0 && value.length <= 20000 &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const identifier = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value);
const sha = value => createHash("sha256").update(value).digest("hex");

// Reuse the bounded, no-symlink file reader; normalize only public error codes.
export async function readLocalStoryboardJson(root, path, prefixes, maximumBytes = 1024 * 1024) {
  try { return await readLocalScriptJson(root, path, prefixes, maximumBytes); }
  catch { throw localStoryboardError("local_storyboard_file_invalid"); }
}

export function validateLocalStoryboardCandidate(candidate, { episodeId, script, sourceScript }) {
  closed(candidate, ["schemaVersion", "kind", "episodeId", "candidateVersion", "author", "status", "humanApproved", "sourceScript", "content"]);
  if (candidate.kind === TIMED_EDITORIAL_CANDIDATE_KIND) {
    requireValue(candidate.status === "local-timed-draft");
    closed(candidate.content, ["title", "globalStyle", "timingPolicy", "implementationBoundary", "shots", "executionPlan",
      ...(Object.hasOwn(candidate.content,'screenEditing')?['screenEditing']:[])]);
    const {executionPlan: omitted, ...editorialContent} = candidate.content;
    // Timed visibility is certified against the render model below, not cue panels.
    const {screenEditing: omittedEditing,...legacyEditorialContent}=editorialContent;
    validateLocalStoryboardCandidate({...candidate, kind: "codex-authored-storyboard-candidate-v1",
      status: "local-editorial-draft", content: legacyEditorialContent}, {episodeId, script, sourceScript});
    compileTimedEditorialContent(candidate.content);
    return candidate;
  }
  requireValue(candidate.schemaVersion === 1 && candidate.kind === "codex-authored-storyboard-candidate-v1" &&
    candidate.episodeId === episodeId && Number.isSafeInteger(candidate.candidateVersion) && candidate.candidateVersion > 0 &&
    candidate.author === "Codex" && candidate.status === "local-editorial-draft" && candidate.humanApproved === false);
  closed(candidate.sourceScript, ["artifactVersion", "artifactHash", "reviewReportId", "artifactPath", "artifactSha256", "manifestPath", "manifestSha256"]);
  requireValue(digest(candidate.sourceScript) === digest(sourceScript), "local_storyboard_script_binding_changed");
  const content = candidate.content;
  closed(content, ["title", "globalStyle", "timingPolicy", "implementationBoundary", "shots",
    ...(Object.hasOwn(content,'screenEditing')?['screenEditing']:[])]);
  requireValue(text(content.title) && content.title === script.title && text(content.timingPolicy) && text(content.implementationBoundary));
  const styleKeys = ["background", "cardMaterial", "text", "cardText", "illustrationText", "connections", "borders",
    "logo", "captions", "illustrations", "motion", "layout"];
  closed(content.globalStyle, ["canvas", ...styleKeys]);
  requireValue(styleKeys.every(key => text(content.globalStyle[key])) && Array.isArray(content.globalStyle.canvas) &&
    content.globalStyle.canvas.length === 2 && content.globalStyle.canvas.every(value => Number.isSafeInteger(value) && value >= 240 && value <= 8192));
  requireValue(Array.isArray(content.shots) && content.shots.length > 0 && content.shots.length <= 64);
  const units = [{ id: "hook", text: script.hook, refs: [] }, ...script.sections.flatMap(section =>
    section.narration.split("\n\n").map((body, index) => ({ id: `${section.id}:p${index + 1}`, text: body, refs: section.evidenceRefs }))),
  { id: "closing", text: script.closing, refs: [] }];
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const seenShots = new Set();
  const assigned = [];
  for (const shot of content.shots) {
    closed(shot, ["id", "title", "unitIds", "form", "layout", "beats", "guard", "implementation", "narration", "sourceUnits", "evidenceRefs", "timing"]);
    requireValue(identifier(shot.id) && !seenShots.has(shot.id)); seenShots.add(shot.id);
    requireValue(["title", "form", "layout", "guard", "implementation", "narration"].every(key => text(shot[key])) &&
      Array.isArray(shot.unitIds) && shot.unitIds.length > 0 && shot.unitIds.every(id => byId.has(id)));
    assigned.push(...shot.unitIds);
    const sourceUnits = shot.unitIds.map(id => byId.get(id));
    requireValue(shot.narration === sourceUnits.map(unit => unit.text).join("\n\n"), "local_storyboard_narration_changed");
    requireValue(Array.isArray(shot.sourceUnits) && shot.sourceUnits.length === sourceUnits.length);
    shot.sourceUnits.forEach((unit, index) => {
      closed(unit, ["id", "sha256"]);
      requireValue(unit.id === sourceUnits[index].id && unit.sha256 === sha(sourceUnits[index].text), "local_storyboard_source_unit_changed");
    });
    const expectedRefs = [...new Set(sourceUnits.flatMap(unit => unit.refs))].sort();
    requireValue(Array.isArray(shot.evidenceRefs) && shot.evidenceRefs.every(text) &&
      digest([...shot.evidenceRefs].sort()) === digest(expectedRefs), "local_storyboard_evidence_invalid");
    requireValue(Array.isArray(shot.beats) && shot.beats.length > 0 && shot.beats.length <= 32);
    let position = -1;
    for (const beat of shot.beats) {
      closed(beat, ["cue", "action", "result"]);
      requireValue(["cue", "action", "result"].every(key => text(beat[key])));
      const next = shot.narration.indexOf(beat.cue, position + 1);
      requireValue(next > position, "local_storyboard_cue_invalid");
      position = next;
    }
    closed(shot.timing, ["mode", "startSeconds", "endSeconds", "note"]);
    requireValue(shot.timing.mode === "narration-cues" && shot.timing.startSeconds === null &&
      shot.timing.endSeconds === null && text(shot.timing.note), "local_storyboard_timing_invalid");
  }
  requireValue(digest(assigned) === digest(units.map(unit => unit.id)), "local_storyboard_coverage_invalid");
  assertCueStoryboardScreenEditing(content);
  return candidate;
}
