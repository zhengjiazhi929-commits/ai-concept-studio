import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateLocalStoryboardCandidate } from "../src/server/production/local-storyboard-candidate.mjs";

const sha = text => createHash("sha256").update(text).digest("hex");
export function syntheticStoryboard(script, sourceScript, episodeId = "synthetic-board") {
  const paragraphs = script.sections.flatMap(section => section.narration.split("\n\n")
    .map((text, index) => ({ id: `${section.id}:p${index + 1}`, text, evidenceRefs: section.evidenceRefs })));
  const units = [{ id: "hook", text: script.hook, evidenceRefs: [] }, ...paragraphs,
    { id: "closing", text: script.closing, evidenceRefs: [] }];
  const groups = paragraphs.map((_, index) => [units[index + 1]]);
  groups[0].unshift(units[0]); groups.at(-1).push(units.at(-1));
  const styleFields = ["background", "cardMaterial", "text", "cardText", "illustrationText", "connections",
    "borders", "logo", "captions", "illustrations", "motion", "layout"];
  return { schemaVersion: 1, kind: "codex-authored-storyboard-candidate-v1", episodeId, candidateVersion: 1,
    author: "Codex", status: "local-editorial-draft", humanApproved: false, sourceScript: structuredClone(sourceScript),
    content: { title: script.title, globalStyle: { canvas: [1920, 1080], ...Object.fromEntries(styleFields.map(key => [key, `Synthetic ${key}`])) },
      timingPolicy: "No measured audio timing", implementationBoundary: "Actions not implemented",
      shots: groups.map((group, index) => ({ id: `B${index + 1}`, title: `Synthetic shot ${index + 1}`,
        unitIds: group.map(unit => unit.id), form: "Synthetic editorial sequence", layout: "Source and input are separate",
        beats: [{ cue: group[0].text.slice(0, 8), action: "Copy a record after authorization", result: "Source is preserved" }],
        guard: "No unmeasured timing", implementation: "Implementation required", narration: group.map(unit => unit.text).join("\n\n"),
        sourceUnits: group.map(unit => ({ id: unit.id, sha256: sha(unit.text) })),
        evidenceRefs: [...new Set(group.flatMap(unit => unit.evidenceRefs))],
        timing: { mode: "narration-cues", startSeconds: null, endSeconds: null, note: "No audio produced" } })) } };
}
const script = { title: "Synthetic title", hook: "测试开场仅为合成内容。", closing: "测试收束不代表真实项目。",
  sections: Array.from({ length: 6 }, (_, index) => ({ id: `S${index + 1}`, narration: `首先检查第${index + 1}条记录。\n\n然后保留合成数据的来源。`, evidenceRefs: ["c1"] })) };
const sourceScript = { artifactVersion: 1, artifactHash: "a".repeat(64), reviewReportId: "synthetic-report",
  artifactPath: "studio/data/production/episodes/synthetic/script.json", artifactSha256: "b".repeat(64),
  manifestPath: "studio/data/production/episodes/synthetic/import.json", manifestSha256: "c".repeat(64) };
const context = { script, sourceScript, episodeId: "synthetic-board" };

test("editorial candidate preserves every source unit and ordered cue without inventing timing", () => {
  const candidate = syntheticStoryboard(script, sourceScript);
  assert.deepEqual(validateLocalStoryboardCandidate(candidate, context), candidate);
});

test("candidate rejects rewritten/reordered/duplicated narration, cue errors, foreign claims and forged timing", () => {
  const mutations = [
    c => { c.content.shots[0].narration += "新事实"; },
    c => { c.content.shots.reverse(); },
    c => { c.content.shots[0].unitIds.push(c.content.shots[0].unitIds[0]); },
    c => { c.content.shots[0].sourceUnits[0].sha256 = "d".repeat(64); },
    c => { c.content.shots[0].beats[0].cue = "不在讲稿中的句子"; },
    c => { c.content.shots[0].beats = [{cue:"首先检查",action:"a",result:"b"},{cue:"测试开场",action:"a",result:"b"}]; },
    c => { c.content.shots[0].evidenceRefs = ["foreign"]; },
    c => { c.content.shots[0].timing.startSeconds = 0; },
    c => { c.content.renderReady = true; },
    c => { c.sourceScript.artifactHash = "e".repeat(64); },
    c => { c.content.shots[1].id = c.content.shots[0].id; },
    c => { c.humanApproved = true; }
  ];
  for (const mutate of mutations) {
    const candidate = syntheticStoryboard(script, sourceScript); mutate(candidate);
    assert.throws(() => validateLocalStoryboardCandidate(candidate, context));
  }
});
