#!/usr/bin/env python3
"""Reuse verified parent WAV bytes; generate only explicit measured-outlier children."""
import argparse
import hashlib
import importlib
import importlib.util
import inspect
import json
import re
import struct
import time
import wave
from pathlib import Path

RATE=24000


def require(value,message):
    if not value:raise ValueError(message)


def closed(value,keys):
    require(type(value) is dict and set(value)==set(keys),"Unexpected request fields")


def digest(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda:source.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()


def text_hash(text):return hashlib.sha256(text.encode()).hexdigest()


def derive_retake_plan(base,repair):
    closed(repair,["schemaVersion","baseCandidate","repairs"])
    closed(repair["baseCandidate"],["path","sha256"])
    path=repair["baseCandidate"]["path"]
    require(repair["schemaVersion"]=="editorial-voice-repair-plan-v1" and type(path) is str
        and re.fullmatch(r"outputs/[A-Za-z0-9_./-]+/voice-manifest\.json",path)
        and all(p and p not in (".","..") for p in path.split("/"))
        and type(repair["baseCandidate"]["sha256"]) is str
        and re.fullmatch(r"[a-f0-9]{64}",repair["baseCandidate"]["sha256"]),"Invalid base candidate")
    require(type(repair["repairs"]) is list and 0<len(repair["repairs"])<=len(base["segments"]),"Invalid repair count")
    ids=[s["id"] for s in base["segments"]]
    replacements={};previous=-1
    for item in repair["repairs"]:
        closed(item,["id","parts"])
        require(item["id"] in ids,"Unknown repair parent")
        index=ids.index(item["id"])
        require(index>previous and type(item["parts"]) is list and 2<=len(item["parts"])<=8,"Reordered or invalid repair")
        previous=index;children=[]
        for part_index,part in enumerate(item["parts"]):
            closed(part,["text","textSha256"])
            text=part["text"]
            require(type(text) is str and 2<=len(text.strip()) and len(text)<=28
                and not re.search(r"[\x00-\x1f]",text)
                and not re.match(r"\s*[，。！？；：、,.!?;:）〉》】」』”’]",text)
                and text_hash(text)==part["textSha256"],"Invalid repair child text")
            if part_index<len(item["parts"])-1:
                require(re.search(r"[，。！？；：、,.!?;:][”’」』）》】]*\s*$",text),"Repair boundary must preserve original punctuation")
            children.append({"id":f"{item['id']}-part-{part_index+1:02d}",**part})
        require("".join(p["text"] for p in children)==base["segments"][index]["text"],"Repair changed approved text")
        replacements[item["id"]]=children
    return {"schemaVersion":"editorial-voice-retake-plan-v1","sampleRate":RATE,"voiceId":base["voiceId"],
        "speed":base["speed"],"sourceTextSha256":base["sourceTextSha256"],"baseCandidate":repair["baseCandidate"],
        "parents":[{**s,"mode":"retake" if s["id"] in replacements else "reuse","parts":replacements.get(s["id"],[])}
            for s in base["segments"]]}


def safe_regular(path,directory=False):
    path=Path(path)
    require(path.is_absolute(),"Absolute media path required")
    current=Path(path.anchor)
    for part in path.parts[1:]:
        require(part not in (".",".."),"Unsafe media path")
        current=current/part
        require(not current.is_symlink(),"Symlink media path forbidden")
    require(path.resolve(strict=True)==path and (path.is_dir() if directory else path.is_file()),"Unsafe media type")
    return path


def inspect_pcm(path):
    path=safe_regular(path)
    require(44<path.stat().st_size<=RATE*3600*2+44,"Invalid PCM size")
    data=path.read_bytes()
    require(data[:4]==b"RIFF" and data[8:16]==b"WAVEfmt " and data[36:40]==b"data"
        and struct.unpack_from("<I",data,4)[0]==len(data)-8
        and struct.unpack_from("<IHHIIHH",data,16)==(16,1,1,RATE,RATE*2,2,16)
        and struct.unpack_from("<I",data,40)[0]==len(data)-44 and (len(data)-44)%2==0,"Noncanonical PCM")
    return {"file":path.name,"sampleCount":(len(data)-44)//2,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()}


def verify_base_media(media,base):
    closed(media,["path","files"])
    require(type(media["path"]) is str,"Invalid base media root")
    root=safe_regular(media["path"],directory=True)
    require(type(media["files"]) is list and len(media["files"])==len(base["segments"]),"Incomplete base media")
    paths=[]
    for source,record in zip(base["segments"],media["files"]):
        closed(record,["id","file","bytes","sha256","sampleCount"])
        require(record["id"]==source["id"] and record["file"]==source["id"]+".wav","Reordered base media")
        path=safe_regular(root/record["file"])
        actual=inspect_pcm(path)
        require(all(actual[key]==record[key] for key in ("file","bytes","sha256","sampleCount"))
            and type(record["sampleCount"]) is int and RATE/4<=record["sampleCount"]<=RATE*65,"Changed base PCM")
        paths.append(path)
    return paths


def copy_exclusive(source,destination):
    source=safe_regular(source)
    with source.open("rb") as reader,Path(destination).open("xb") as writer:
        for chunk in iter(lambda:reader.read(1024*1024),b""):writer.write(chunk)


def join_pcm_files(destination,paths,sample_counts):
    require(len(paths)==len(sample_counts) and len(paths)>0,"Missing child PCM")
    with Path(destination).open("xb") as stream:
        with wave.open(stream,"wb") as writer:
            writer.setnchannels(1);writer.setsampwidth(2);writer.setframerate(RATE)
            for path,count in zip(paths,sample_counts):
                actual=inspect_pcm(path)
                require(actual["sampleCount"]==count,"Child sample count changed")
                with wave.open(str(path),"rb") as reader:
                    writer.writeframes(reader.readframes(count))
    result=inspect_pcm(destination)
    require(result["sampleCount"]==sum(sample_counts),"Parent sample sum mismatch")
    return result


def validate_measurement_contract(request):
    base=request["basePlan"];timing=request["baseTiming"];files=request["baseMedia"]["files"]
    require(type(timing) is dict and timing.get("schemaVersion")=="editorial-voice-timing-v1"
        and timing.get("sampleRate")==RATE and timing.get("sourceTextSha256")==base["sourceTextSha256"]
        and type(timing.get("segments")) is list and len(timing["segments"])==len(files),"Invalid base timing")
    issues=[];cursor=0
    for source,record,measured in zip(base["segments"],files,timing["segments"]):
        count=record["sampleCount"];end=cursor+count;following=end+source["pauseAfterSamples"]
        require(measured.get("id")==source["id"] and measured.get("sampleCount")==count
            and measured.get("startSample")==cursor and measured.get("endSample")==end
            and measured.get("nextSample")==following,"Forged base sample timing")
        duration=count/RATE
        if duration<.75 or duration>5.5:
            require(duration>5.5,"Short source cannot be repaired by splitting")
            issues.append({"id":source["id"],"durationSeconds":duration,"code":"subtitle-duration-out-of-range"})
        cursor=following
    require(timing.get("totalSamples")==cursor and timing.get("captionDurationIssues")==issues
        and [i["id"] for i in issues]==[p["id"] for p in request["repairPlan"]["repairs"]],"Repairs must cover exactly measured outliers")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--request",required=True);parser.add_argument("--request-sha256",required=True);parser.add_argument("--output",required=True)
    args=parser.parse_args()
    require(re.fullmatch(r"[a-f0-9]{64}",args.request_sha256) and digest(args.request)==args.request_sha256,"Request hash changed")
    request=json.loads(Path(args.request).read_text())
    closed(request,["basePlan","baseTiming","repairPlan","retakePlan","baseMedia","model","pinnedFiles","runtimeLock","retakeDriverPin"])
    pins=request["pinnedFiles"]
    # Pin the module before importing even its pure helpers.
    for pin in [pins["driver"],request["retakeDriverPin"]]:
        closed(pin,["path","realPath","bytes","sha256"])
        path=safe_regular(pin["path"])
        require(str(path.resolve())==pin["realPath"] and path.stat().st_size==pin["bytes"] and digest(path)==pin["sha256"],"Changed driver pin")
    require(str(Path(__file__).resolve())==request["retakeDriverPin"]["realPath"],"Unpinned retake driver")
    spec=importlib.util.spec_from_file_location("frozen_editorial_voice_driver",pins["driver"]["path"])
    original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)
    original.validate_request({"plan":request["basePlan"],"model":request["model"],"pinnedFiles":pins,"runtimeLock":request["runtimeLock"]})
    original.verify_pins(pins)
    derived=derive_retake_plan(request["basePlan"],request["repairPlan"])
    require(derived==request["retakePlan"],"Derived retake plan changed")
    paths=verify_base_media(request["baseMedia"],request["basePlan"])
    validate_measurement_contract(request)
    output=safe_regular(args.output,directory=True)
    require(not any(output.iterdir()),"Output must be a new empty directory")
    require(json.loads(Path(pins["runtimeLock"]["path"]).read_text())==request["runtimeLock"],"Runtime lock mismatch")
    spec=importlib.util.spec_from_file_location("pinned_kokoro_generator",pins["generator"]["path"])
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    helper.require_offline_environment();guards=helper.verify_network_guard_behavior();helper.load_inference_stack()
    original.verify_loaded_frontend_paths(pins,inspect.getfile(helper.KPipeline),importlib.import_module("misaki.zh").__file__)
    runtime=helper.runtime_fingerprint();helper.require_pinned_runtime(request["runtimeLock"],runtime)
    lexicon=json.loads(Path(pins["englishLexicon"]["path"]).read_text())
    pronunciations={term:original.english_pronunciation(term,lexicon) for p in request["basePlan"]["segments"]
        for term in re.findall(r"[A-Za-z]+",p["text"])}
    torch,np=helper.torch,helper.np;torch.manual_seed(20260812);torch.set_num_threads(2)
    device="mps" if torch.backends.mps.is_available() else "cpu"
    model=helper.KModel(repo_id=request["model"]["repoId"],config=pins["config"]["path"],model=pins["model"]["path"]).to(device).eval()
    pipeline=helper.KPipeline(lang_code="z",repo_id=request["model"]["repoId"],model=model,device=device,
        en_callable=lambda text:original.english_pronunciation(text,lexicon))
    vocabulary=json.loads(Path(pins["config"]["path"]).read_text())["vocab"]
    checks={}
    for parent in derived["parents"]:
        for part in parent["parts"]:
            phonemes,_=pipeline.g2p(part["text"])
            checks[part["id"]]=original.validate_phonemes(part["id"],phonemes,vocabulary)
    results=[];started=time.monotonic();calls=0
    for index,parent in enumerate(derived["parents"]):
        destination=output/(parent["id"]+".wav");children=[]
        if parent["mode"]=="reuse":
            expected=request["baseMedia"]["files"][index]
            require(digest(paths[index])==expected["sha256"],"Base changed before reuse")
            copy_exclusive(paths[index],destination);info=inspect_pcm(destination)
            require(info["sha256"]==expected["sha256"] and info["bytes"]==expected["bytes"],"Reuse must preserve exact WAV bytes")
        else:
            for part in parent["parts"]:
                audio,metrics=helper.synthesize(pipeline,part["text"],pins["voice"]["path"],1.1,RATE)
                info=original.write_segment(output/(part["id"]+".wav"),audio,np);calls+=1
                children.append({**part,**info,"metrics":metrics,"phonemeCheck":checks[part["id"]]})
            info=join_pcm_files(destination,[output/c["file"] for c in children],[c["sampleCount"] for c in children])
        results.append({**parent,**info,"parts":children})
        print(json.dumps({"id":parent["id"],"mode":parent["mode"],"sampleCount":info["sampleCount"]}),flush=True)
    voice=original.assemble_voice(output,results,request["basePlan"])
    verify_base_media(request["baseMedia"],request["basePlan"]);original.verify_pins(pins)
    original.verify_pins({"retakeDriver":request["retakeDriverPin"]})
    require(digest(args.request)==args.request_sha256,"Request changed during inference")
    result={"schemaVersion":"editorial-local-voice-retake-result-v1","requestSha256":args.request_sha256,
        "planSourceTextSha256":derived["sourceTextSha256"],"sampleRate":RATE,"voiceId":"zm_010","speed":1.1,
        "baseCandidate":derived["baseCandidate"],"segments":results,"voice":voice,"runtime":runtime,"networkGuards":guards,
        "offlineEnvironmentVerified":True,"device":device,"pronunciations":pronunciations,"localSynthesisCalls":calls,
        "externalApiCalls":0,"costUsd":0,"elapsedSeconds":round(time.monotonic()-started,3),
        "formalVoiceRegistered":False,"releaseEligible":False}
    with (output/"result.json").open("x") as destination:
        json.dump(result,destination,ensure_ascii=False,indent=2);destination.write("\n")


if __name__=="__main__":main()
