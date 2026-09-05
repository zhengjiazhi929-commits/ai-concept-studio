#!/usr/bin/env python3
"""Build the v004c proof contact sheet with a pinned CJK-capable font."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps


SCHEMA_VERSION = "agent-skill-v004c-contact-sheet-builder-v1"
FONT_PATH = Path("/System/Library/Fonts/Hiragino Sans GB.ttc")
FONT_SHA256 = "f887295caf2881cab9554b14c5ab4c9ee624c3895599da152ec37416b5aefae0"
FONT_FAMILY = "Hiragino Sans GB"
REGULAR_FONT_INDEX = 0
REGULAR_FONT_WEIGHT = "W3"
BOLD_FONT_INDEX = 2
BOLD_FONT_WEIGHT = "W6"
CJK_GLYPH_PROBE = "中文标题字幕语义锚点"
CLOSING_PUNCTUATION = "，。！？；：、）》】」』”’%,.!?;:)"


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the fixed-font v004c semantic/Logo proof contact sheet."
    )
    parser.add_argument("--analyzer", required=True, type=Path)
    parser.add_argument("--qa-dir", required=True, type=Path)
    parser.add_argument("--frame-index", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def load_analyzer(path: Path) -> Any:
    if not path.is_file() or path.is_symlink():
        raise FileNotFoundError(f"QA analyzer must be a plain file: {path}")
    spec = importlib.util.spec_from_file_location("v004c_qa_base", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import QA analyzer: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    index = BOLD_FONT_INDEX if bold else REGULAR_FONT_INDEX
    expected_name = (
        (FONT_FAMILY, BOLD_FONT_WEIGHT)
        if bold
        else (FONT_FAMILY, REGULAR_FONT_WEIGHT)
    )
    selected = ImageFont.truetype(str(FONT_PATH), size=size, index=index)
    if selected.getname() != expected_name:
        raise RuntimeError(
            "Contact-sheet font identity drifted: "
            f"expected={expected_name!r} actual={selected.getname()!r}"
        )
    return selected


def verify_font_contract() -> dict[str, Any]:
    if not FONT_PATH.is_file() or FONT_PATH.is_symlink():
        raise FileNotFoundError(f"Pinned contact-sheet font is unavailable: {FONT_PATH}")
    font_bytes = FONT_PATH.read_bytes()
    actual_sha256 = sha256_bytes(font_bytes)
    if actual_sha256 != FONT_SHA256:
        raise RuntimeError(
            "Contact-sheet font SHA-256 drifted: "
            f"expected={FONT_SHA256} actual={actual_sha256}"
        )
    regular = load_font(24, bold=False)
    bold = load_font(24, bold=True)
    glyph_hashes = {
        sha256_bytes(bytes(regular.getmask(character))) for character in CJK_GLYPH_PROBE
    }
    if len(glyph_hashes) < 8:
        raise RuntimeError("Pinned contact-sheet font failed the CJK glyph raster probe")
    return {
        "path": str(FONT_PATH),
        "sha256": actual_sha256,
        "family": FONT_FAMILY,
        "regular": {"index": REGULAR_FONT_INDEX, "weight": REGULAR_FONT_WEIGHT},
        "bold": {"index": BOLD_FONT_INDEX, "weight": BOLD_FONT_WEIGHT},
        "cjkGlyphProbe": {
            "text": CJK_GLYPH_PROBE,
            "distinctRasterCount": len(glyph_hashes),
            "passed": True,
        },
    }


def wrapped_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    selected_font: ImageFont.FreeTypeFont,
    maximum_width: int,
    maximum_lines: int = 2,
) -> list[str]:
    source = " ".join(str(text).split())
    if not source:
        return [""]
    lines: list[str] = []
    current = ""
    tokens = re.findall(r"[A-Za-z0-9_.+/-]+| +|.", source)
    cursor = 0
    while cursor < len(tokens):
        token = tokens[cursor]
        if not current and token.isspace():
            cursor += 1
            continue
        candidate = current + token
        candidate_width = draw.textbbox(
            (0, 0), candidate, font=selected_font
        )[2]
        if current and candidate_width > maximum_width:
            if token in CLOSING_PUNCTUATION:
                current = candidate
                cursor += 1
            lines.append(current.rstrip())
            current = ""
            if len(lines) == maximum_lines:
                break
            continue
        current = candidate
        cursor += 1
    if len(lines) < maximum_lines and current:
        lines.append(current.rstrip())
    if cursor < len(tokens):
        final = lines[-1] if lines else ""
        while final and draw.textbbox(
            (0, 0), final + "…", font=selected_font
        )[2] > maximum_width:
            final = final[:-1]
        if lines:
            lines[-1] = final.rstrip() + "…"
        else:
            lines = ["…"]
    return lines


def draw_wrapped_label(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    selected_font: ImageFont.FreeTypeFont,
    fill: str,
    maximum_width: int,
) -> None:
    draw.multiline_text(
        xy,
        "\n".join(
            wrapped_lines(draw, text, selected_font, maximum_width, maximum_lines=2)
        ),
        fill=fill,
        font=selected_font,
        spacing=2,
    )


def build_contact_sheet(
    analyzer_path: Path,
    qa_path: Path,
    frame_index_path: Path,
    output_path: Path,
) -> dict[str, Any]:
    if not qa_path.is_dir() or qa_path.is_symlink():
        raise FileNotFoundError(f"QA directory must be a plain directory: {qa_path}")
    if not frame_index_path.is_file() or frame_index_path.is_symlink():
        raise FileNotFoundError(f"Frame index must be a plain file: {frame_index_path}")
    if output_path.exists() or output_path.is_symlink():
        raise FileExistsError(f"Contact sheet already exists: {output_path}")
    if output_path.parent.resolve() != output_path.parent:
        raise RuntimeError("Contact-sheet output parent must resolve without symlinks")

    typography = verify_font_contract()
    module = load_analyzer(analyzer_path)
    frame_index = read_json(frame_index_path)
    proof = module.analyze_watermark_continuous_motion(qa_path, frame_index)
    proof["proofGlobalStartFrame"] = frame_index["proofGlobalStartFrame"]
    proof["proofGlobalEndFrameExclusive"] = frame_index[
        "proofGlobalEndFrameExclusive"
    ]

    logo_items = module.tag_items(
        frame_index["fullSamples"], "watermark-motion-sample:"
    )
    rolling_items = module.tag_items(
        frame_index["fullSamples"], "rolling-boundary:"
    )
    subtitle_items = module.tag_items(frame_index["fullSamples"], "subtitle-cue:")
    cue_text = {
        str(item["cueIndex"]): item["text"]
        for item in frame_index["subtitleEvidence"]
    }

    margin, gap = 24, 12
    logo_w, logo_h, logo_cols = 220, 258, 5
    sub_w, sub_h, sub_cols = 400, 282, 3
    logo_rows = math.ceil(len(logo_items) / logo_cols)
    rolling_rows = math.ceil(len(rolling_items) / sub_cols)
    sub_rows = math.ceil(len(subtitle_items) / sub_cols)
    width = max(
        margin * 2 + logo_cols * logo_w + (logo_cols - 1) * gap,
        margin * 2 + sub_cols * sub_w + (sub_cols - 1) * gap,
    )
    height = (
        margin
        + 58
        + logo_rows * (logo_h + gap)
        + 58
        + rolling_rows * (sub_h + gap)
        + 58
        + sub_rows * (sub_h + gap)
        + margin
    )
    canvas = Image.new("RGB", (width, height), module.PALETTE["canvas"])
    draw = ImageDraw.Draw(canvas)
    heading_font = load_font(27, bold=True)
    label_font = load_font(16, bold=False)

    draw.text(
        (margin, margin),
        "Logo 连续运动：0–120 帧完整周期",
        fill=module.PALETTE["ink"],
        font=heading_font,
    )
    top = margin + 58
    crop = frame_index["watermarkCropPixels"]
    for position, (sample, tag) in enumerate(logo_items):
        column, row = position % logo_cols, position // logo_cols
        x = margin + column * (logo_w + gap)
        y = top + row * (logo_h + gap)
        with module.image_for(qa_path, sample) as image:
            logo = image.crop(
                (
                    crop["left"],
                    crop["top"],
                    crop["left"] + crop["width"],
                    crop["top"] + crop["height"],
                )
            )
            logo = ImageOps.contain(
                logo, (196, 196), Image.Resampling.LANCZOS
            )
        canvas.paste(logo, (x + 12, y))
        offset = tag.rsplit(":", 1)[-1]
        draw.text(
            (x + 12, y + 202),
            f"local +{offset}f / global {sample['globalFrame']}",
            fill=module.PALETTE["ink"],
            font=label_font,
        )

    top += logo_rows * (logo_h + gap) + 34
    draw.text(
        (margin, top),
        "Rolling 前缀锚点：边界前一帧 / 后一帧",
        fill=module.PALETTE["ink"],
        font=heading_font,
    )
    top += 48
    for position, (sample, tag) in enumerate(rolling_items):
        column, row = position % sub_cols, position // sub_cols
        x = margin + column * (sub_w + gap)
        y = top + row * (sub_h + gap)
        with module.image_for(qa_path, sample) as image:
            thumbnail = ImageOps.fit(
                image, (sub_w, 225), Image.Resampling.LANCZOS
            )
        canvas.paste(thumbnail, (x, y))
        _, index, side = tag.split(":")
        draw.text(
            (x + 6, y + 232),
            f"cue-{index} {side} / global {sample['globalFrame']}",
            fill=module.PALETTE["ink"],
            font=label_font,
        )

    top += rolling_rows * (sub_h + gap) + 34
    draw.text(
        (margin, top),
        "字幕语义与无框排版：每条中点解码帧",
        fill=module.PALETTE["ink"],
        font=heading_font,
    )
    top += 48
    for position, (sample, tag) in enumerate(subtitle_items):
        column, row = position % sub_cols, position // sub_cols
        x = margin + column * (sub_w + gap)
        y = top + row * (sub_h + gap)
        with module.image_for(qa_path, sample) as image:
            thumbnail = ImageOps.fit(
                image, (sub_w, 225), Image.Resampling.LANCZOS
            )
        canvas.paste(thumbnail, (x, y))
        index = tag.rsplit(":", 1)[-1]
        draw_wrapped_label(
            draw,
            (x + 6, y + 232),
            f"cue-{index} · {cue_text.get(index, '')}",
            label_font,
            module.PALETTE["ink"],
            sub_w - 12,
        )

    buffer = io.BytesIO()
    canvas.save(buffer, format="PNG", optimize=True)
    output_path.parent.mkdir(parents=False, exist_ok=True)
    with output_path.open("xb") as handle:
        handle.write(buffer.getvalue())
        handle.flush()

    proof["contactSheet"] = {
        "schemaVersion": SCHEMA_VERSION,
        "path": str(output_path),
        "bytes": len(buffer.getvalue()),
        "sha256": sha256_bytes(buffer.getvalue()),
        "width": width,
        "height": height,
        "typography": typography,
        "chineseLabelsReadableByContract": True,
        "historicalContactSheetReused": False,
    }
    return proof


def main() -> None:
    args = parse_arguments()
    result = build_contact_sheet(
        args.analyzer.resolve(),
        args.qa_dir.resolve(),
        args.frame_index.resolve(),
        args.output.resolve(),
    )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    main()
