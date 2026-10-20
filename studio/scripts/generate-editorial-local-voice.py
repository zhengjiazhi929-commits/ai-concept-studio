#!/usr/bin/env python3
"""Offline short-phrase PCM production; never registers an Episode or renders video."""
import argparse
import hashlib
import importlib
import importlib.util
import inspect
import json
import re
import time
import wave
from pathlib import Path

RATE = 24000
PLAN_KEYS = {"schemaVersion", "sampleRate", "voiceId", "speed", "segments", "sourceTextSha256"}
SEGMENT_KEYS = {"id", "sceneId", "unitId", "text", "textSha256", "pauseAfterSamples"}
PIN_KEYS = {"model", "config", "voice", "python", "generator", "runtimeLock",
    "englishLexicon", "zhFrontend", "kokoroPipeline", "driver"}
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9:_.-]{0,127}\Z")
HASH = re.compile(r"[a-f0-9]{64}\Z")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def text_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def validate_plan(plan):
    require(type(plan) is dict and set(plan) == PLAN_KEYS, "Closed speech plan required")
    require(plan["schemaVersion"] == "editorial-voice-speech-plan-v1"
        and plan["sampleRate"] == RATE and plan["voiceId"] == "zm_010"
        and plan["speed"] == 1.1, "Unapproved voice or speed")
    segments = plan["segments"]
    require(type(segments) is list and 0 < len(segments) <= 4096, "Invalid segment count")
    scene_ids, unit_ids = set(), set()
    for index, segment in enumerate(segments):
        require(type(segment) is dict and set(segment) == SEGMENT_KEYS, "Closed speech segment required")
        require(segment["id"] == f"speech-{index + 1:04d}", "Unstable or repeated segment ID")
        require(all(type(segment[key]) is str and ID.fullmatch(segment[key])
            for key in ("sceneId", "unitId")), "Invalid source identity")
        text = segment["text"]
        require(type(text) is str and text.strip() and len(text) <= 28
            and not re.search(r"[\x00-\x1f]", text)
            and not re.match(r"[”’」』）》】]", text) and not re.search(r"、\s*$", text),
            "Unsafe or oversized phrase")
        require(segment["textSha256"] == text_hash(text), "Speech text hash changed")
        prior = segments[index - 1] if index else None
        if prior is None or prior["sceneId"] != segment["sceneId"]:
            require(segment["sceneId"] not in scene_ids, "Reordered scene")
            scene_ids.add(segment["sceneId"])
        if prior is None or prior["unitId"] != segment["unitId"]:
            require(segment["unitId"] not in unit_ids, "Reordered source unit")
            unit_ids.add(segment["unitId"])
        else:
            require(prior["sceneId"] == segment["sceneId"], "Source unit crosses scenes")
        following = segments[index + 1] if index + 1 < len(segments) else None
        expected_gap = (0 if following is None else 4800 if following["sceneId"] != segment["sceneId"]
            else 2880 if following["unitId"] != segment["unitId"] else 0)
        require(type(segment["pauseAfterSamples"]) is int
            and segment["pauseAfterSamples"] == expected_gap, "Unapproved silence or target-duration padding")
    require(plan["sourceTextSha256"] == text_hash("".join(item["text"] for item in segments)),
        "Complete source text hash changed")


def validate_request(request):
    require(type(request) is dict and set(request) == {"plan", "model", "pinnedFiles", "runtimeLock"},
        "Closed editorial voice request required")
    validate_plan(request["plan"])
    require(type(request["model"]) is dict
        and request["model"].get("repoId") == "hexgrad/Kokoro-82M-v1.1-zh"
        and request["model"].get("languageCode") == "z", "Unexpected local model")
    require(type(request["pinnedFiles"]) is dict and set(request["pinnedFiles"]) == PIN_KEYS,
        "All pinned local inputs are required")
    for item in request["pinnedFiles"].values():
        require(type(item) is dict and set(item) == {"path", "realPath", "bytes", "sha256"}
            and type(item["path"]) is str and Path(item["path"]).is_absolute()
            and type(item["realPath"]) is str and Path(item["realPath"]).is_absolute()
            and type(item["bytes"]) is int and item["bytes"] > 0
            and type(item["sha256"]) is str and HASH.fullmatch(item["sha256"]), "Invalid pinned input")
    require(type(request["runtimeLock"]) is dict, "Pinned runtime lock required")


