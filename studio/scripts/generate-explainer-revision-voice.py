#!/usr/bin/env python3
"""Bound offline review voice only. Never registers an Episode, gate, or release."""
import argparse
import array
import hashlib
import importlib
import importlib.util
import inspect
import json
import math
import re
import sys
import time
import wave
from pathlib import Path

RATE = 24000
FRAME_SAMPLES = 800
MAX_SAMPLES = RATE * 150
PIN_KEYS = {"model", "config", "voice", "python", "generator", "runtimeLock",
    "englishLexicon", "zhFrontend", "kokoroPipeline", "driver", "editorialDriver"}
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}\Z")
HASH = re.compile(r"[a-f0-9]{64}\Z")
MODEL = {"repoId": "hexgrad/Kokoro-82M-v1.1-zh", "revision": "01e7505bd6a7a2ac4975463114c3a7650a9f7218",
    "fileName": "kokoro-v1_1-zh.pth", "sha256": "b1d8410fa44dfb5c15471fd6c4225ea6b4e9ac7fa03c98e8bea47a9928476e2b",
    "configSha256": "bc333efa5ce4ceff433c8c8e5d027a1eca0166001e4e4a62bea2d26ff7a46890",
    "codeRepoId": "hexgrad/kokoro", "codeRevision": "dfb907a02bba8152ca444717ca5d78747ccb4bec", "languageCode": "z"}
ASSET_HASHES = {"model": MODEL["sha256"], "config": MODEL["configSha256"],
    "voice": "d2eeba86192eee269f600ca6821038034abd017532a1fe68ff7b0e86c2983b2a",
    "englishLexicon": "dc414872a49a28ae6c141463d502fd945f3b2fde040484fdc47d00cc4612686f",
    "zhFrontend": "97d16aec581832845d2566cb24da2ba045d4552fb65a5017a6eac8feef654c81",
    "kokoroPipeline": "499982bbc23a1019681cdb4c327c1d911e7034e240721b95686ff1a8f15c2a9a"}
TRIM_POLICY = {"schemaVersion": "conservative-pcm-edge-v1", "sampleRate": RATE,
    "windowSamples": 480, "rmsThresholdDbFS": -60, "peakThresholdDbFS": -50,
    "minimumQuietRunSamples": 7200, "headGuardSamples": 2400, "tailGuardSamples": 4320}


def require(value, message):
    if not value:
        raise ValueError(message)


def closed(value, keys):
    require(type(value) is dict and set(value) == set(keys), "Unexpected closed schema")


def sha_bytes(value):
    return hashlib.sha256(value).hexdigest()


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def valid_text(value, maximum):
    return type(value) is str and 0 < len(value) <= maximum and value.strip() and not re.search(r"[\x00-\x1f]", value)


def validate_plan(plan):
    closed(plan, ["schemaVersion", "chapters", "clips"])
    require(plan["schemaVersion"] == "explainer-revision-plan-v1", "Unexpected plan version")
    require(type(plan["chapters"]) is list and 1 <= len(plan["chapters"]) <= 12, "Invalid chapters")
    chapters = set()
    for chapter in plan["chapters"]:
        closed(chapter, ["id", "label"])
        require(type(chapter["id"]) is str and IDENTIFIER.fullmatch(chapter["id"])
            and chapter["id"] not in chapters and valid_text(chapter["label"], 60), "Invalid chapter")
        chapters.add(chapter["id"])
    require(type(plan["clips"]) is list and 1 <= len(plan["clips"]) <= 3, "At most three clips")
    rows, clips, ids = [], set(), set()
    for clip in plan["clips"]:
        closed(clip, ["id", "title", "segments"])
        require(type(clip["id"]) is str and IDENTIFIER.fullmatch(clip["id"])
            and clip["id"] not in clips and valid_text(clip["title"], 100), "Invalid clip")
        clips.add(clip["id"])
        require(type(clip["segments"]) is list and clip["segments"], "Empty clip")
        for segment in clip["segments"]:
            closed(segment, ["id", "text", "visual", "chapterId", "pauseAfterMs"])
            require(type(segment["id"]) is str and IDENTIFIER.fullmatch(segment["id"])
                and segment["id"] not in ids, "Invalid or repeated segment")
            ids.add(segment["id"])
            require(valid_text(segment["text"], 28) and segment["chapterId"] in chapters,
                "Unsafe text, oversized phrase, or unknown chapter")
            require(type(segment["pauseAfterMs"]) is int and 0 <= segment["pauseAfterMs"] <= 1000,
                "Invalid semantic pause")
            require(isinstance(segment["visual"], (str, dict)) and bool(segment["visual"]), "Missing visual reference")
            rows.append({**segment, "clipId": clip["id"]})
    require(0 < len(rows) <= 60 and rows[-1]["pauseAfterMs"] == 0, "At most 60 segments; final pause is zero")
    for previous, following in zip(rows, rows[1:]):
        if previous["clipId"] != following["clipId"]:
            require(previous["pauseAfterMs"] >= 100, "Clip boundary requires a declared 100 ms or longer pause")
    return rows


