#!/usr/bin/env python3
"""Independent, bounded offline full-review voice; never mutates production state.

The short proof's cap and entry point remain unchanged. Only its pure PCM trim,
asset-verification and offline-inference helpers are reused after source pinning.
"""
import argparse
import hashlib
import importlib
import importlib.util
import inspect
import json
import re
import sys
import time
import unicodedata
import wave
from pathlib import Path

RATE = 24000
FRAME_SAMPLES = 800
MAX_SAMPLES = RATE * 900
MAX_SEGMENTS = 260
MAX_SCENES = 64
CHAPTER_IDS = ("concept", "types", "relationship", "practice")
LAYOUTS = {"topic", "outline", "compare", "flow", "sources", "input", "answer", "record", "tests", "lifecycle"}
PIN_KEYS = {"model", "config", "voice", "python", "generator", "runtimeLock", "englishLexicon",
    "zhFrontend", "kokoroPipeline", "driver", "editorialDriver", "proofHelper"}
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}\Z")
HASH = re.compile(r"[a-f0-9]{64}\Z")


def require(value, message):
    if not value:
        raise ValueError(message)


def closed(value, keys):
    require(type(value) is dict and set(value) == set(keys), "Unexpected closed schema")


def sha_bytes(value):
    return hashlib.sha256(value).hexdigest()


def digest(path):
    hasher = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def valid_text(value, maximum, empty=False):
    return (type(value) is str and len(value) <= maximum
        and value.strip().strip("\ufeff") == value and (empty or bool(value))
        and not any(unicodedata.category(character) == "Cc" for character in value))


def validate_plan(plan):
    closed(plan, ["schemaVersion", "chapters", "scenes"])
    require(plan["schemaVersion"] == "explainer-full-revision-plan-v1", "Unexpected full plan version")
    require(type(plan["chapters"]) is list and len(plan["chapters"]) == 4, "Exactly four chapters required")
    for index, chapter in enumerate(plan["chapters"]):
        closed(chapter, ["id", "label"])
        require(chapter["id"] == CHAPTER_IDS[index] and valid_text(chapter["label"], 40), "Invalid chapter order or label")
    require(type(plan["scenes"]) is list and 4 <= len(plan["scenes"]) <= MAX_SCENES, "At most 64 scenes")
    rows, scene_ids, sentence_ids, used_chapters = [], set(), set(), []
    for scene in plan["scenes"]:
        closed(scene, ["id", "title", "chapterId", "layout", "items", "note", "segments"])
        require(type(scene["id"]) is str and IDENTIFIER.fullmatch(scene["id"])
            and scene["id"] not in scene_ids and valid_text(scene["title"], 32), "Invalid scene id or title")
        scene_ids.add(scene["id"])
        require(scene["chapterId"] in CHAPTER_IDS and scene["layout"] in LAYOUTS
            and valid_text(scene["note"], 65, empty=True), "Invalid scene chapter, layout or note")
        if not used_chapters or used_chapters[-1] != scene["chapterId"]:
            used_chapters.append(scene["chapterId"])
        maximum_items = 5 if scene["layout"] == "sources" else 4
        maximum_body = 22 if scene["layout"] == "sources" else 55
        require(type(scene["items"]) is list and 1 <= len(scene["items"]) <= maximum_items, "Too many visual items")
        for item in scene["items"]:
            closed(item, ["title", "body"])
            require(valid_text(item["title"], 18) and valid_text(item["body"], maximum_body, empty=True), "Invalid visual item")
        require(type(scene["segments"]) is list and 1 <= len(scene["segments"]) <= 64, "At most 64 sentences per scene")
        previous_reveal = 0
        for segment in scene["segments"]:
            closed(segment, ["id", "text", "pauseAfterMs", "focusIndex", "revealCount"])
            require(type(segment["id"]) is str and IDENTIFIER.fullmatch(segment["id"])
                and segment["id"] not in sentence_ids, "Invalid or duplicate sentence id")
            sentence_ids.add(segment["id"])
            require(valid_text(segment["text"], 28), "Invalid or oversized sentence")
            require(type(segment["pauseAfterMs"]) is int and 0 <= segment["pauseAfterMs"] <= 1000, "Invalid semantic pause")
            focus, reveal = segment["focusIndex"], segment["revealCount"]
            require(type(focus) is int and type(reveal) is int and previous_reveal <= reveal
                and 1 <= reveal <= len(scene["items"]) and -1 <= focus < reveal, "Invalid visual reveal or focus")
            previous_reveal = reveal
            rows.append({**segment, "sceneId": scene["id"], "chapterId": scene["chapterId"]})
    require(tuple(used_chapters) == CHAPTER_IDS, "Chapters must all appear contiguously in order")
    require(0 < len(rows) <= MAX_SEGMENTS and rows[-1]["pauseAfterMs"] == 0, "At most 260 sentences; final pause is zero")
    for previous, following in zip(rows, rows[1:]):
        if previous["sceneId"] != following["sceneId"]:
            require(previous["pauseAfterMs"] >= 100, "Scene boundary needs at least a 100 ms declared pause")
    return rows