def english_pronunciation(text, lexicon):
    keys = {"AI": ["AI"], "Agent": ["agent"], "RAG": ["R", "A", "G"], "A": ["A"], "B": ["B"]}
    require(text in keys, "Unapproved English term: " + text)
    entries = [lexicon.get(key) for key in keys[text]]
    require(all(type(value) is str and value for value in entries), "Missing pinned English pronunciation")
    return " ".join(entries)


def validate_phonemes(identifier, phonemes, vocabulary):
    require(type(phonemes) is str and 0 < len(phonemes) <= 510 and "❓" not in phonemes,
        "Unsafe phoneme length or unknown symbol: " + identifier)
    missing = sorted(set(phonemes).difference(vocabulary))
    require(not missing, "Unsupported phonemes: " + identifier + ": " + repr(missing))
    return {"id": identifier, "length": len(phonemes), "sha256": text_hash(phonemes), "missingVocabulary": []}


def verify_pins(pins):
    for item in pins.values():
        path = Path(item["path"])
        require(str(path.resolve(strict=True)) == item["realPath"] and path.is_file()
            and path.stat().st_size == item["bytes"] and digest(path) == item["sha256"],
            "Pinned input changed: " + str(path))


def verify_loaded_frontend_paths(pins, pipeline_file, zh_file):
    """A matching disk pin is insufficient if Python imported another module."""
    for key, filename in (("kokoroPipeline", pipeline_file), ("zhFrontend", zh_file)):
        require(type(filename) is str and filename, "Missing loaded frontend file: " + key)
        loaded = Path(filename).resolve(strict=True)
        pin = pins[key]
        require(str(loaded) == pin["realPath"] and loaded.is_file()
            and loaded.stat().st_size == pin["bytes"] and digest(loaded) == pin["sha256"],
            "Loaded frontend differs from pinned input: " + key)


