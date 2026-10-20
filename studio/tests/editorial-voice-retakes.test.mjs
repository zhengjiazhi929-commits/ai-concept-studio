import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {buildEditorialVoiceSpeechPlan, buildEditorialVoiceTiming} from "../src/shared/editorial-voice-timing.mjs";
import {buildEditorialVoiceRetakePlan, buildEditorialVoiceRetakeTiming} from "../src/shared/editorial-voice-retakes.mjs";
const sha = text => createHash("sha256").update(text).digest("hex");
function fixture() {
  const base = buildEditorialVoiceSpeechPlan([
    {id:"S01",unitIds:["one"],narration:"先检查资料，再整理证据。"},
    {id:"S02",unitIds:["two"],narration:"最后验证所有的结果。"}
  ]);
  const timing = buildEditorialVoiceTiming(base, base.segments.map((s,i)=>({id:s.id,sampleCount:24000*(i?2:6)})));
  const repair = {schemaVersion:"editorial-voice-repair-plan-v1",baseCandidate:{path:"outputs/synthetic/voice-manifest.json",sha256:"a".repeat(64)},
    repairs:[{id:"speech-0001",parts:["先检查资料，","再整理证据。"].map(text=>({text,textSha256:sha(text)}))}]};
  return {base,timing,repair};
}
test("retake plan repairs exactly measured outliers and preserves untouched parents",()=>{
  const {base,timing,repair}=fixture(), before=structuredClone({base,timing,repair});
  const retake=buildEditorialVoiceRetakePlan(base,timing,repair);
  assert.equal(retake.parents[0].mode,"retake");
  assert.equal(retake.parents[1].mode,"reuse");
  assert.deepEqual(retake.parents[1].parts,[]);
  assert.deepEqual(retake.parents[0].parts.map(p=>p.id),["speech-0001-part-01","speech-0001-part-02"]);
  assert.equal(retake.parents[0].parts.map(p=>p.text).join(""),base.segments[0].text);
  assert.deepEqual({base,timing,repair},before);
});
test("repair rejects changed text, missing or extra outliers, forged measured timing and unsafe base paths",()=>{
  const {base,timing,repair}=fixture();
  for(const change of [r=>r.repairs=[], r=>r.repairs.push({...r.repairs[0],id:"speech-0002"}),
    r=>r.repairs[0].parts[0].text="改动原文，", r=>r.repairs[0].parts.pop(),
    r=>r.baseCandidate.path="outputs/../escape.json", r=>r.extra=true]) {
    const input=structuredClone(repair);change(input);
    assert.throws(()=>buildEditorialVoiceRetakePlan(base,timing,input));
  }
  const forged=structuredClone(timing);forged.captionDurationIssues=[];
  assert.throws(()=>buildEditorialVoiceRetakePlan(base,forged,repair));
});
test("retake timing uses exact child PCM lengths and adds each parent gap exactly once",()=>{
  const {base,repair}=fixture();
  const measured=[{id:"speech-0001",sampleCount:72003,parts:[
    {id:"speech-0001-part-01",sampleCount:24001},{id:"speech-0001-part-02",sampleCount:48002}]},
    {id:"speech-0002",sampleCount:48000,parts:[]}];
  const timing=buildEditorialVoiceRetakeTiming(base,repair,measured);
  assert.equal(timing.schemaVersion,"editorial-voice-retake-timing-v1");
  assert.equal(timing.totalSamples,72003+4800+48000);
  assert.deepEqual(timing.segments.map(s=>s.pauseAfterSamples),[0,4800,0]);
  assert.deepEqual(timing.segments.map(s=>s.startSample),[0,24001,76803]);
  assert.equal(timing.captions[0].endMs,24001/24);
  assert.equal(timing.captions[1].startMs,24001/24);
  assert.equal(timing.captions.map(s=>s.text).join(""),base.segments.map(s=>s.text).join(""));
  assert.deepEqual(timing.scenes.map(s=>[s.startSample,s.endSample]),[[0,76803],[76803,124803]]);
  assert.deepEqual(timing.captionDurationIssues,[]);
  for(const change of [m=>m[0].sampleCount++,m=>m[0].parts.reverse(),m=>m[1].parts=[{id:"fake",sampleCount:48000}],
    m=>m[0].parts[0].sampleCount=0,m=>m.pop()]) {
    const input=structuredClone(measured);change(input);
    assert.throws(()=>buildEditorialVoiceRetakeTiming(base,repair,input));
  }
});
test("explicit enumeration splits allowed, but leading punctuation, quote orphan and English cuts fail",()=>{
  const base=buildEditorialVoiceSpeechPlan([{id:"S",unitIds:["u"],narration:"先核对来源、日期、用户身份，再运行 Agent。"}]);
  const timing=buildEditorialVoiceTiming(base,base.segments.map(s=>({id:s.id,sampleCount:144000})));
  const make=parts=>({schemaVersion:"editorial-voice-repair-plan-v1",baseCandidate:{path:"outputs/synthetic/voice-manifest.json",sha256:"a".repeat(64)},
    repairs:[{id:base.segments[0].id,parts:parts.map(text=>({text,textSha256:sha(text)}))}]});
  assert.equal(buildEditorialVoiceRetakePlan(base,timing,make(["先核对来源、日期、","用户身份，再运行 Agent。"])).parents[0].parts.length,2);
  for(const parts of [["先核对来源","、日期、用户身份，再运行 Agent。"],
    ["先核对来源、日期、用户身份，再运行 Ag","ent。"]]) {
    assert.throws(()=>buildEditorialVoiceRetakePlan(base,timing,make(parts)));
  }
});

test("retake Python contract is included in the standard Node test gate without ML or production files",()=>{
  const result=spawnSync(process.env.QA_PYTHON||"python3",
    [fileURLToPath(new URL("./editorial-voice-retakes-python-contract.py",import.meta.url))],
    {encoding:"utf8",timeout:30000,env:{...process.env,PYTHONDONTWRITEBYTECODE:"1",PYTHONNOUSERSITE:"1"}});
  assert.equal(result.error,undefined,String(result.error));
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
});
