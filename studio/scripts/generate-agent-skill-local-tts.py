#!/usr/bin/env python3
"""Generate local Kokoro voice candidates and a 60-second proof with networking blocked."""

import argparse
import json
import math
import os
import socket
import time
from pathlib import Path


def block_network(*_args, **_kwargs):
    raise RuntimeError("Local TTS generation forbids network connections")


# Install the guard before importing the inference stack. Local model files are mandatory.
socket.socket.connect = block_network
socket.socket.connect_ex = block_network
socket.create_connection = block_network
socket.getaddrinfo = block_network
socket.socket.sendto = block_network

NETWORK_GUARDS = (
    "socket.connect",
    "socket.connect_ex",
    "socket.create_connection",
    "socket.getaddrinfo",
    "socket.sendto",
)


def load_inference_stack():
    global np, sf, torch, KModel, KPipeline
    import numpy as np
    import soundfile as sf
    import torch
    from kokoro import KModel, KPipeline


def parse_arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request")
    parser.add_argument("--result")
    parser.add_argument("--network-guard-self-test", action="store_true")
    parser.add_argument("--validate-pacing-segment")
    arguments = parser.parse_args()
    if (
        not arguments.network_guard_self_test
        and not arguments.validate_pacing_segment
        and (not arguments.request or not arguments.result)
    ):
        parser.error("--request and --result are required")
    return arguments


def verify_network_guard_behavior():
    checks = (
        ("socket.connect", lambda: socket.socket.connect(None, ("127.0.0.1", 9))),
        ("socket.connect_ex", lambda: socket.socket.connect_ex(None, ("127.0.0.1", 9))),
        ("socket.create_connection", lambda: socket.create_connection(("127.0.0.1", 9))),
        ("socket.getaddrinfo", lambda: socket.getaddrinfo("invalid.local", 443)),
        ("socket.sendto", lambda: socket.socket.sendto(None, b"x", ("127.0.0.1", 9))),
    )
    blocked = []
    for label, operation in checks:
        try:
            operation()
        except RuntimeError as error:
            if str(error) != "Local TTS generation forbids network connections":
                raise
            blocked.append(label)
        else:
            raise RuntimeError(f"Network guard did not block {label}")
    return blocked


def require_offline_environment():
    required = ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE")
    missing = [name for name in required if os.environ.get(name) != "1"]
    if missing:
        raise RuntimeError("Offline environment is incomplete: " + ", ".join(missing))


def finite_number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def validate_segment_pacing(segment):
    speech_parts = segment.get("speechParts")
    if speech_parts is None:
        return {"explicitPauseSeconds": 0.0, "speechPartCount": 0}
    if not isinstance(speech_parts, list) or len(speech_parts) < 2:
        raise RuntimeError(f"{segment.get('id', 'unknown')} speechParts requires at least two parts")

    texts = []
    explicit_pause_seconds = 0.0
    for index, part in enumerate(speech_parts):
        text = part.get("text") if isinstance(part, dict) else None
        pause = part.get("pauseAfterSeconds") if isinstance(part, dict) else None
        if not isinstance(text, str) or not text:
            raise RuntimeError(f"{segment['id']} speechParts[{index}] text is invalid")
        if not finite_number(pause) or pause < 0:
            raise RuntimeError(f"{segment['id']} speechParts[{index}] pause is invalid")
        if index == len(speech_parts) - 1 and pause != 0:
            raise RuntimeError(f"{segment['id']} final speechPart cannot have a pause")
        texts.append(text)
        explicit_pause_seconds += float(pause)

    if "".join(texts) != segment.get("text"):
        raise RuntimeError(f"{segment['id']} speechParts text does not match segment text")
    minimum_pause = segment.get("minimumExplicitPauseSeconds")
    maximum_pause = segment.get("maximumExplicitPauseSeconds")
    if (
        not finite_number(minimum_pause)
        or not finite_number(maximum_pause)
        or explicit_pause_seconds < float(minimum_pause) - 0.001
        or explicit_pause_seconds > float(maximum_pause) + 0.001
    ):
        raise RuntimeError(f"{segment['id']} explicit pause is outside the approved range")
    slot_seconds = float(segment["end"] - segment["start"])
    if explicit_pause_seconds >= slot_seconds:
        raise RuntimeError(f"{segment['id']} explicit pause exceeds its scene slot")
    return {
        "explicitPauseSeconds": round(explicit_pause_seconds, 3),
        "speechPartCount": len(speech_parts),
    }


def normalize_audio(audio):
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    if samples.size == 0:
        raise RuntimeError("Kokoro returned empty audio")
    peak = float(np.max(np.abs(samples)))
    if not np.isfinite(peak) or peak <= 0:
        raise RuntimeError("Kokoro returned silent or invalid audio")
    gain = min(0.92 / peak, 1.6)
    return np.clip(samples * gain, -1.0, 1.0), peak, gain


