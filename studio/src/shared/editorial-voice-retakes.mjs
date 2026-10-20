import {createHash} from "node:crypto";
import {isDeepStrictEqual as same} from "node:util";
import {buildEditorialVoiceTiming} from "./editorial-voice-timing.mjs";
import {subtitleBoundaryReasons, SUBTITLE_MINIMUM_CUE_DURATION_SECONDS as minimum,
  SUBTITLE_MAXIMUM_CUE_DURATION_SECONDS as maximum} from "../server/production/subtitle-segmentation.mjs";

const rate=24000;
const sha=text=>createHash("sha256").update(text).digest("hex");
function check(value,code="editorial_voice_retake_invalid") {
  if(!value)throw Object.assign(new Error("局部旁白修复与原文或实测样本不一致"),{code});
}
function closed(value,keys) {
  check(value&&typeof value==="object"&&!Array.isArray(value)
    && [null,Object.prototype].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length===keys.length && keys.every(key=>{
      const d=Object.getOwnPropertyDescriptor(value,key);
      return d?.enumerable&&Object.hasOwn(d,"value");
    }));
}
function validateRepair(base,repair) {
  // Reuse the frozen v1 validator without substituting these dummy samples for
  // real measurements. No computed dummy timeline leaves this function.
  check(Array.isArray(base?.segments));
  buildEditorialVoiceTiming(base,base.segments.map(s=>({id:s.id,sampleCount:rate})));
  closed(repair,["schemaVersion","baseCandidate","repairs"]);
  closed(repair.baseCandidate,["path","sha256"]);
  check(repair.schemaVersion==="editorial-voice-repair-plan-v1"
    && typeof repair.baseCandidate.path==="string"
    && /^outputs\/[A-Za-z0-9_./-]+\/voice-manifest\.json$/u.test(repair.baseCandidate.path)
    && repair.baseCandidate.path.split("/").every(p=>p&&p!=="."&&p!=="..")
    && /^[a-f0-9]{64}$/u.test(repair.baseCandidate.sha256)
    && Array.isArray(repair.repairs)&&repair.repairs.length>0&&repair.repairs.length<=base.segments.length);
  let last=-1;
  const map=new Map();
  for(const item of repair.repairs) {
    closed(item,["id","parts"]);
    const index=base.segments.findIndex(s=>s.id===item.id);
    check(index>last&&Array.isArray(item.parts)&&item.parts.length>=2&&item.parts.length<=8);
    last=index;
    const source=base.segments[index];
    for(const part of item.parts) {
      closed(part,["text","textSha256"]);
      check(typeof part.text==="string"&&part.text.trim().length>=2&&[...part.text].length<=28
        && !/[\u0000-\u001f]/u.test(part.text)&&!/^\s*[，。！？；：、,.!?;:）〉》】」』”’]/u.test(part.text)
        && part.textSha256===sha(part.text));
    }
    check(item.parts.map(p=>p.text).join("")===source.text);
    for(let i=1;i<item.parts.length;i++) {
      const left=item.parts.slice(0,i).map(p=>p.text).join("");
      const right=item.parts.slice(i).map(p=>p.text).join("");
      check(/[，。！？；：、,.!?;:][”’」』）》】]*\s*$/u.test(left),"editorial_voice_retake_semantic_boundary");
      check(!/[A-Za-z0-9]$/u.test(left)||!(/^[A-Za-z0-9]/u.test(right)),"editorial_voice_retake_english_split");
      check(subtitleBoundaryReasons(left,right).length===0,"editorial_voice_retake_semantic_boundary");
    }
    map.set(item.id,item.parts.map((part,i)=>({id:`${item.id}-part-${String(i+1).padStart(2,"0")}`,...part})));
  }
  return map;
}

