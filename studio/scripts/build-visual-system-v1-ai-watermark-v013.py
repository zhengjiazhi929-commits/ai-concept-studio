#!/usr/bin/env python3
"""Build the approved v013 stable-footprint watermark from approved v012.

This builder is intentionally write-once: it refuses to run when the v013
directory already exists. The approved v012 source assets are read-only.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import PIL
from PIL import Image


STUDIO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ASSET_ROOT = STUDIO_ROOT / "public/assets/visual-system-v1/ai-watermark-v012"
OUTPUT_ASSET_ROOT = STUDIO_ROOT / "public/assets/visual-system-v1/ai-watermark-v013"
SOURCE_MANIFEST = SOURCE_ASSET_ROOT / "manifest.json"
FRAME_COUNT = 120
CANVAS_SIZE = (120, 120)
ALPHA_THRESHOLD = 16
TARGET_VISIBLE_LONG_EDGE = 108
VISIBLE_LONG_EDGE_TOLERANCE = 2
CENTER_COORDINATE = (60.0, 60.0)
CENTER_TOLERANCE = 1.0
ALGORITHM_ID = "per-frame-alpha-bbox-isotropic-fit-center-v1"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _alpha_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    alpha = image.getchannel("A")
    threshold_mask = alpha.point(
        lambda value: 255 if value >= ALPHA_THRESHOLD else 0,
        mode="L",
    )
    return threshold_mask.getbbox()


def _bbox_payload(bbox: tuple[int, int, int, int]) -> dict[str, Any]:
    left, top, right, bottom = bbox
    width = right - left
    height = bottom - top
    return {
        "left": left,
        "top": top,
        "rightExclusive": right,
        "bottomExclusive": bottom,
        "width": width,
        "height": height,
        "longEdge": max(width, height),
        "centerX": (left + right) / 2,
        "centerY": (top + bottom) / 2,
    }


def _round_half_up(value: float) -> int:
    return int(math.floor(value + 0.5))


def _target_raster_size(width: int, height: int) -> tuple[int, int]:
    scale = TARGET_VISIBLE_LONG_EDGE / max(width, height)
    return (
        max(1, _round_half_up(width * scale)),
        max(1, _round_half_up(height * scale)),
    )


def _validate_source_manifest() -> dict[str, Any]:
    if not SOURCE_MANIFEST.is_file():
        raise RuntimeError(f"missing v012 source manifest: {SOURCE_MANIFEST}")
    payload = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))
    if payload.get("frameCount") != FRAME_COUNT:
        raise RuntimeError("v012 source manifest must declare exactly 120 frames")
    if payload.get("transparentBackgroundRequired") is not True:
        raise RuntimeError("v012 source manifest must require transparent backgrounds")
    expected_names = {f"frame-{frame:03d}.png" for frame in range(FRAME_COUNT)}
    actual_names = {path.name for path in (SOURCE_ASSET_ROOT / "frames").glob("*.png")}
    if actual_names != expected_names:
        raise RuntimeError("v012 source frame set is not the exact expected 120-frame sequence")
    return payload


def _transform_frame(source_path: Path, output_path: Path) -> dict[str, Any]:
    with Image.open(source_path) as opened:
        if opened.size != CANVAS_SIZE or opened.mode != "RGBA":
            raise RuntimeError(f"source frame must be 120x120 RGBA: {source_path.name}")
        source_image = opened.copy()

    input_bbox = _alpha_bbox(source_image)
    if input_bbox is None:
        raise RuntimeError(f"source frame has no alpha >= {ALPHA_THRESHOLD}: {source_path.name}")
    input_metrics = _bbox_payload(input_bbox)
    cropped = source_image.crop(input_bbox)
    target_width, target_height = _target_raster_size(
        input_metrics["width"], input_metrics["height"]
    )

    # Premultiplied-alpha resizing avoids colored fringes at transparent edges.
    resized = (
        cropped.convert("RGBa")
        .resize((target_width, target_height), Image.Resampling.LANCZOS)
        .convert("RGBA")
    )
    resized_bbox = _alpha_bbox(resized)
    if resized_bbox is None:
        raise RuntimeError(f"resized frame has no visible alpha: {source_path.name}")
    resized_metrics = _bbox_payload(resized_bbox)

    paste_left = _round_half_up(CENTER_COORDINATE[0] - resized_metrics["centerX"])
    paste_top = _round_half_up(CENTER_COORDINATE[1] - resized_metrics["centerY"])
    if (
        paste_left < 0
        or paste_top < 0
        or paste_left + target_width > CANVAS_SIZE[0]
        or paste_top + target_height > CANVAS_SIZE[1]
    ):
        raise RuntimeError(f"centered raster would exceed the 120px canvas: {source_path.name}")

    output_image = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    output_image.alpha_composite(resized, (paste_left, paste_top))
    output_bbox = _alpha_bbox(output_image)
    if output_bbox is None:
        raise RuntimeError(f"output frame has no visible alpha: {source_path.name}")
    output_metrics = _bbox_payload(output_bbox)

    if abs(output_metrics["longEdge"] - TARGET_VISIBLE_LONG_EDGE) > VISIBLE_LONG_EDGE_TOLERANCE:
        raise RuntimeError(f"output visible footprint is out of tolerance: {source_path.name}")
    if (
        abs(output_metrics["centerX"] - CENTER_COORDINATE[0]) > CENTER_TOLERANCE
        or abs(output_metrics["centerY"] - CENTER_COORDINATE[1]) > CENTER_TOLERANCE
    ):
        raise RuntimeError(f"output visible footprint is not centered: {source_path.name}")
    if (
        abs(output_metrics["width"] - target_width) > 2
        or abs(output_metrics["height"] - target_height) > 2
    ):
        raise RuntimeError(f"output aspect changed beyond pixel-rounding tolerance: {source_path.name}")

    output_image.save(output_path, format="PNG", optimize=False, compress_level=9)
    with Image.open(output_path) as verified:
        if verified.size != CANVAS_SIZE or verified.mode != "RGBA":
            raise RuntimeError(f"written frame is not 120x120 RGBA: {source_path.name}")
        verified_bbox = _alpha_bbox(verified)
        if verified_bbox != output_bbox:
            raise RuntimeError(f"written frame bbox changed after PNG encoding: {source_path.name}")
        alpha_histogram = verified.getchannel("A").histogram()
        if alpha_histogram[0] == 0:
            raise RuntimeError(f"written frame has no transparent background: {source_path.name}")

    return {
        "sourcePath": (
            f"assets/visual-system-v1/ai-watermark-v012/frames/{source_path.name}"
        ),
        "outputPath": (
            f"assets/visual-system-v1/ai-watermark-v013/frames/{output_path.name}"
        ),
        "sourceSha256": _sha256(source_path),
        "outputSha256": _sha256(output_path),
        "inputAlphaBBox": input_metrics,
        "transform": {
            "isotropicScale": TARGET_VISIBLE_LONG_EDGE / input_metrics["longEdge"],
            "targetRasterWidth": target_width,
            "targetRasterHeight": target_height,
            "resizedAlphaBBox": resized_metrics,
            "pasteLeft": paste_left,
            "pasteTop": paste_top,
        },
        "outputAlphaBBox": output_metrics,
        "transparentPixelCount": alpha_histogram[0],
    }


def _build() -> dict[str, Any]:
    if os.path.lexists(OUTPUT_ASSET_ROOT):
        raise RuntimeError(
            f"refusing to overwrite existing asset directory: {OUTPUT_ASSET_ROOT}"
        )

    source_manifest = _validate_source_manifest()
    OUTPUT_ASSET_ROOT.parent.mkdir(parents=True, exist_ok=True)
    staging_root = Path(
        tempfile.mkdtemp(
            prefix=".ai-watermark-v013.building-",
            dir=OUTPUT_ASSET_ROOT.parent,
        )
    )
    frames_root = staging_root / "frames"
    frames_root.mkdir()

    frame_records: dict[str, Any] = {}
    for frame in range(FRAME_COUNT):
        file_name = f"frame-{frame:03d}.png"
        frame_records[str(frame)] = _transform_frame(
            SOURCE_ASSET_ROOT / "frames" / file_name,
            frames_root / file_name,
        )

    script_path = Path(__file__).resolve()
    manifest = {
        "schemaVersion": "visual-system-v1-ai-watermark-stable-footprint-assets-v1",
        "assetVersion": 13,
        "status": "approved-default",
        "reviewOnly": False,
        "approved": True,
        "approval": {
            "acceptedDirection": "v002",
            "approvedBy": "Zhengjiazhi",
            "approvedOn": "2026-08-26",
            "approvedProfileId": "approved-v013-stable-footprint",
            "scope": "stable-visible-footprint-watermark-profile",
        },
        "source": {
            "assetVersion": 12,
            "assetRoot": "assets/visual-system-v1/ai-watermark-v012",
            "manifestPath": "assets/visual-system-v1/ai-watermark-v012/manifest.json",
            "manifestSha256": _sha256(SOURCE_MANIFEST),
            "sourceMotionSchemaVersion": source_manifest.get("sourceMotionSchemaVersion"),
        },
        "algorithm": {
            "id": ALGORITHM_ID,
            "alphaThresholdInclusive": ALPHA_THRESHOLD,
            "targetVisibleLongEdge": TARGET_VISIBLE_LONG_EDGE,
            "visibleLongEdgeTolerance": VISIBLE_LONG_EDGE_TOLERANCE,
            "canvasCenter": {"x": CENTER_COORDINATE[0], "y": CENTER_COORDINATE[1]},
            "centerTolerance": CENTER_TOLERANCE,
            "crop": "minimal source bbox where alpha >= threshold",
            "scale": "per-frame isotropic fit to target visible long edge",
            "resample": "Pillow Image.Resampling.LANCZOS in premultiplied-alpha RGBa",
            "placement": "integer translation that centers resized threshold bbox",
            "aspectTolerance": "target raster preserves aspect by half-up pixel rounding; encoded threshold bbox may differ by at most 2px per axis",
            "canvas": {"width": CANVAS_SIZE[0], "height": CANVAS_SIZE[1], "mode": "RGBA"},
            "pillowVersion": PIL.__version__,
            "builderPath": "studio/scripts/build-visual-system-v1-ai-watermark-v013.py",
            "builderSha256": _sha256(script_path),
        },
        "frameCount": FRAME_COUNT,
        "transparentBackgroundRequired": True,
        "integrationMode": "default-approved-profile-frame-indexed-transparent-png-sequence",
        "frames": frame_records,
    }
    manifest_path = staging_root / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    if os.path.lexists(OUTPUT_ASSET_ROOT):
        raise RuntimeError(
            f"refusing to overwrite output created during build: {OUTPUT_ASSET_ROOT}; "
            f"staging preserved at {staging_root}"
        )
    staging_root.rename(OUTPUT_ASSET_ROOT)
    return {
        "assetRoot": str(OUTPUT_ASSET_ROOT),
        "manifest": str(OUTPUT_ASSET_ROOT / "manifest.json"),
        "frameCount": FRAME_COUNT,
        "profile": "approved-v013-stable-footprint",
        "reviewOnly": False,
        "approved": True,
    }


def main() -> int:
    try:
        result = _build()
    except Exception as error:  # noqa: BLE001 - CLI must fail closed with a clear reason.
        print(f"v013 watermark build failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