def synthesize(pipeline, text, voice_path, speed, sample_rate):
    started = time.perf_counter()
    chunks = []
    with torch.inference_mode():
        for result in pipeline(
            text,
            voice=str(voice_path),
            speed=float(speed),
            split_pattern=None,
        ):
            if result.audio is not None:
                chunks.append(result.audio.detach().float().cpu().numpy())
    if not chunks:
        raise RuntimeError("Kokoro did not produce an audio chunk")
    gap = np.zeros(round(sample_rate * 0.08), dtype=np.float32)
    joined = chunks[0] if len(chunks) == 1 else np.concatenate(
        [part for index, chunk in enumerate(chunks) for part in ((gap,) if index else ()) + (chunk,)]
    )
    normalized, original_peak, gain = normalize_audio(joined)
    return normalized, {
        "durationSeconds": round(normalized.size / sample_rate, 3),
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "originalPeak": round(original_peak, 6),
        "normalizationGain": round(gain, 6),
    }


def synthesize_segment(pipeline, segment, voice_path, speed, sample_rate):
    pacing = validate_segment_pacing(segment)
    speech_parts = segment.get("speechParts")
    if speech_parts is None:
        audio, metrics = synthesize(
            pipeline,
            segment["text"],
            voice_path,
            speed,
            sample_rate,
        )
        return audio, {
            **metrics,
            "speechDurationSeconds": metrics["durationSeconds"],
            "explicitPauseSeconds": 0.0,
            "speechPartMetrics": [],
        }

    started = time.perf_counter()
    audio_parts = []
    part_metrics = []
    speech_samples = 0
    explicit_pause_samples = 0
    for index, part in enumerate(speech_parts):
        audio, metrics = synthesize(
            pipeline,
            part["text"],
            voice_path,
            speed,
            sample_rate,
        )
        audio_parts.append(audio)
        speech_samples += audio.size
        pause_samples = round(float(part["pauseAfterSeconds"]) * sample_rate)
        explicit_pause_samples += pause_samples
        if pause_samples:
            audio_parts.append(np.zeros(pause_samples, dtype=np.float32))
        part_metrics.append({
            "index": index,
            "text": part["text"],
            "durationSeconds": round(audio.size / sample_rate, 3),
            "pauseAfterSeconds": round(pause_samples / sample_rate, 3),
            "originalPeak": metrics["originalPeak"],
            "normalizationGain": metrics["normalizationGain"],
        })

    joined = np.concatenate(audio_parts)
    explicit_pause_seconds = round(explicit_pause_samples / sample_rate, 3)
    if abs(explicit_pause_seconds - pacing["explicitPauseSeconds"]) > 0.001:
        raise RuntimeError(f"{segment['id']} rendered explicit pause drifted from the contract")
    return joined, {
        "durationSeconds": round(joined.size / sample_rate, 3),
        "speechDurationSeconds": round(speech_samples / sample_rate, 3),
        "explicitPauseSeconds": explicit_pause_seconds,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "originalPeak": max(item["originalPeak"] for item in part_metrics),
        "normalizationGain": min(item["normalizationGain"] for item in part_metrics),
        "speechPartMetrics": part_metrics,
    }


def write_wav(path, audio, sample_rate):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    sf.write(target, audio, sample_rate, subtype="PCM_16")