def write_segment(path, audio, np):
    require(audio.ndim == 1 and RATE / 4 <= audio.size <= RATE * 65
        and bool(np.all(np.isfinite(audio))), "Invalid generated PCM length or values")
    peak = float(np.max(np.abs(audio)))
    require(0 < peak < 0.999, "Silent or clipped generated audio")
    with path.open("xb") as destination:
        with wave.open(destination, "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(RATE)
            writer.writeframes(np.round(audio * 32767).astype("<i2").tobytes())
    return {"file": path.name, "sampleCount": int(audio.size), "bytes": path.stat().st_size, "sha256": digest(path)}


def assemble_voice(output, segments, plan):
    path = output / "voice.wav"
    sample_count = 0
    with path.open("xb") as destination:
        with wave.open(destination, "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(RATE)
            for result, segment in zip(segments, plan["segments"]):
                source = output / result["file"]
                require(digest(source) == result["sha256"], "Segment changed during assembly")
                with wave.open(str(source), "rb") as reader:
                    require(reader.getnchannels() == 1 and reader.getsampwidth() == 2
                        and reader.getframerate() == RATE and reader.getnframes() == result["sampleCount"],
                        "PCM inspection mismatch")
                    pcm = reader.readframes(reader.getnframes())
                    require(len(pcm) == result["sampleCount"] * 2, "Truncated generated PCM")
                    writer.writeframes(pcm)
                writer.writeframes(b"\0\0" * segment["pauseAfterSamples"])
                sample_count += result["sampleCount"] + segment["pauseAfterSamples"]
                require(sample_count <= RATE * 3600, "Audio exceeds bounded one-hour output")
    return {"file": path.name, "sampleCount": sample_count, "bytes": path.stat().st_size, "sha256": digest(path)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--request-sha256", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    require(HASH.fullmatch(args.request_sha256) and digest(args.request) == args.request_sha256,
        "Request changed before execution")
    request = json.loads(Path(args.request).read_text())
    validate_request(request)
    output = Path(args.output).resolve(strict=True)
    require(output.is_dir() and not any(output.iterdir()), "Output directory must be new and empty")
    verify_pins(request["pinnedFiles"])
    pins = request["pinnedFiles"]
    require(Path(__file__).resolve() == Path(pins["driver"]["realPath"]), "Executing unpinned driver")
    require(json.loads(Path(pins["runtimeLock"]["path"]).read_text()) == request["runtimeLock"],
        "Runtime lock file mismatch")
    spec = importlib.util.spec_from_file_location("pinned_kokoro_generator", pins["generator"]["path"])
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)  # The helper installs socket guards before model imports.
    helper.require_offline_environment()
    guards = helper.verify_network_guard_behavior()
    helper.load_inference_stack()
    verify_loaded_frontend_paths(pins, inspect.getfile(helper.KPipeline),
        importlib.import_module("misaki.zh").__file__)
    runtime = helper.runtime_fingerprint()
    helper.require_pinned_runtime(request["runtimeLock"], runtime)
    lexicon = json.loads(Path(pins["englishLexicon"]["path"]).read_text())
    plan = request["plan"]
    pronunciations = {term: english_pronunciation(term, lexicon)
        for segment in plan["segments"] for term in re.findall(r"[A-Za-z]+", segment["text"])}
    torch, np = helper.torch, helper.np
    torch.manual_seed(20260812)
    torch.set_num_threads(2)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = helper.KModel(repo_id=request["model"]["repoId"], config=pins["config"]["path"],
        model=pins["model"]["path"]).to(device).eval()
    pipeline = helper.KPipeline(lang_code="z", repo_id=request["model"]["repoId"], model=model,
        device=device, en_callable=lambda value: english_pronunciation(value, lexicon))
    vocabulary = json.loads(Path(pins["config"]["path"]).read_text())["vocab"]
    checks = []
    for segment in plan["segments"]:
        phonemes, _ = pipeline.g2p(segment["text"])
        checks.append(validate_phonemes(segment["id"], phonemes, vocabulary))
    results = []
    started = time.monotonic()
    for segment, phoneme_check in zip(plan["segments"], checks):
        audio, metrics = helper.synthesize(pipeline, segment["text"], pins["voice"]["path"], plan["speed"], RATE)
        result = write_segment(output / (segment["id"] + ".wav"), audio, np)
        results.append({"id": segment["id"], "sceneId": segment["sceneId"], "unitId": segment["unitId"],
            "text": segment["text"], "textSha256": segment["textSha256"], "pauseAfterSamples": segment["pauseAfterSamples"],
            **result, "metrics": metrics, "phonemeCheck": phoneme_check})
        print(json.dumps({"id": segment["id"], "sampleCount": result["sampleCount"],
            "durationSeconds": result["sampleCount"] / RATE}, ensure_ascii=False), flush=True)
    voice = assemble_voice(output, results, plan)
    verify_pins(pins)
    require(digest(args.request) == args.request_sha256, "Request changed during inference")
    result = {"schemaVersion": "editorial-local-voice-result-v1", "requestSha256": args.request_sha256,
        "planSourceTextSha256": plan["sourceTextSha256"], "sampleRate": RATE, "voiceId": plan["voiceId"],
        "speed": plan["speed"], "segments": results, "voice": voice, "runtime": runtime,
        "networkGuards": guards, "offlineEnvironmentVerified": True, "device": device,
        "pronunciations": pronunciations, "externalApiCalls": 0, "costUsd": 0,
        "elapsedSeconds": round(time.monotonic() - started, 3), "formalVoiceRegistered": False,
        "releaseEligible": False}
    with (output / "result.json").open("x") as destination:
        json.dump(result, destination, ensure_ascii=False, indent=2)
        destination.write("\n")


if __name__ == "__main__":
    main()