def aligned_sample_count(samples):
    require(type(samples) is int and 0 < samples <= MAX_SAMPLES, "150-second audio cap")
    tail = (-samples) % FRAME_SAMPLES
    require(samples + tail <= MAX_SAMPLES, "Aligned audio exceeds 150 seconds")
    return samples + tail, tail


def pcm_values(data):
    require(type(data) is bytes and len(data) % 2 == 0, "Partial PCM sample")
    values = array.array("h")
    values.frombytes(data)
    if sys.byteorder != "little":
        values.byteswap()
    return values


def trim_pcm_edges(data):
    """Only cut continuous quiet edges, retaining guards; never touch an interior sample."""
    values = pcm_values(data)
    require(RATE // 4 <= len(values) <= MAX_SAMPLES, "Invalid raw PCM duration")
    peak = max(abs(v) for v in values)
    require(0 < peak < 32767, "Silent or clipped PCM")
    window = TRIM_POLICY["windowSamples"]
    rms_limit = 32768 * 10 ** (TRIM_POLICY["rmsThresholdDbFS"] / 20)
    peak_limit = 32768 * 10 ** (TRIM_POLICY["peakThresholdDbFS"] / 20)

    def quiet(block):
        return (bool(block) and max(abs(v) for v in block) <= peak_limit
            and math.sqrt(sum(v * v for v in block) / len(block)) <= rms_limit)

    leading = 0
    while leading + window <= len(values) and quiet(values[leading:leading + window]):
        leading += window
    trailing = 0
    while trailing + window <= len(values) and quiet(values[len(values) - trailing - window:len(values) - trailing]):
        trailing += window
    require(leading + trailing < len(values), "Only near-silent signal; refuse trimming")
    head = max(0, leading - TRIM_POLICY["headGuardSamples"]) if leading >= TRIM_POLICY["minimumQuietRunSamples"] else 0
    tail = max(0, trailing - TRIM_POLICY["tailGuardSamples"]) if trailing >= TRIM_POLICY["minimumQuietRunSamples"] else 0
    result = data[head * 2:(len(values) - tail) * 2]
    require(len(result) >= RATE // 4 * 2, "Trimming would leave less than 250 ms")
    return result, {**TRIM_POLICY, "rawSampleCount": len(values), "sampleCount": len(result) // 2,
        "leadingQuietSamples": leading, "trailingQuietSamples": trailing,
        "headRemovedSamples": head, "tailRemovedSamples": tail, "interiorRemovedSamples": 0,
        "rawPcmSha256": sha_bytes(data), "trimmedPcmSha256": sha_bytes(result),
        "retainedPcmBytesIdentical": result == data[head * 2:(len(values) - tail) * 2],
        "assurance": "Threshold-defined edge silence only; breath preservation still requires listening."}


def write_pcm(path, data):
    require(type(data) is bytes and 0 < len(data) <= MAX_SAMPLES * 2 and len(data) % 2 == 0, "Invalid PCM")
    with Path(path).open("xb") as destination:
        with wave.open(destination, "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(RATE)
            writer.writeframes(data)
    return {"file": Path(path).name, "sampleCount": len(data) // 2,
        "bytes": Path(path).stat().st_size, "sha256": digest(path)}


def read_pcm(directory, record):
    closed(record, ["file", "sampleCount", "bytes", "sha256"])
    require(type(record["file"]) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.wav", record["file"])
        and "/" not in record["file"], "Unsafe WAV filename")
    path = directory / record["file"]
    require(not path.is_symlink() and path.is_file() and path.stat().st_size == record["bytes"]
        and digest(path) == record["sha256"], "Changed PCM input")
    with wave.open(str(path), "rb") as source:
        require((source.getframerate(), source.getnchannels(), source.getsampwidth(), source.getnframes())
            == (RATE, 1, 2, record["sampleCount"]), "Unexpected PCM contract")
        data = source.readframes(source.getnframes())
    require(len(data) == record["sampleCount"] * 2, "Truncated PCM")
    return data


def assemble_candidate(output, records):
    require(records and len(records) <= 60, "Invalid segment records")
    parts, rows, cursor = [], [], 0
    for record in records:
        data = verify_trim_record(output, record)
        pause = record["pauseAfterMs"] * RATE // 1000
        start, end = cursor, cursor + len(data) // 2
        cursor = end + pause
        aligned_sample_count(cursor)
        rows.append({key: value for key, value in record.items() if key != "pauseAfterMs"})
        rows[-1].update(startSample=start, endSample=end, pauseAfterSamples=pause)
        parts.extend([data, bytes(pause * 2)])
    require(rows[-1]["pauseAfterSamples"] == 0, "Final segment cannot insert a pause")
    target, tail = aligned_sample_count(cursor)
    parts.append(bytes(tail * 2))
    voice = write_pcm(output / "voice.wav", b"".join(parts))
    return voice, rows, {"speechAndPauseSamples": cursor, "tailPaddingSamples": tail, "targetSamples": target}


def verify_trim_record(output, record):
    require(type(record) is dict and {"raw", "trimmed", "trimEvidence"}.issubset(record), "Missing original PCM evidence")
    original = read_pcm(output, record["raw"])
    retained, evidence = trim_pcm_edges(original)
    actual = read_pcm(output, record["trimmed"])
    require(record["trimEvidence"] == evidence and actual == retained, "Original, retained PCM and trim evidence differ")
    require(evidence["headRemovedSamples"] + len(actual) // 2 + evidence["tailRemovedSamples"]
        == len(original) // 2, "Trim sample conservation failed")
    return actual


def verify_file_pin(pin):
    closed(pin, ["path", "realPath", "bytes", "sha256"])
    require(type(pin["path"]) is str and Path(pin["path"]).is_absolute()
        and type(pin["realPath"]) is str and Path(pin["realPath"]).is_absolute()
        and type(pin["sha256"]) is str and HASH.fullmatch(pin["sha256"])
        and type(pin["bytes"]) is int and pin["bytes"] > 0, "Invalid file pin")
    path = Path(pin["path"])
    require(path.is_file() and str(path.resolve(strict=True)) == pin["realPath"]
        and path.stat().st_size == pin["bytes"] and digest(path) == pin["sha256"], "Changed pinned input")


def validate_asset_pins(model, pins):
    require(model == MODEL, "Unexpected pinned model configuration")
    for key, expected in ASSET_HASHES.items():
        require(type(pins.get(key)) is dict and pins[key].get("sha256") == expected, "Unapproved asset: " + key)


def validate_request(request):
    closed(request, ["schemaVersion", "plan", "model", "pinnedFiles", "runtimeLock"])
    require(request["schemaVersion"] == "explainer-revision-voice-request-v1", "Unexpected request")
    rows = validate_plan(request["plan"])
    pins = request["pinnedFiles"]
    closed(pins, PIN_KEYS)
    validate_asset_pins(request["model"], pins)
    for pin in pins.values():
        verify_file_pin(pin)
    require(Path(__file__).resolve() == Path(pins["driver"]["realPath"]), "Unpinned executing driver")
    require(Path(sys.executable).resolve() == Path(pins["python"]["realPath"]), "Unpinned interpreter")
    require(type(request["runtimeLock"]) is dict and json.loads(Path(pins["runtimeLock"]["path"]).read_text())
        == request["runtimeLock"], "Changed runtime lock")
    scripts = Path(__file__).resolve().parent
    for key, expected in {"generator": scripts / "generate-agent-skill-local-tts.py",
        "editorialDriver": scripts / "generate-editorial-local-voice.py",
        "runtimeLock": scripts.parent / "config/local-tts-python-runtime.lock.json"}.items():
        require(Path(pins[key]["realPath"]) == expected, "Unexpected source helper location: " + key)
    require(pins["python"]["sha256"] == request["runtimeLock"].get("executableSha256"), "Interpreter differs from runtime lock")
    return rows


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_request(path, expected_sha):
    require(type(expected_sha) is str and HASH.fullmatch(expected_sha), "Missing request SHA")
    require(digest(path) == expected_sha, "Request changed before execution")

    def no_duplicates(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result

    def reject_constant(_):
        raise ValueError("Nonfinite JSON")

    require(Path(path).stat().st_size <= 512 * 1024, "Oversized request")
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
        and str(output.resolve()) == str(output) and not any(output.iterdir()), "New, empty, real output directory required")
    pins = request["pinnedFiles"]
    original = load_module("pinned_editorial_voice_helpers", pins["editorialDriver"]["path"])
    original.verify_pins(pins)
    helper = load_module("pinned_offline_generator", pins["generator"]["path"])
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
    # Validate every phoneme before loading model weights or running inference.
    pipeline = helper.KPipeline(lang_code="z", repo_id=request["model"]["repoId"], model=False,
        device=device, en_callable=lambda value: original.english_pronunciation(value, lexicon))
    vocabulary = json.loads(Path(pins["config"]["path"]).read_text())["vocab"]
    checks = [original.validate_phonemes(segment["id"], pipeline.g2p(segment["text"])[0], vocabulary) for segment in segments]
    # Explicit local model/config/voice; no implicit HuggingFace retrieval.
    model = helper.KModel(repo_id=request["model"]["repoId"], config=pins["config"]["path"], model=pins["model"]["path"]).to(device).eval()
    pipeline.model = model
    results, cursor = [], 0
    started = time.monotonic()
    for segment, check in zip(segments, checks):
        audio, metrics = helper.synthesize(pipeline, segment["text"], pins["voice"]["path"], 1.1, RATE)
        require(audio.ndim == 1 and RATE // 4 <= audio.size <= MAX_SAMPLES
            and bool(np.all(np.isfinite(audio))) and float(np.max(np.abs(audio))) < .999, "Invalid synthesized waveform")
        raw_pcm = np.round(audio * 32767).astype("<i2").tobytes()
        raw = write_pcm(output / (segment["id"] + ".raw.wav"), raw_pcm)
        trimmed_pcm, trim = trim_pcm_edges(raw_pcm)
        cursor += len(trimmed_pcm) // 2 + segment["pauseAfterMs"] * RATE // 1000
        aligned_sample_count(cursor)
        trimmed = write_pcm(output / (segment["id"] + ".trimmed.wav"), trimmed_pcm)
        results.append({**segment, "raw": raw, "trimmed": trimmed, "trimEvidence": trim,
            "textSha256": sha_bytes(segment["text"].encode()), "phonemeCheck": check, "metrics": metrics})
        print(json.dumps({"id": segment["id"], "rawSamples": raw["sampleCount"],
            "trimmedSamples": trimmed["sampleCount"]}), flush=True)
    voice, rows, assembly = assemble_candidate(output, results)
    original.verify_pins(pins)
    require(digest(args.request) == args.request_sha256, "Request changed during inference")
    result = {"schemaVersion": "explainer-revision-voice-result-v1", "requestSha256": args.request_sha256,
        "sampleRate": RATE, "voiceId": "zm_010", "speed": 1.1, "voice": voice, "segments": rows,
        "audioAssembly": assembly, "trimPolicy": TRIM_POLICY, "runtime": runtime, "device": device,
        "networkGuards": guards, "offlineEnvironmentVerified": True, "pronunciations": pronunciations,
        "localSynthesisCalls": len(rows), "externalApiCalls": 0, "costUsd": 0,
        "elapsedSeconds": round(time.monotonic() - started, 3), "formalVoiceRegistered": False,
        "episodeMutated": False, "gateChanged": False, "listeningAcceptance": False, "releaseEligible": False}
    with (output / "voice-result.json").open("x") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