def aligned_sample_count(samples):
    require(type(samples) is int and 0 < samples <= MAX_SAMPLES, "900-second full audio cap")
    tail = (-samples) % FRAME_SAMPLES
    require(samples + tail <= MAX_SAMPLES, "Aligned full audio exceeds 900 seconds")
    return samples + tail, tail


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_pure_helpers(path=None):
    return load_module("full_revision_pure_pcm_helpers", path or Path(__file__).with_name("generate-explainer-revision-voice.py"))


def write_pcm(path, data):
    require(type(data) is bytes and 0 < len(data) <= MAX_SAMPLES * 2 and len(data) % 2 == 0, "Invalid full PCM")
    with Path(path).open("xb") as destination:
        with wave.open(destination, "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(RATE)
            writer.writeframes(data)
    return {"file": Path(path).name, "sampleCount": len(data) // 2,
        "bytes": Path(path).stat().st_size, "sha256": digest(path)}


def assemble_candidate(output, records, helper):
    require(records and len(records) <= MAX_SEGMENTS, "Invalid full sentence records")
    parts, rows, cursor = [], [], 0
    for record in records:
        data = helper.verify_trim_record(output, record)
        require(type(record["pauseAfterMs"]) is int and 0 <= record["pauseAfterMs"] <= 1000, "Invalid assembly pause")
        pause = record["pauseAfterMs"] * RATE // 1000
        start, end = cursor, cursor + len(data) // 2
        cursor = end + pause
        aligned_sample_count(cursor)
        rows.append({key: value for key, value in record.items() if key != "pauseAfterMs"})
        rows[-1].update(startSample=start, endSample=end, pauseAfterSamples=pause)
        parts.extend([data, bytes(pause * 2)])
    require(rows[-1]["pauseAfterSamples"] == 0, "Final sentence cannot append a pause")
    target, tail = aligned_sample_count(cursor)
    parts.append(bytes(tail * 2))
    voice = write_pcm(output / "voice.wav", b"".join(parts))
    return voice, rows, {"speechAndPauseSamples": cursor, "tailPaddingSamples": tail, "targetSamples": target}


def verify_file_pin(pin):
    closed(pin, ["path", "realPath", "bytes", "sha256"])
    require(type(pin["path"]) is str and Path(pin["path"]).is_absolute()
        and type(pin["realPath"]) is str and Path(pin["realPath"]).is_absolute()
        and type(pin["sha256"]) is str and HASH.fullmatch(pin["sha256"])
        and type(pin["bytes"]) is int and pin["bytes"] > 0, "Invalid file pin")
    path = Path(pin["path"])
    require(path.is_file() and str(path.resolve(strict=True)) == pin["realPath"]
        and path.stat().st_size == pin["bytes"] and digest(path) == pin["sha256"], "Changed pinned input")


def validate_request(request):
    closed(request, ["schemaVersion", "plan", "model", "pinnedFiles", "runtimeLock"])
    require(request["schemaVersion"] == "explainer-full-revision-voice-request-v1", "Unexpected full voice request")
    rows = validate_plan(request["plan"])
    pins = request["pinnedFiles"]
    closed(pins, PIN_KEYS)
    for pin in pins.values():
        verify_file_pin(pin)
    require(Path(__file__).resolve() == Path(pins["driver"]["realPath"]), "Unpinned executing full driver")
    require(Path(sys.executable).resolve() == Path(pins["python"]["realPath"]), "Unpinned interpreter")
    require(type(request["runtimeLock"]) is dict and json.loads(Path(pins["runtimeLock"]["path"]).read_text())
        == request["runtimeLock"], "Changed runtime lock")
    scripts = Path(__file__).resolve().parent
    for key, expected in {"generator": scripts / "generate-agent-skill-local-tts.py",
        "editorialDriver": scripts / "generate-editorial-local-voice.py",
        "proofHelper": scripts / "generate-explainer-revision-voice.py",
        "runtimeLock": scripts.parent / "config/local-tts-python-runtime.lock.json"}.items():
        require(Path(pins[key]["realPath"]) == expected, "Unexpected helper location: " + key)
    require(pins["python"]["sha256"] == request["runtimeLock"].get("executableSha256"), "Interpreter differs from runtime lock")
    pure = load_pure_helpers(pins["proofHelper"]["path"])
    pure.validate_asset_pins(request["model"], pins)
    return rows


def read_request(path, expected_sha):
    require(type(expected_sha) is str and HASH.fullmatch(expected_sha), "Missing request SHA")
    require(Path(path).stat().st_size <= 512 * 1024 and digest(path) == expected_sha, "Oversized or changed request")
    def no_duplicates(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result
    def reject_constant(_):
        raise ValueError("Nonfinite JSON")
    return json.loads(Path(path).read_text(), object_pairs_hook=no_duplicates, parse_constant=reject_constant)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--request-sha256", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    request = read_request(args.request, args.request_sha256)
    segments = validate_request(request)
    output = Path(args.output)
    require(output.is_absolute() and output.is_dir() and not output.is_symlink()
        and str(output.resolve()) == str(output) and not any(output.iterdir()), "New empty real output directory required")
    pins = request["pinnedFiles"]
    original = load_module("full_revision_editorial_helpers", pins["editorialDriver"]["path"])
    original.verify_pins(pins)
    pure = load_pure_helpers(pins["proofHelper"]["path"])
    helper = load_module("full_revision_offline_generator", pins["generator"]["path"])
    helper.require_offline_environment()
    guards = helper.verify_network_guard_behavior()
    helper.load_inference_stack()
    original.verify_loaded_frontend_paths(pins, inspect.getfile(helper.KPipeline), importlib.import_module("misaki.zh").__file__)
    runtime = helper.runtime_fingerprint()
    helper.require_pinned_runtime(request["runtimeLock"], runtime)
    lexicon = json.loads(Path(pins["englishLexicon"]["path"]).read_text())
    pronunciations = {term: original.english_pronunciation(term, lexicon)
        for segment in segments for term in re.findall(r"[A-Za-z]+", segment["text"])}
    torch, np = helper.torch, helper.np
    torch.manual_seed(20260812)
    torch.set_num_threads(2)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    pipeline = helper.KPipeline(lang_code="z", repo_id=request["model"]["repoId"], model=False,
        device=device, en_callable=lambda value: original.english_pronunciation(value, lexicon))
    vocabulary = json.loads(Path(pins["config"]["path"]).read_text())["vocab"]
    checks = [original.validate_phonemes(segment["id"], pipeline.g2p(segment["text"])[0], vocabulary) for segment in segments]
    model = helper.KModel(repo_id=request["model"]["repoId"], config=pins["config"]["path"], model=pins["model"]["path"]).to(device).eval()
    pipeline.model = model
    results, cursor = [], 0
    started = time.monotonic()
    for segment, check in zip(segments, checks):
        audio, metrics = helper.synthesize(pipeline, segment["text"], pins["voice"]["path"], 1.1, RATE)
        require(audio.ndim == 1 and RATE // 4 <= audio.size <= RATE * 65
            and bool(np.all(np.isfinite(audio))) and float(np.max(np.abs(audio))) < .999, "Invalid synthesized waveform")
        raw_pcm = np.round(audio * 32767).astype("<i2").tobytes()
        raw = write_pcm(output / (segment["id"] + ".raw.wav"), raw_pcm)
        trimmed_pcm, trim = pure.trim_pcm_edges(raw_pcm)
        cursor += len(trimmed_pcm) // 2 + segment["pauseAfterMs"] * RATE // 1000
        aligned_sample_count(cursor)
        trimmed = write_pcm(output / (segment["id"] + ".trimmed.wav"), trimmed_pcm)
        results.append({**segment, "raw": raw, "trimmed": trimmed, "trimEvidence": trim,
            "textSha256": sha_bytes(segment["text"].encode()), "phonemeCheck": check, "metrics": metrics})
        print(json.dumps({"id": segment["id"], "rawSamples": raw["sampleCount"],
            "trimmedSamples": trimmed["sampleCount"], "elapsedSeconds": round(time.monotonic() - started, 3)}), flush=True)
    voice, rows, assembly = assemble_candidate(output, results, pure)
    original.verify_pins(pins)
    require(digest(args.request) == args.request_sha256, "Request changed during inference")
    result = {"schemaVersion": "explainer-full-revision-voice-result-v1", "requestSha256": args.request_sha256,
        "sampleRate": RATE, "voiceId": "zm_010", "speed": 1.1, "voice": voice, "segments": rows,
        "audioAssembly": assembly, "trimPolicy": pure.TRIM_POLICY, "runtime": runtime, "device": device,
        "networkGuards": guards, "offlineEnvironmentVerified": True, "pronunciations": pronunciations,
        "localSynthesisCalls": len(rows), "externalApiCalls": 0, "costUsd": 0,
        "elapsedSeconds": round(time.monotonic() - started, 3), "formalVoiceRegistered": False,
        "episodeMutated": False, "gateChanged": False, "listeningAcceptance": False, "releaseEligible": False}
    with (output / "voice-result.json").open("x") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