def render_segment(pipeline, segment, voice_path, sample_rate):
    slot_seconds = float(segment["end"] - segment["start"])
    pacing = validate_segment_pacing(segment)
    explicit_pause_seconds = pacing["explicitPauseSeconds"]
    target_trailing_silence = float(segment.get("targetTrailingSilenceSeconds", 0.55))
    minimum_speed = float(segment.get("minimumSpeed", 0.86))
    maximum_estimated_speed = float(segment.get("maximumEstimatedSpeed", 1.35))
    maximum_speed = float(segment.get("maximumSpeed", 1.45))
    maximum_trailing_silence = float(
        segment.get("maximumTrailingSilenceSeconds", slot_seconds)
    )
    if not 0 <= target_trailing_silence < slot_seconds:
        raise RuntimeError(f"{segment['id']} target trailing silence is invalid")
    if not 0 < minimum_speed <= maximum_estimated_speed <= maximum_speed:
        raise RuntimeError(f"{segment['id']} speed constraints are invalid")
    if not target_trailing_silence <= maximum_trailing_silence <= slot_seconds:
        raise RuntimeError(f"{segment['id']} maximum trailing silence is invalid")

    target_spoken_seconds = max(
        0.5,
        slot_seconds - target_trailing_silence - explicit_pause_seconds,
    )
    speed = min(maximum_speed, max(minimum_speed, float(segment.get("preferredSpeed", 1.0))))
    audio, metrics = synthesize_segment(pipeline, segment, voice_path, speed, sample_rate)
    attempts = 1

    estimated_speed = min(
        maximum_estimated_speed,
        max(minimum_speed, speed * metrics["speechDurationSeconds"] / target_spoken_seconds),
    )
    if abs(estimated_speed - speed) >= 0.015:
        speed = estimated_speed
        audio, metrics = synthesize_segment(pipeline, segment, voice_path, speed, sample_rate)
        attempts += 1

    while metrics["durationSeconds"] > slot_seconds - 0.12 and attempts < 4:
        next_speed = min(
            maximum_speed,
            speed * metrics["speechDurationSeconds"]
            / (slot_seconds - explicit_pause_seconds - 0.35)
            * 1.02,
        )
        if next_speed <= speed + 0.001:
            break
        speed = next_speed
        audio, metrics = synthesize_segment(pipeline, segment, voice_path, speed, sample_rate)
        attempts += 1

    slot_samples = round(slot_seconds * sample_rate)
    if audio.size > slot_samples:
        raise RuntimeError(
            f"{segment['id']} audio {audio.size / sample_rate:.3f}s exceeds {slot_seconds:.3f}s slot"
        )
    trailing_samples = slot_samples - audio.size
    trailing_silence_seconds = trailing_samples / sample_rate
    if trailing_silence_seconds > maximum_trailing_silence + 0.001:
        raise RuntimeError(
            f"{segment['id']} trailing silence {trailing_silence_seconds:.3f}s exceeds "
            f"{maximum_trailing_silence:.3f}s"
        )
    padded = np.pad(audio, (0, trailing_samples))
    return padded, {
        **segment,
        **metrics,
        "speed": round(speed, 6),
        "attempts": attempts,
        "trailingSilenceSeconds": round(trailing_silence_seconds, 3),
    }


def main():
    arguments = parse_arguments()
    if arguments.network_guard_self_test:
        print(json.dumps({
            "networkGuard": "python-socket-connect-blocked",
            "networkGuards": verify_network_guard_behavior(),
        }, ensure_ascii=False))
        return
    if arguments.validate_pacing_segment:
        print(json.dumps(
            validate_segment_pacing(json.loads(arguments.validate_pacing_segment)),
            ensure_ascii=False,
        ))
        return

    require_offline_environment()
    load_inference_stack()
    request = json.loads(Path(arguments.request).read_text(encoding="utf-8"))
    sample_rate = int(request["sampleRate"])
    model_config_path = Path(request["model"]["configPath"])
    model_path = Path(request["model"]["modelPath"])
    if not model_config_path.is_file() or not model_path.is_file():
        raise RuntimeError("Pinned local Kokoro model files are missing")

    torch.manual_seed(20260812)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    started = time.perf_counter()
    model = KModel(
        repo_id=request["model"]["repoId"],
        config=str(model_config_path),
        model=str(model_path),
    ).to(device).eval()
    pipeline = KPipeline(
        lang_code=request["model"]["languageCode"],
        repo_id=request["model"]["repoId"],
        model=model,
        device=device,
    )

    candidate_results = []
    for candidate in request["candidates"]:
        voice_path = Path(candidate["voicePath"])
        if not voice_path.is_file():
            raise RuntimeError(f"Pinned local voice file is missing: {candidate['voiceId']}")
        audio, metrics = synthesize(
            pipeline,
            request["candidateText"],
            voice_path,
            candidate.get("speed", 1.0),
            sample_rate,
        )
        write_wav(candidate["outputPath"], audio, sample_rate)
        candidate_results.append({
            "voiceId": candidate["voiceId"],
            "outputPath": candidate["outputPath"],
            "speed": float(candidate.get("speed", 1.0)),
            **metrics,
        })

    proof_voice_path = Path(request["proof"]["voicePath"])
    rendered_segments = []
    proof_parts = []
    for segment in request["proof"]["segments"]:
        padded, metrics = render_segment(
            pipeline,
            segment,
            proof_voice_path,
            sample_rate,
        )
        proof_parts.append(padded)
        rendered_segments.append(metrics)
    proof_audio = np.concatenate(proof_parts)
    expected_samples = round(float(request["proof"]["durationSeconds"]) * sample_rate)
    if proof_audio.size != expected_samples:
        raise RuntimeError(f"Proof has {proof_audio.size} samples, expected {expected_samples}")
    write_wav(request["proof"]["outputPath"], proof_audio, sample_rate)

    result = {
        "schemaVersion": 1,
        "device": device,
        "networkGuard": "python-socket-connect-blocked",
        "networkGuards": list(NETWORK_GUARDS),
        "offlineEnvironmentVerified": True,
        "sampleRate": sample_rate,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "candidates": candidate_results,
        "proof": {
            "outputPath": request["proof"]["outputPath"],
            "durationSeconds": round(proof_audio.size / sample_rate, 3),
            "segments": rendered_segments,
        },
    }
    Path(arguments.result).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