export function buildEditorialVoiceRetakePlan(basePlan,baseTiming,repairPlan) {
  const map=validateRepair(basePlan,repairPlan);
  check(Array.isArray(baseTiming?.segments));
  const rebuilt=buildEditorialVoiceTiming(basePlan,baseTiming.segments.map(s=>({id:s.id,sampleCount:s.sampleCount})));
  check(same(rebuilt,baseTiming),"editorial_voice_retake_base_timing_changed");
  check(same(rebuilt.captionDurationIssues.map(s=>s.id),repairPlan.repairs.map(r=>r.id)),
    "editorial_voice_retake_outlier_coverage");
  check(rebuilt.captionDurationIssues.every(s=>s.durationSeconds>maximum),"editorial_voice_retake_short_segment");
  return {schemaVersion:"editorial-voice-retake-plan-v1",sampleRate:rate,voiceId:basePlan.voiceId,speed:basePlan.speed,
    sourceTextSha256:basePlan.sourceTextSha256,baseCandidate:structuredClone(repairPlan.baseCandidate),
    parents:basePlan.segments.map(source=>({...source,mode:map.has(source.id)?"retake":"reuse",parts:map.get(source.id)??[]}))};
}

export function buildEditorialVoiceRetakeTiming(basePlan,repairPlan,resultSegments) {
  const map=validateRepair(basePlan,repairPlan);
  check(Array.isArray(resultSegments)&&resultSegments.length===basePlan.segments.length);
  const captions=[],segments=[],scenes=[],units=[],captionDurationIssues=[];
  let cursor=0;
  for(const [index,parent] of basePlan.segments.entries()) {
    const measured=resultSegments[index];
    closed(measured,["id","sampleCount","parts"]);
    check(measured.id===parent.id&&Number.isSafeInteger(measured.sampleCount)
      && measured.sampleCount>=rate/4&&measured.sampleCount<=rate*65&&Array.isArray(measured.parts));
    const children=map.get(parent.id);
    check(measured.parts.length===(children?.length??0));
    if(children) {
      let sum=0;
      for(const [partIndex,m] of measured.parts.entries()) {
        closed(m,["id","sampleCount"]);
        check(m.id===children[partIndex].id&&Number.isSafeInteger(m.sampleCount)
          && m.sampleCount>=rate/4&&m.sampleCount<=rate*65);
        sum+=m.sampleCount;
      }
      check(sum===measured.sampleCount,"editorial_voice_retake_parent_sample_mismatch");
    }
    const sources=children??[{id:parent.id,text:parent.text,textSha256:parent.textSha256}];
    for(const [partIndex,part] of sources.entries()) {
      const sampleCount=children?measured.parts[partIndex].sampleCount:measured.sampleCount;
      const startSample=cursor,endSample=cursor+sampleCount;
      const pauseAfterSamples=partIndex===sources.length-1?parent.pauseAfterSamples:0;
      cursor=endSample+pauseAfterSamples;
      check(Number.isSafeInteger(cursor)&&cursor<=rate*3600);
      segments.push({...part,parentId:parent.id,sceneId:parent.sceneId,unitId:parent.unitId,
        sampleCount,startSample,endSample,pauseAfterSamples,nextSample:cursor});
      captions.push({text:part.text,startMs:startSample/24,endMs:endSample/24,timestampMs:null,confidence:null});
      if(scenes.at(-1)?.id!==parent.sceneId)scenes.push({id:parent.sceneId,startSample,endSample:cursor});
      else scenes.at(-1).endSample=cursor;
      if(units.at(-1)?.id!==parent.unitId)units.push({id:parent.unitId,sceneId:parent.sceneId,startSample,endSample:cursor});
      else units.at(-1).endSample=cursor;
      const durationSeconds=sampleCount/rate;
      if(durationSeconds<minimum||durationSeconds>maximum)captionDurationIssues.push({id:part.id,durationSeconds,code:"subtitle-duration-out-of-range"});
    }
  }
  return {schemaVersion:"editorial-voice-retake-timing-v1",alignmentMethod:"synthesis-segment-sample-boundaries-v1",
    sampleRate:rate,sourceTextSha256:basePlan.sourceTextSha256,totalSamples:cursor,durationSeconds:cursor/rate,
    captions,segments,scenes,units,captionDurationIssues};
}
