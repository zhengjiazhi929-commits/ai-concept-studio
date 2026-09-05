#!/usr/bin/env python3
"""Build visual-QA metrics and contact sheets for a versioned long-review candidate."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


LEGACY_QA_SCHEMA_VERSION = "agent-skill-long-review-wide-v004-qa-pipeline-v2"
THRESHOLDS = {
    "periodicIntervalSeconds": 2,
    "staticMainContentMeanAbsDiff8BitMaximum": 0.65,
    "staticMainContentChangedPixelRatioMaximum": 0.015,
    "staticMinimumRunSeconds": 8,
    "changedPixelLumaDelta8Bit": 4.0,
    "lowInformationLumaStdMaximum": 9.0,
    "lowInformationEdgeDensityMaximum": 0.008,
    "lowInformationForegroundRatioMaximum": 0.045,
    "foregroundRgbDistance8Bit": 22.0,
    "edgeLumaDelta8Bit": 12.0,
    "mainContentCropNormalized": [0.04, 0.08, 0.88, 0.78],
}

PALETTE = {
    "canvas": "#EEF3F0",
    "panel": "#F9FBFA",
    "ink": "#14211C",
    "muted": "#65736D",
    "line": "#CBD8D2",
    "mint": "#47B995",
    "purple": "#7A68D8",
    "alert": "#D7795D",
}


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze extracted frames and build labeled visual-QA contact sheets."
    )
    parser.add_argument("--qa-dir", required=True, type=Path)
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = (
        [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
        ]
        if bold
        else [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
        ]
    )
    for candidate in names:
        if Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def format_time(second: float) -> str:
    whole = max(0, int(second))
    minute, remaining = divmod(whole, 60)
    milliseconds = int(round((second - int(second)) * 1000))
    if milliseconds == 1000:
        remaining += 1
        milliseconds = 0
    return f"{minute:02d}:{remaining:02d}.{milliseconds:03d}"


def scene_for_second(scenes: list[dict[str, Any]], second: float) -> str:
    for scene in scenes:
        if scene["startSecond"] <= second < scene["endSecond"]:
            return str(scene["id"])
    return str(scenes[-1]["id"])


def image_for(qa_dir: Path, sample: dict[str, Any]) -> Image.Image:
    path = qa_dir / sample["filename"]
    if not path.is_file():
        raise FileNotFoundError(f"Extracted frame is missing: {path}")
    return Image.open(path).convert("RGB")


def rgb_array(qa_dir: Path, sample: dict[str, Any]) -> np.ndarray:
    with image_for(qa_dir, sample) as image:
        return np.asarray(image, dtype=np.float32)


def luma(array: np.ndarray) -> np.ndarray:
    return array[..., 0] * 0.2126 + array[..., 1] * 0.7152 + array[..., 2] * 0.0722


def main_content_crop(array: np.ndarray) -> np.ndarray:
    height, width = array.shape[:2]
    left_n, top_n, right_n, bottom_n = THRESHOLDS["mainContentCropNormalized"]
    left = max(0, min(width - 1, round(width * left_n)))
    right = max(left + 1, min(width, round(width * right_n)))
    top = max(0, min(height - 1, round(height * top_n)))
    bottom = max(top + 1, min(height, round(height * bottom_n)))
    return array[top:bottom, left:right]


def region_metrics(array: np.ndarray) -> dict[str, float]:
    region_luma = luma(array)
    delta_x = np.abs(np.diff(region_luma, axis=1))
    delta_y = np.abs(np.diff(region_luma, axis=0))
    edge_count = float((delta_x > THRESHOLDS["edgeLumaDelta8Bit"]).sum())
    edge_count += float((delta_y > THRESHOLDS["edgeLumaDelta8Bit"]).sum())
    edge_total = max(1, delta_x.size + delta_y.size)

    height, width = array.shape[:2]
    corner_height = max(2, round(height * 0.1))
    corner_width = max(2, round(width * 0.1))
    corners = np.concatenate(
        [
            array[:corner_height, :corner_width].reshape(-1, 3),
            array[:corner_height, -corner_width:].reshape(-1, 3),
            array[-corner_height:, :corner_width].reshape(-1, 3),
            array[-corner_height:, -corner_width:].reshape(-1, 3),
        ],
        axis=0,
    )
    estimated_background = np.median(corners, axis=0)
    distance = np.linalg.norm(array - estimated_background, axis=2)
    return {
        "meanLuma": round(float(region_luma.mean()), 6),
        "stdLuma": round(float(region_luma.std()), 6),
        "blackPixelRatio": round(float((region_luma < 10).mean()), 8),
        "veryDarkPixelRatio": round(float((region_luma < 24).mean()), 8),
        "edgeDensity": round(edge_count / edge_total, 8),
        "foregroundRatio": round(
            float((distance > THRESHOLDS["foregroundRgbDistance8Bit"]).mean()), 8
        ),
    }


def difference_metrics(left: np.ndarray, right: np.ndarray) -> dict[str, float]:
    if left.shape != right.shape:
        raise ValueError(f"Frame shape mismatch: {left.shape} vs {right.shape}")
    absolute = np.abs(left - right)
    luma_delta = np.abs(luma(left) - luma(right))
    return {
        "meanAbsDiff8Bit": round(float(absolute.mean()), 8),
        "lumaMeanAbsDiff8Bit": round(float(luma_delta.mean()), 8),
        "changedPixelRatio": round(
            float((luma_delta > THRESHOLDS["changedPixelLumaDelta8Bit"]).mean()), 8
        ),
        "maximumChannelDelta8Bit": round(float(absolute.max()), 6),
    }


def sample_metrics(qa_dir: Path, sample: dict[str, Any], scenes: list[dict[str, Any]]) -> dict[str, Any]:
    array = rgb_array(qa_dir, sample)
    return {
        "frame": sample["frame"],
        "second": sample["second"],
        "sceneId": scene_for_second(scenes, sample["second"]),
        "filename": sample["filename"],
        "fullFrame": region_metrics(array),
        "mainContent": region_metrics(main_content_crop(array)),
    }


def build_pair_metrics(
    qa_dir: Path,
    samples: list[dict[str, Any]],
    scenes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    pairs: list[dict[str, Any]] = []
    previous_sample: dict[str, Any] | None = None
    previous_array: np.ndarray | None = None
    for sample in samples:
        current_array = rgb_array(qa_dir, sample)
        if previous_sample is not None and previous_array is not None:
            from_scene = scene_for_second(scenes, previous_sample["second"])
            to_scene = scene_for_second(scenes, sample["second"])
            full = difference_metrics(previous_array, current_array)
            main = difference_metrics(
                main_content_crop(previous_array), main_content_crop(current_array)
            )
            static_candidate = (
                from_scene == to_scene
                and main["meanAbsDiff8Bit"]
                <= THRESHOLDS["staticMainContentMeanAbsDiff8BitMaximum"]
                and main["changedPixelRatio"]
                <= THRESHOLDS["staticMainContentChangedPixelRatioMaximum"]
            )
            pairs.append(
                {
                    "fromFrame": previous_sample["frame"],
                    "toFrame": sample["frame"],
                    "fromSecond": previous_sample["second"],
                    "toSecond": sample["second"],
                    "fromSceneId": from_scene,
                    "toSceneId": to_scene,
                    "fullFrame": full,
                    "mainContent": main,
                    "staticCandidatePair": static_candidate,
                }
            )
        previous_sample = sample
        previous_array = current_array
    return pairs


def static_runs(pairs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []
    active: dict[str, Any] | None = None

    def finish() -> None:
        nonlocal active
        if active is None:
            return
        active["durationSeconds"] = round(active["endSecond"] - active["startSecond"], 6)
        if active["durationSeconds"] >= THRESHOLDS["staticMinimumRunSeconds"]:
            active["meanMainContentMad8Bit"] = round(
                statistics.fmean(active.pop("_mads")), 8
            )
            active["meanMainContentChangedPixelRatio"] = round(
                statistics.fmean(active.pop("_changed")), 8
            )
            runs.append(active)
        active = None

    for pair in pairs:
        if not pair["staticCandidatePair"]:
            finish()
            continue
        can_extend = (
            active is not None
            and active["sceneId"] == pair["fromSceneId"]
            and math.isclose(active["endSecond"], pair["fromSecond"], abs_tol=0.05)
        )
        if not can_extend:
            finish()
            active = {
                "sceneId": pair["fromSceneId"],
                "startFrame": pair["fromFrame"],
                "endFrame": pair["toFrame"],
                "startSecond": pair["fromSecond"],
                "endSecond": pair["toSecond"],
                "pairCount": 1,
                "_mads": [pair["mainContent"]["meanAbsDiff8Bit"]],
                "_changed": [pair["mainContent"]["changedPixelRatio"]],
            }
        else:
            active["endFrame"] = pair["toFrame"]
            active["endSecond"] = pair["toSecond"]
            active["pairCount"] += 1
            active["_mads"].append(pair["mainContent"]["meanAbsDiff8Bit"])
            active["_changed"].append(pair["mainContent"]["changedPixelRatio"])
    finish()
    return runs


def low_information_candidates(metrics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for item in metrics:
        main = item["mainContent"]
        if (
            main["stdLuma"] <= THRESHOLDS["lowInformationLumaStdMaximum"]
            and main["edgeDensity"] <= THRESHOLDS["lowInformationEdgeDensityMaximum"]
            and main["foregroundRatio"] <= THRESHOLDS["lowInformationForegroundRatioMaximum"]
        ):
            result.append(
                {
                    "frame": item["frame"],
                    "second": item["second"],
                    "sceneId": item["sceneId"],
                    "filename": item["filename"],
                    "mainContent": main,
                }
            )
    return result


def scene_summaries(
    scenes: list[dict[str, Any]],
    samples: list[dict[str, Any]],
    sample_stats: list[dict[str, Any]],
    pairs: list[dict[str, Any]],
    runs: list[dict[str, Any]],
    low_information: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    summaries = []
    for scene in scenes:
        scene_id = scene["id"]
        scene_samples = [item for item in sample_stats if item["sceneId"] == scene_id]
        scene_pairs = [
            item
            for item in pairs
            if item["fromSceneId"] == scene_id and item["toSceneId"] == scene_id
        ]
        mads = [item["mainContent"]["meanAbsDiff8Bit"] for item in scene_pairs]
        scene_runs = [item for item in runs if item["sceneId"] == scene_id]
        summaries.append(
            {
                "sceneId": scene_id,
                "startSecond": scene["startSecond"],
                "endSecond": scene["endSecond"],
                "periodicSampleCount": len(scene_samples),
                "periodicPairCount": len(scene_pairs),
                "mainContentMad8Bit": {
                    "minimum": round(min(mads), 8) if mads else None,
                    "median": round(statistics.median(mads), 8) if mads else None,
                    "maximum": round(max(mads), 8) if mads else None,
                },
                "longStaticCandidateCount": len(scene_runs),
                "longestStaticCandidateSeconds": max(
                    (item["durationSeconds"] for item in scene_runs), default=0
                ),
                "lowInformationSampleCount": sum(
                    1 for item in low_information if item["sceneId"] == scene_id
                ),
            }
        )
    return summaries


def tag_items(
    samples: Iterable[dict[str, Any]], prefix: str
) -> list[tuple[dict[str, Any], str]]:
    result = []
    for sample in samples:
        for tag in sample["tags"]:
            if tag.startswith(prefix):
                result.append((sample, tag))
    return result


def watermark_crop_hashes(
    qa_dir: Path,
    sample: dict[str, Any],
    crop_pixels: dict[str, int],
) -> dict[str, str]:
    left = int(crop_pixels["left"])
    top = int(crop_pixels["top"])
    width = int(crop_pixels["width"])
    height = int(crop_pixels["height"])
    if min(left, top) < 0 or min(width, height) <= 0:
        raise ValueError("Watermark crop geometry is invalid")
    with image_for(qa_dir, sample) as source:
        if left + width > source.width or top + height > source.height:
            raise ValueError("Watermark crop escapes the decoded frame")
        crop = source.crop((left, top, left + width, top + height))
        rgb_bytes = crop.tobytes()
        gray = np.asarray(
            crop.convert("L").resize((33, 32), Image.Resampling.LANCZOS),
            dtype=np.float32,
        )
    difference_bits = np.packbits(gray[:, 1:] > gray[:, :-1]).tobytes()
    return {
        "rgbSha256": hashlib.sha256(rgb_bytes).hexdigest(),
        "perceptualDhash32": difference_bits.hex(),
    }


def hexadecimal_hamming_distance(left: str, right: str) -> int:
    if len(left) != len(right):
        raise ValueError("Watermark perceptual hashes have different lengths")
    return (int(left, 16) ^ int(right, 16)).bit_count()


def analyze_watermark_continuous_motion(
    qa_dir: Path,
    frame_index: dict[str, Any],
) -> dict[str, Any]:
    cadence_id = frame_index.get("watermarkCadenceId")
    cycle_frames = int(frame_index.get("watermarkCycleInFrames", 0))
    offsets = frame_index.get("watermarkMotionSampleOffsetsInFrames", [])
    crop_pixels = frame_index.get("watermarkCropPixels")
    proof_contract = frame_index.get("watermarkMotionProof")
    if cadence_id != "continuous":
        raise ValueError("Formal watermark motion proof requires continuous cadence")
    if cycle_frames <= 0 or offsets[0:1] != [0] or offsets[-1:] != [cycle_frames]:
        raise ValueError("Watermark motion samples must include zero and the full-cycle return")
    if len(offsets) != len(set(offsets)) or offsets != sorted(offsets):
        raise ValueError("Watermark motion sample offsets must be sorted and unique")
    if not isinstance(crop_pixels, dict) or not isinstance(proof_contract, dict):
        raise ValueError("Watermark motion proof contract is incomplete")

    expected_chunks = int(frame_index.get("chunkCount", 0))
    chunk_frames = int(frame_index.get("chunkDurationInFrames", 0))
    tagged = tag_items(frame_index["fullSamples"], "watermark-motion-sample:")
    grouped: dict[str, dict[int, dict[str, Any]]] = {}
    for sample, tag in tagged:
        _, chunk_id, _, raw_offset = tag.split(":")
        offset = int(raw_offset)
        if offset in grouped.setdefault(chunk_id, {}):
            raise ValueError(f"Duplicate watermark motion sample: {chunk_id} offset {offset}")
        grouped[chunk_id][offset] = sample

    threshold = int(proof_contract["materialChangeDhashHammingMinimum"])
    return_maximum = int(proof_contract["cycleReturnDhashHammingMaximum"])
    minimum_distinct = int(proof_contract["minimumDistinctCropHashCount"])
    minimum_changed = int(proof_contract["minimumMateriallyChangedPhaseCount"])
    chunks = []
    for chunk_number in range(1, expected_chunks + 1):
        chunk_id = f"chunk-{chunk_number:02d}"
        samples_by_offset = grouped.get(chunk_id, {})
        if sorted(samples_by_offset) != offsets:
            raise ValueError(f"Watermark motion samples are incomplete for {chunk_id}")
        phase_samples = []
        expected_chunk_start = (chunk_number - 1) * chunk_frames
        for offset in offsets:
            sample = samples_by_offset[offset]
            if sample["frame"] != expected_chunk_start + offset:
                raise ValueError(f"Watermark motion sample frame is misbound for {chunk_id}")
            phase_samples.append(
                {
                    "offsetInFrames": offset,
                    "frame": sample["frame"],
                    "filename": sample["filename"],
                    **watermark_crop_hashes(qa_dir, sample, crop_pixels),
                }
            )
        anchor_hash = phase_samples[0]["perceptualDhash32"]
        for phase_sample in phase_samples:
            phase_sample["anchorDhashHammingDistance"] = hexadecimal_hamming_distance(
                anchor_hash, phase_sample["perceptualDhash32"]
            )
        distinct_crop_hash_count = len(
            {sample["rgbSha256"] for sample in phase_samples}
        )
        materially_changed_phase_count = sum(
            1
            for sample in phase_samples[1:-1]
            if sample["anchorDhashHammingDistance"] >= threshold
        )
        return_distance = phase_samples[-1]["anchorDhashHammingDistance"]
        checks = {
            "multipleDecodedCropHashesChanged":
                distinct_crop_hash_count >= minimum_distinct,
            "multipleMaterialMotionPhasesDetected":
                materially_changed_phase_count >= minimum_changed,
            "fullCycleReturned": return_distance <= return_maximum,
        }
        chunks.append(
            {
                "chunkId": chunk_id,
                "startFrame": expected_chunk_start,
                "distinctCropHashCount": distinct_crop_hash_count,
                "materiallyChangedPhaseCount": materially_changed_phase_count,
                "cycleReturnDhashHammingDistance": return_distance,
                "checks": checks,
                "status": "pass" if all(checks.values()) else "fail",
                "samples": phase_samples,
            }
        )

    checks = {
        "continuousCadenceDeclared": cadence_id == "continuous",
        "allChunksSampled": len(chunks) == expected_chunks,
        "multipleDecodedCropHashesChanged": all(
            chunk["checks"]["multipleDecodedCropHashesChanged"] for chunk in chunks
        ),
        "multipleMaterialMotionPhasesDetected": all(
            chunk["checks"]["multipleMaterialMotionPhasesDetected"] for chunk in chunks
        ),
        "fullCycleReturned": all(
            chunk["checks"]["fullCycleReturned"] for chunk in chunks
        ),
    }
    return {
        "schemaVersion": proof_contract["schemaVersion"],
        "status": "pass" if all(checks.values()) else "fail",
        "cadenceId": cadence_id,
        "cycleInFrames": cycle_frames,
        "sampleOffsetsInFrames": offsets,
        "cropPixels": crop_pixels,
        "hashAlgorithm": "decoded-rgb-sha256-and-32x32-dhash",
        "thresholds": {
            "minimumDistinctCropHashCount": minimum_distinct,
            "minimumMateriallyChangedPhaseCount": minimum_changed,
            "materialChangeDhashHammingMinimum": threshold,
            "cycleReturnDhashHammingMaximum": return_maximum,
        },
        "checks": checks,
        "chunks": chunks,
    }


def labeled_contact_sheet(
    qa_dir: Path,
    items: list[tuple[dict[str, Any], str]],
    output_name: str,
    title: str,
    columns: int,
    thumb_size: tuple[int, int],
    empty_note: str | None = None,
    crop_box_normalized: tuple[float, float, float, float] | None = None,
) -> None:
    output_path = qa_dir / output_name
    title_height = 72
    label_height = 48
    gap = 10
    margin = 22
    if not items:
        canvas = Image.new("RGB", (1280, 360), PALETTE["canvas"])
        draw = ImageDraw.Draw(canvas)
        draw.text((40, 42), title, fill=PALETTE["ink"], font=font(30, bold=True))
        draw.text(
            (40, 130),
            empty_note or "No automated candidates.",
            fill=PALETTE["muted"],
            font=font(23),
        )
        canvas.save(output_path, optimize=True)
        return

    rows = math.ceil(len(items) / columns)
    width = margin * 2 + columns * thumb_size[0] + (columns - 1) * gap
    height = margin * 2 + title_height + rows * (thumb_size[1] + label_height) + (rows - 1) * gap
    canvas = Image.new("RGB", (width, height), PALETTE["canvas"])
    draw = ImageDraw.Draw(canvas)
    draw.text((margin, margin), title, fill=PALETTE["ink"], font=font(28, bold=True))
    draw.line(
        (margin, margin + 50, width - margin, margin + 50),
        fill=PALETTE["mint"],
        width=3,
    )
    for position, (sample, label) in enumerate(items):
        column = position % columns
        row = position // columns
        x = margin + column * (thumb_size[0] + gap)
        y = margin + title_height + row * (thumb_size[1] + label_height + gap)
        with image_for(qa_dir, sample) as source:
            if crop_box_normalized is not None:
                left, top, right, bottom = crop_box_normalized
                source = source.crop(
                    (
                        round(source.width * left),
                        round(source.height * top),
                        round(source.width * right),
                        round(source.height * bottom),
                    )
                )
            thumbnail = ImageOps.fit(
                source,
                thumb_size,
                method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.5),
            )
        canvas.paste(thumbnail, (x, y))
        draw.rectangle(
            (x, y + thumb_size[1], x + thumb_size[0], y + thumb_size[1] + label_height),
            fill=PALETTE["panel"],
            outline=PALETTE["line"],
            width=1,
        )
        draw.text(
            (x + 9, y + thumb_size[1] + 10),
            label[:58],
            fill=PALETTE["ink"],
            font=font(17),
        )
    canvas.save(output_path, optimize=True)


def build_contact_sheets(
    qa_dir: Path,
    frame_index: dict[str, Any],
    runs: list[dict[str, Any]],
    low_information: list[dict[str, Any]],
) -> list[str]:
    full_samples = frame_index["fullSamples"]
    periodic_samples = frame_index["periodicSamples"]
    outputs: list[str] = []

    representatives = []
    for sample, tag in tag_items(full_samples, "representative:"):
        scene_id = tag.split(":", 1)[1]
        representatives.append(
            (sample, f"{scene_id}  ·  {format_time(sample['second'])}  ·  frame {sample['frame']}")
        )
    representatives.sort(key=lambda pair: pair[0]["frame"])
    labeled_contact_sheet(
        qa_dir,
        representatives,
        "contact-scenes-overview.png",
        "18-SCENE REPRESENTATIVE FRAME OVERVIEW",
        columns=3,
        thumb_size=(480, 270),
    )
    outputs.append("contact-scenes-overview.png")

    title_offsets = frame_index.get("titleFirstOffsetsInFrames", [])
    if title_offsets:
        title_items = []
        for sample, tag in tag_items(full_samples, "title-first:"):
            _, scene_id, _, offset = tag.split(":")
            title_items.append(
                (
                    sample,
                    f"{scene_id} · {int(offset):+d}f · {format_time(sample['second'])}",
                )
            )
        title_items.sort(key=lambda pair: pair[0]["frame"])
        title_frames_per_scene = len(title_offsets)
        title_chunk_size = 6 * title_frames_per_scene
        for part, start in enumerate(
            range(0, len(title_items), title_chunk_size), start=1
        ):
            name = f"contact-title-first-{part:02d}.png"
            labeled_contact_sheet(
                qa_dir,
                title_items[start : start + title_chunk_size],
                name,
                f"TITLE-FIRST ENTRANCE ORDER · PART {part:02d}",
                columns=title_frames_per_scene,
                thumb_size=(300, 169),
            )
            outputs.append(name)

    boundary_items = []
    for sample, tag in tag_items(full_samples, "boundary:"):
        _, transition, _, offset = tag.split(":")
        boundary_items.append(
            (
                sample,
                f"{transition.replace('>', '→')}  ·  {int(offset):+d}f  ·  {format_time(sample['second'])}",
            )
        )
    boundary_items.sort(key=lambda pair: pair[0]["frame"])
    transitions_per_sheet = 6
    frames_per_transition = len(frame_index["boundaryOffsetsInFrames"])
    chunk_size = transitions_per_sheet * frames_per_transition
    for part, start in enumerate(range(0, len(boundary_items), chunk_size), start=1):
        name = f"contact-scene-boundaries-{part:02d}.png"
        labeled_contact_sheet(
            qa_dir,
            boundary_items[start : start + chunk_size],
            name,
            f"SCENE TRANSITION FRAMES · PART {part:02d}",
            columns=frames_per_transition,
            thumb_size=(300, 169),
        )
        outputs.append(name)

    chunk_offsets = frame_index.get("chunkSeamOffsetsInFrames", [])
    if chunk_offsets:
        chunk_items = []
        for sample, tag in tag_items(full_samples, "chunk-seam:"):
            _, transition, _, offset = tag.split(":")
            chunk_items.append(
                (
                    sample,
                    f"chunk {transition.replace('>', '→')} · {int(offset):+d}f · {format_time(sample['second'])}",
                )
            )
        chunk_items.sort(key=lambda pair: pair[0]["frame"])
        chunk_frames_per_seam = len(chunk_offsets)
        chunk_sheet_size = 4 * chunk_frames_per_seam
        for part, start in enumerate(
            range(0, len(chunk_items), chunk_sheet_size), start=1
        ):
            name = f"contact-chunk-seams-{part:02d}.png"
            labeled_contact_sheet(
                qa_dir,
                chunk_items[start : start + chunk_sheet_size],
                name,
                f"20-CHUNK CONCAT SEAMS · PART {part:02d}",
                columns=chunk_frames_per_seam,
                thumb_size=(300, 169),
            )
            outputs.append(name)

    final_tail_offsets = frame_index.get("finalTailOffsetsInFrames", [])
    if final_tail_offsets:
        final_tail_items = []
        for sample, tag in tag_items(full_samples, "final-tail:"):
            _, _, offset = tag.split(":")
            final_tail_items.append(
                (sample, f"tail {int(offset):+d}f · {format_time(sample['second'])}")
            )
        final_tail_items.sort(key=lambda pair: pair[0]["frame"])
        labeled_contact_sheet(
            qa_dir,
            final_tail_items,
            "contact-final-tail.png",
            "FINAL TAIL · LAST FOUR SECONDS",
            columns=len(final_tail_offsets),
            thumb_size=(300, 169),
        )
        outputs.append("contact-final-tail.png")

    periodic_overview = []
    for sample in periodic_samples:
        rounded_second = round(sample["second"])
        if rounded_second % 20 == 0 or sample is periodic_samples[-1]:
            scene_id = scene_for_second(frame_index["scenes"], sample["second"])
            periodic_overview.append(
                (sample, f"{scene_id}  ·  {format_time(sample['second'])}")
            )
    labeled_contact_sheet(
        qa_dir,
        periodic_overview,
        "contact-periodic-overview.png",
        "FULL-VIDEO RHYTHM OVERVIEW · 20-SECOND INTERVAL",
        columns=5,
        thumb_size=(288, 162),
    )
    outputs.append("contact-periodic-overview.png")

    if frame_index.get("expectedPeriodicSampleCount"):
        periodic_items = [
            (
                sample,
                f"{scene_for_second(frame_index['scenes'], sample['second'])} · {format_time(sample['second'])}",
            )
            for sample in periodic_samples
        ]
        periodic_per_sheet = 30
        for part, start in enumerate(
            range(0, len(periodic_items), periodic_per_sheet), start=1
        ):
            name = f"contact-periodic-2s-{part:02d}.png"
            labeled_contact_sheet(
                qa_dir,
                periodic_items[start : start + periodic_per_sheet],
                name,
                f"FULL VIDEO · EVERY 2 SECONDS · PART {part:02d}",
                columns=6,
                thumb_size=(240, 135),
            )
            outputs.append(name)

    watermark_offsets = frame_index.get("watermarkMotionSampleOffsetsInFrames", [])
    if watermark_offsets:
        watermark_items = []
        for sample, tag in tag_items(full_samples, "watermark-motion-sample:"):
            _, chunk_id, _, offset = tag.split(":")
            watermark_items.append(
                (
                    sample,
                    f"{chunk_id} · offset {int(offset):03d}f · {format_time(sample['second'])}",
                )
            )
        watermark_items.sort(key=lambda pair: pair[0]["frame"])
        watermark_sheet_size = 4 * len(watermark_offsets)
        for part, start in enumerate(
            range(0, len(watermark_items), watermark_sheet_size), start=1
        ):
            name = f"contact-watermark-motion-{part:02d}.png"
            labeled_contact_sheet(
                qa_dir,
                watermark_items[start : start + watermark_sheet_size],
                name,
                f"TOP-RIGHT v013 WATERMARK · CONTINUOUS MOTION PROOF · PART {part:02d}",
                columns=len(watermark_offsets),
                thumb_size=(260, 260),
                crop_box_normalized=(1740 / 1920, 20 / 1080, 1900 / 1920, 180 / 1080),
            )
            outputs.append(name)

    periodic_by_frame = {item["frame"]: item for item in periodic_samples}
    static_frames: dict[int, tuple[dict[str, Any], str]] = {}
    for run in runs:
        middle_frame = round((run["startFrame"] + run["endFrame"]) / 2)
        nearest_middle = min(
            periodic_samples,
            key=lambda item: abs(item["frame"] - middle_frame),
        )["frame"]
        for role, frame_value in [
            ("start", run["startFrame"]),
            ("middle", nearest_middle),
            ("end", run["endFrame"]),
        ]:
            sample = periodic_by_frame.get(frame_value)
            if sample is None:
                continue
            static_frames[frame_value] = (
                sample,
                f"{run['sceneId']} {role} · {format_time(sample['second'])} · run {run['durationSeconds']:.1f}s",
            )
    static_items = [static_frames[key] for key in sorted(static_frames)][:36]
    labeled_contact_sheet(
        qa_dir,
        static_items,
        "contact-static-candidates.png",
        "AUTOMATED LONG-STATIC CANDIDATES · MANUAL REVIEW REQUIRED",
        columns=4,
        thumb_size=(320, 180),
        empty_note="No long-static run crossed the automated threshold. Manual pacing review is still required.",
    )
    outputs.append("contact-static-candidates.png")

    low_info_items = []
    for candidate in low_information[:36]:
        sample = periodic_by_frame[candidate["frame"]]
        low_info_items.append(
            (
                sample,
                f"{candidate['sceneId']} · {format_time(candidate['second'])} · edge {candidate['mainContent']['edgeDensity']:.4f}",
            )
        )
    labeled_contact_sheet(
        qa_dir,
        low_info_items,
        "contact-low-information-candidates.png",
        "AUTOMATED LOW-INFORMATION CANDIDATES · MANUAL REVIEW REQUIRED",
        columns=4,
        thumb_size=(320, 180),
        empty_note="No sample crossed the automated low-information threshold. Manual information-density review is still required.",
    )
    outputs.append("contact-low-information-candidates.png")
    return outputs


def build_summary(
    media_metadata: dict[str, Any],
    frame_index: dict[str, Any],
    layer_dropout_analysis: dict[str, Any],
    metrics: dict[str, Any],
    watermark_motion_proof: dict[str, Any] | None,
    contact_sheets: list[str],
    write_scope: str,
    candidate_version: int,
    generic_contract: bool,
) -> dict[str, Any]:
    media_failures = [
        check_id
        for check_id, passed in media_metadata["checks"].items()
        if not passed
    ]
    static_runs_ = metrics["automatedCandidates"]["longStaticRuns"]
    low_information = metrics["automatedCandidates"]["lowInformationSamples"]
    automated_findings = []
    for check_id in media_failures:
        automated_findings.append(
            {
                "severity": "blocking",
                "category": "media-contract",
                "id": check_id,
                "message": f"Encoded media does not satisfy expected check: {check_id}",
            }
        )
    blocking_layer_dropout_count = int(layer_dropout_analysis["blockingEventCount"])
    informational_layer_dropout_count = int(
        layer_dropout_analysis["informationalEventCount"]
    )
    watermark_motion_failed = (
        watermark_motion_proof is not None
        and watermark_motion_proof.get("status") != "pass"
    )
    if watermark_motion_failed:
        automated_findings.append(
            {
                "severity": "blocking",
                "category": "watermark-motion",
                "id": "continuous-watermark-motion-proof",
                "message": (
                    "Decoded watermark crops did not prove multiple material motion phases "
                    "and a full 120-frame cycle return."
                ),
            }
        )
    if blocking_layer_dropout_count:
        first_frames = [
            str(event["frameB"])
            for event in layer_dropout_analysis.get("blockingEvents", [])[:12]
        ]
        suffix = f" First center frames: {', '.join(first_frames)}." if first_frames else ""
        automated_findings.append(
            {
                "severity": "blocking",
                "category": "single-frame-layer-dropout",
                "id": "single-frame-aba-layer-dropout",
                "message": (
                    f"{blocking_layer_dropout_count} non-boundary single-frame A-B-A "
                    f"layer-dropout triples crossed the gate.{suffix}"
                ),
            }
        )
    if informational_layer_dropout_count:
        automated_findings.append(
            {
                "severity": "info",
                "category": "scene-boundary",
                "id": "single-frame-aba-boundary-information",
                "message": (
                    f"{informational_layer_dropout_count} single-frame A-B-A layer-dropout "
                    "triples occurred within +/-8 frames "
                    "of a scene boundary; these are recorded for review and do not fail the gate."
                ),
            }
        )
    for run in static_runs_:
        automated_findings.append(
            {
                "severity": "review",
                "category": "pacing",
                "id": f"long-static-{run['sceneId']}-{run['startFrame']}",
                "sceneId": run["sceneId"],
                "startSecond": run["startSecond"],
                "endSecond": run["endSecond"],
                "message": (
                    f"Main content has an automated low-motion run of {run['durationSeconds']:.1f}s; "
                    "confirm whether the hold is intentional."
                ),
            }
        )
    if low_information:
        scenes = sorted({item["sceneId"] for item in low_information})
        automated_findings.append(
            {
                "severity": "review",
                "category": "information-density",
                "id": "low-information-samples",
                "sceneIds": scenes,
                "sampleCount": len(low_information),
                "message": (
                    f"{len(low_information)} periodic samples crossed the conservative low-information "
                    "threshold; inspect the candidate contact sheet rather than treating this as a verdict."
                ),
            }
        )

    manual_categories = [
        (
            "composition",
            "构图与视觉焦点",
            "检查场景自适应构图、视窗利用、单一视觉焦点、卡片与文字比例。",
        ),
        (
            "text-clipping",
            "文字裁切与可读性",
            "逐场景检查标题、正文、节点和标签是否溢出、过小或行距失衡。",
        ),
        (
            "caption-safe-area",
            "字幕安全区",
            "检查纯黑字幕是否平稳、最多两行，并与底部章节进度条及画面主体保持安全距离。",
        ),
        *(
            [
                (
                    "title-first",
                    "标题先于正文与字幕",
                    "逐场景检查入场前两秒：大标题应先建立层级，小字、正文和字幕不能抢先出现。",
                ),
                (
                    "icons-illustrations",
                    "图标与图案表达",
                    "检查图标是否独立展示、语义对应、比例克制；卡片文本内不应逐项附图标，插画必须帮助理解。",
                ),
                (
                    "cards-connectors",
                    "卡片边框与连接线",
                    "检查同一组卡片边界一致、文字不溢出，箭头只走横竖和直角转弯且关系清楚。",
                ),
            ]
            if frame_index.get("titleFirstOffsetsInFrames")
            else []
        ),
        (
            "visual-consistency",
            "视觉一致性",
            "检查雾白画布、薄荷主色/紫色辅色、平面默认、圆角、线条、AI 水印与组件层级。",
        ),
        (
            "transitions",
            "场景与分段连续性",
            (
                "检查 17 个场景边界和 19 个分段拼接点的空白闪帧、双重曝光、跳变、断线和不合理停顿。"
                if frame_index.get("chunkSeamCount")
                else "检查 17 个场景边界的空白闪帧、双重曝光、跳变、断线和不合理停顿。"
            ),
        ),
        (
            "rhythm",
            "节奏与信息密度",
            "结合全片 20 秒概览和 2 秒帧差指标，检查长时间静止或低信息画面。",
        ),
        (
            "brand-aesthetic",
            "审美与品牌感",
            "按克制、轻薄、统一、专业、非模板化的标准检查层级、留白和强调方式。",
        ),
        *(
            [
                (
                    "watermark-continuity",
                    "动态水印连续性",
                    "复核机器门禁并检查右上角 v013 水印全片持续转动、尺寸一致，没有在场景或分段边界突然消失或变小。",
                ),
                (
                    "continuous-watch",
                    "实际 MP4 1× 连续观看",
                    "从头到尾以 1× 播放完整 10 分钟 MP4，检查图像、配音、字幕同步和联系表无法覆盖的动态问题。",
                ),
            ]
            if frame_index.get("watermarkMotionSampleOffsetsInFrames")
            else []
        ),
    ]
    return {
        "schemaVersion": (
            "agent-skill-long-review-qa-summary-v1"
            if generic_contract
            else "agent-skill-long-review-wide-v004-qa-summary-v1"
        ),
        "candidateVersion": candidate_version,
        "candidate": {
            "video": media_metadata["source"]["video"],
            "manifest": media_metadata["source"]["manifest"],
            "registered": False,
            "approvalStatus": "not_approved",
        },
        "status": (
            "blocking_media_issue"
            if media_failures
            else (
                "blocking_visual_integrity_issue"
                if blocking_layer_dropout_count or watermark_motion_failed
                else "pending_manual_visual_review"
            )
        ),
        "coverage": {
            "sceneCount": len(frame_index["scenes"]),
            "representativeFrameCount": frame_index["representativeFrameCount"],
            "sceneTransitionCount": frame_index["boundaryTransitionCount"],
            "boundaryOffsetsInFrames": frame_index["boundaryOffsetsInFrames"],
            "periodicIntervalSeconds": frame_index["periodicIntervalSeconds"],
            "periodicSampleCount": len(frame_index["periodicSamples"]),
            **(
                {
                    "titleFirstSceneCount": frame_index["titleFirstSceneCount"],
                    "titleFirstOffsetsInFrames": frame_index["titleFirstOffsetsInFrames"],
                    "chunkCount": frame_index["chunkCount"],
                    "chunkSeamCount": frame_index["chunkSeamCount"],
                    "chunkSeamOffsetsInFrames": frame_index["chunkSeamOffsetsInFrames"],
                    "watermarkCadenceId": frame_index["watermarkCadenceId"],
                    "watermarkCycleInFrames": frame_index["watermarkCycleInFrames"],
                    "watermarkMotionSampleOffsetsInFrames": frame_index[
                        "watermarkMotionSampleOffsetsInFrames"
                    ],
                    "finalTailOffsetsInFrames": frame_index["finalTailOffsetsInFrames"],
                    "fullResolutionSampleCount": len(frame_index["fullSamples"]),
                    "totalEvidenceFrameCount": (
                        len(frame_index["fullSamples"])
                        + len(frame_index["periodicSamples"])
                    ),
                    "contactSheetCount": len(contact_sheets),
                }
                if frame_index.get("titleFirstOffsetsInFrames")
                else {}
            ),
        },
        "automatedChecks": {
            "media": {
                "status": media_metadata["status"],
                "checks": media_metadata["checks"],
            },
            "longStaticCandidateCount": len(static_runs_),
            "lowInformationSampleCount": len(low_information),
            "singleFrameAbaLayerDropout": {
                "status": layer_dropout_analysis["status"],
                "detectorScope": layer_dropout_analysis["detectorScope"],
                "analyzedTripleCount": layer_dropout_analysis["analyzedTripleCount"],
                "blockingEventCount": blocking_layer_dropout_count,
                "informationalEventCount": informational_layer_dropout_count,
                "automaticFrameRepairAttempted": False,
                "boundaryPolicy": layer_dropout_analysis["boundaryPolicy"],
                "knownLimitations": layer_dropout_analysis["knownLimitations"],
                "evidencePlanArtifact":
                    "single-frame-aba-layer-dropout-evidence-plan.json",
            },
            **(
                {
                    "watermarkContinuousMotion": {
                        "status": watermark_motion_proof["status"],
                        "artifact": "watermark-motion-proof.json",
                        "cadenceId": watermark_motion_proof["cadenceId"],
                        "chunkCount": len(watermark_motion_proof["chunks"]),
                        "checks": watermark_motion_proof["checks"],
                    }
                }
                if watermark_motion_proof is not None
                else {}
            ),
            "findings": automated_findings,
            "interpretationBoundary": (
                "Frame metrics are candidate detectors only. They cannot approve composition, typography, "
                "caption safety, brand consistency, transitions, or pacing without visual review."
            ),
        },
        "manualReview": {
            "status": "pending",
            "categories": [
                {
                    "id": category_id,
                    "label": label,
                    "status": "pending",
                    "scope": scope,
                    "issues": [],
                    "notes": "",
                }
                for category_id, label, scope in manual_categories
            ],
        },
        "contactSheets": contact_sheets,
        "sourceMutation": False,
        "writeScope": write_scope,
    }


def markdown_report(summary: dict[str, Any], metrics: dict[str, Any]) -> str:
    coverage = summary["coverage"]
    findings = summary["automatedChecks"]["findings"]
    status_line = (
        "> 状态：发现自动阻断项，仍待人工视觉审查。本文件不代表视觉批准。"
        if summary["status"] == "blocking_visual_integrity_issue"
        else "> 状态：待人工视觉审查。本文件是问题记录模板，不代表视觉批准。"
    )
    lines = [
        f"# 横版完整视频 v{summary['candidateVersion']:03d} · 视觉 QA 报告",
        "",
        status_line,
        "",
        "## 覆盖范围",
        "",
        f"- 场景代表帧：{coverage['representativeFrameCount']}/{coverage['sceneCount']}",
        f"- 场景转场：{coverage['sceneTransitionCount']} 个，每个采样 {len(coverage['boundaryOffsetsInFrames'])} 帧位置",
        f"- 节奏采样：每 {coverage['periodicIntervalSeconds']} 秒一次，共 {coverage['periodicSampleCount']} 张",
        *(
            [
                f"- 标题优先：{coverage['titleFirstSceneCount']} 场，每场 {len(coverage['titleFirstOffsetsInFrames'])} 个入场帧",
                f"- 30 秒分段拼接：{coverage['chunkSeamCount']} 个，每个采样 {len(coverage['chunkSeamOffsetsInFrames'])} 帧位置",
                f"- 动态水印：{coverage['chunkCount']} 段，每段 {len(coverage['watermarkMotionSampleOffsetsInFrames'])} 个运动/回返样本；机器门禁见 `watermark-motion-proof.json`",
                f"- 精确证据帧：全分辨率 {coverage['fullResolutionSampleCount']} + 周期 {coverage['periodicSampleCount']} = {coverage['totalEvidenceFrameCount']}",
                f"- 联系表：{coverage['contactSheetCount']} 张；仍需连续 1× 观看实际 MP4",
            ]
            if "titleFirstSceneCount" in coverage
            else []
        ),
        (
            "- 单帧 A-B-A layer-dropout：连续扫描 "
            f"{summary['automatedChecks']['singleFrameAbaLayerDropout']['analyzedTripleCount']} 个三帧窗口；"
            f"阻断 {summary['automatedChecks']['singleFrameAbaLayerDropout']['blockingEventCount']}，"
            f"场景边界信息 {summary['automatedChecks']['singleFrameAbaLayerDropout']['informationalEventCount']}"
        ),
        "- 单帧丢层人工核对清单：`single-frame-aba-layer-dropout-evidence-plan.json`（精确 A/B/C 帧号）",
        "- 自动指标：媒体元数据、主内容区帧差、低信息候选；自动指标只负责提示，不负责审美判定",
        "",
        "## 自动发现",
        "",
    ]
    if not findings:
        lines.append("- 未发现媒体契约阻断项，也没有样本跨过保守的静止/低信息阈值；仍需完成人工视觉审查。")
    else:
        for finding in findings:
            location = ""
            if finding.get("sceneId"):
                location = f" · {finding['sceneId']}"
            if finding.get("sceneIds"):
                location = f" · {', '.join(finding['sceneIds'])}"
            lines.append(
                f"- **{finding['severity'].upper()} · {finding['category']}**{location}：{finding['message']}"
            )
    lines.extend(
        [
            "",
            "## 人工视觉检查（待填写）",
            "",
            "| 检查项 | 状态 | 问题与证据帧 |",
            "|---|---|---|",
        ]
    )
    for category in summary["manualReview"]["categories"]:
        lines.append(f"| {category['label']} | 待检查 |  |")
    lines.extend(
        [
            "",
            "## 场景节奏索引",
            "",
            "| 场景 | 周期样本 | 主内容帧差中位数 | 最长静止候选 | 低信息样本 |",
            "|---|---:|---:|---:|---:|",
        ]
    )
    for scene in metrics["sceneSummaries"]:
        median = scene["mainContentMad8Bit"]["median"]
        median_text = "—" if median is None else f"{median:.4f}"
        lines.append(
            f"| {scene['sceneId']} | {scene['periodicSampleCount']} | {median_text} | "
            f"{scene['longestStaticCandidateSeconds']:.1f}s | {scene['lowInformationSampleCount']} |"
        )
    lines.extend(
        [
            "",
            "## 联系表",
            "",
        ]
    )
    for sheet in summary["contactSheets"]:
        lines.append(f"- `{sheet}`")
    lines.extend(
        [
            "",
            "## 审查边界",
            "",
            "- 本次 QA 不修改视频代码、不覆盖候选 MP4、不更新正式批准状态。",
            "- 单帧 A-B-A layer-dropout 检测扫描整张解码灰度帧，包含水印和字幕区域；不尝试自动补帧或替换候选视频。",
            "- 只有独立的 2 秒周期静止/低信息指标采用主内容裁切，以减少水印和字幕对该指标的影响。",
            "- A-B-B-A 及更长缺失属于已知边界：相同像素序列也可能是刻意的多帧脉冲，当前门禁不做语义不可靠的扩大判断。",
            "- 播放器、显示链路或图片预览中的合成异常若不存在于解码像素中，本门禁无法检测。",
            "- 文字裁切和字幕安全区没有可靠 OCR 自动结论，必须查看代表帧和边界联系表。",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    args = parse_arguments()
    qa_dir = args.qa_dir.resolve()
    if not qa_dir.is_dir():
        raise FileNotFoundError(f"QA directory is missing: {qa_dir}")
    frame_index = read_json(qa_dir / "frame-index.json")
    media_metadata = read_json(qa_dir / "media-metadata.json")
    layer_dropout_analysis = read_json(
        qa_dir / "single-frame-aba-layer-dropout.json"
    )
    layer_dropout_evidence = read_json(
        qa_dir / "single-frame-aba-layer-dropout-evidence-plan.json"
    )
    run_manifest = read_json(qa_dir / "run-manifest.json")
    candidate_version = run_manifest.get("contract", {}).get("candidateVersion")
    if not isinstance(candidate_version, int) or candidate_version < 1:
        raise ValueError("QA run manifest is missing a positive candidateVersion")
    generic_contract = run_manifest.get("schemaVersion") != LEGACY_QA_SCHEMA_VERSION
    if len(frame_index.get("scenes", [])) != 18:
        raise ValueError("The long-review QA contract requires exactly 18 scenes")
    if frame_index.get("representativeFrameCount") != 18:
        raise ValueError("Representative-frame coverage is incomplete")
    if frame_index.get("boundaryTransitionCount") != 17:
        raise ValueError("Scene-transition coverage is incomplete")
    if frame_index.get("titleFirstOffsetsInFrames"):
        if frame_index.get("titleFirstSceneCount") != 18:
            raise ValueError("Title-first scene coverage is incomplete")
        if frame_index.get("chunkCount") != 20 or frame_index.get("chunkSeamCount") != 19:
            raise ValueError("20-chunk seam coverage is incomplete")
        if frame_index.get("watermarkCycleInFrames") != 120:
            raise ValueError("Watermark cycle coverage is not bound to 120 frames")
        if frame_index.get("watermarkCadenceId") != "continuous":
            raise ValueError("Formal v004b watermark cadence must be continuous")
        if frame_index.get("extractionMode") != "batched-sequential-decode-no-seek":
            raise ValueError("Formal v004b extraction mode is not sequential/no-seek")
        if frame_index.get("sequentialExtractionBatchSize") != 24:
            raise ValueError("Formal v004b extraction batch size must be 24")
        full_sample_count = len(frame_index.get("fullSamples", []))
        periodic_sample_count = len(frame_index.get("periodicSamples", []))
        if full_sample_count != 441 or periodic_sample_count != 301:
            raise ValueError("Formal v004b evidence must contain 441 + 301 frames")
        if full_sample_count + periodic_sample_count != 742:
            raise ValueError("Formal v004b evidence total must be 742 frames")
    if layer_dropout_analysis.get("candidateVersion") != candidate_version:
        raise ValueError("Single-frame A-B-A layer-dropout candidateVersion is not bound")
    if layer_dropout_analysis.get("automaticFrameRepairAttempted") is not False:
        raise ValueError("Single-frame A-B-A layer-dropout analysis must remain read-only")
    expected_frame_count = frame_index.get("durationInFrames")
    if layer_dropout_analysis.get("frameCount") != expected_frame_count:
        raise ValueError("Single-frame A-B-A layer-dropout frame coverage is incomplete")
    if layer_dropout_analysis.get("analyzedTripleCount") != max(0, expected_frame_count - 2):
        raise ValueError("Single-frame A-B-A layer-dropout triple coverage is incomplete")
    expected_layer_dropout_status = (
        "fail"
        if layer_dropout_analysis.get("blockingEventCount", 0) > 0
        else "pass"
    )
    if layer_dropout_analysis.get("status") != expected_layer_dropout_status:
        raise ValueError("Single-frame A-B-A layer-dropout status is inconsistent")
    if layer_dropout_analysis.get("sourceVideo") != media_metadata.get("source", {}).get("video"):
        raise ValueError("Single-frame A-B-A layer-dropout source video is not bound")
    if layer_dropout_evidence.get("candidateVersion") != candidate_version:
        raise ValueError("Single-frame A-B-A layer-dropout evidence candidateVersion is not bound")
    if layer_dropout_evidence.get("sourceVideo") != media_metadata.get("source", {}).get("video"):
        raise ValueError("Single-frame A-B-A layer-dropout evidence source video is not bound")
    if layer_dropout_evidence.get("totalBlockingEventCount") != layer_dropout_analysis.get("blockingEventCount"):
        raise ValueError("Single-frame A-B-A layer-dropout evidence count is inconsistent")

    watermark_motion_proof = None
    if frame_index.get("watermarkCadenceId") is not None:
        watermark_motion_proof = {
            **analyze_watermark_continuous_motion(qa_dir, frame_index),
            "candidateVersion": candidate_version,
            "sourceVideo": media_metadata.get("source", {}).get("video"),
        }
        write_json(qa_dir / "watermark-motion-proof.json", watermark_motion_proof)

    periodic_samples = frame_index["periodicSamples"]
    sample_stats = [
        sample_metrics(qa_dir, sample, frame_index["scenes"])
        for sample in periodic_samples
    ]
    pairs = build_pair_metrics(qa_dir, periodic_samples, frame_index["scenes"])
    runs = static_runs(pairs)
    low_information = low_information_candidates(sample_stats)
    summaries = scene_summaries(
        frame_index["scenes"],
        periodic_samples,
        sample_stats,
        pairs,
        runs,
        low_information,
    )
    metrics = {
        "schemaVersion": (
            "agent-skill-long-review-frame-analysis-v1"
            if generic_contract
            else "agent-skill-long-review-wide-v004-frame-analysis-v1"
        ),
        "candidateVersion": candidate_version,
        "source": {
            "video": frame_index["sourceVideo"],
            "periodicSampleCount": len(periodic_samples),
            "periodicPairCount": len(pairs),
        },
        "thresholds": THRESHOLDS,
        "samplingBoundary": (
            "Periodic-only metric images are downscaled to 480 px width. For those metrics only, "
            "the main-content crop excludes the top-right watermark edge and bottom caption/progress "
            "region. The full-frame A-B-A layer-dropout scan does not crop either region. Metrics are "
            "review signals, not approvals."
        ),
        "periodicSamples": sample_stats,
        "periodicFrameDifferences": pairs,
        "sceneSummaries": summaries,
        "automatedCandidates": {
            "longStaticRuns": runs,
            "lowInformationSamples": low_information,
        },
    }
    write_json(qa_dir / "frame-metrics.json", metrics)
    contact_sheets = build_contact_sheets(qa_dir, frame_index, runs, low_information)
    expected_contact_sheet_count = frame_index.get("expectedContactSheetCount")
    if expected_contact_sheet_count and len(contact_sheets) != expected_contact_sheet_count:
        raise ValueError(
            "Formal v004b contact-sheet count is incomplete: "
            f"expected={expected_contact_sheet_count} actual={len(contact_sheets)}"
        )
    summary = build_summary(
        media_metadata,
        frame_index,
        layer_dropout_analysis,
        metrics,
        watermark_motion_proof,
        contact_sheets,
        f"candidate v{candidate_version:03d}/{qa_dir.name} only",
        candidate_version,
        generic_contract,
    )
    write_json(qa_dir / "qa-summary.json", summary)
    (qa_dir / "QA-REPORT.md").write_text(
        markdown_report(summary, metrics), encoding="utf-8"
    )
    if watermark_motion_proof is not None and watermark_motion_proof["status"] != "pass":
        raise ValueError(
            "Formal watermark motion gate failed: decoded crops did not prove continuous motion"
        )
    print(
        json.dumps(
            {
                "status": summary["status"],
                "sceneCount": summary["coverage"]["sceneCount"],
                "representativeFrameCount": summary["coverage"]["representativeFrameCount"],
                "sceneTransitionCount": summary["coverage"]["sceneTransitionCount"],
                "periodicSampleCount": summary["coverage"]["periodicSampleCount"],
                "longStaticCandidateCount": summary["automatedChecks"]["longStaticCandidateCount"],
                "lowInformationSampleCount": summary["automatedChecks"]["lowInformationSampleCount"],
                "singleFrameAbaLayerDropoutStatus": summary["automatedChecks"]["singleFrameAbaLayerDropout"]["status"],
                "singleFrameAbaLayerDropoutBlockingEventCount": summary["automatedChecks"]["singleFrameAbaLayerDropout"]["blockingEventCount"],
                "contactSheetCount": len(contact_sheets),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
