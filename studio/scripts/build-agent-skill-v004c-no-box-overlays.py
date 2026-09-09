#!/usr/bin/env python3
"""Build the immutable 05:36-05:56 v004c proof caption overlay sequence.

This proof builder deliberately imports the accepted v004b glyph renderer and
PNG inspector.  It does not reuse any historical cue PNG: every selected cue
is rendered from the frozen v004c semantic timeline.
"""

from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import sys
import uuid
from pathlib import Path
from types import ModuleType
from typing import Any


sys.dont_write_bytecode = True


FPS = 30
FULL_DURATION_IN_FRAMES = 18_000
PROOF_START_FRAME = 10_080
PROOF_FRAME_COUNT = 600
PROOF_END_FRAME_EXCLUSIVE = PROOF_START_FRAME + PROOF_FRAME_COUNT
MODE = "proof"
EXPECTED_SOURCE_TIMELINE_SHA256 = (
    "1a4fc03ab45ef2ca49c8e0e1cd0132c32ae6baddc723539eba3a7e001842f265"
)
EXPECTED_TIMELINE_SHA256 = (
    "49ca97cabff234500c610cb4461a9506ea4681bec10cbe5d83b5befbcd03f78f"
)
EXPECTED_TIMELINE_SCHEMA_VERSION = "agent-skill-subtitle-timeline-v004c-semantic-v7"
EXPECTED_SEGMENTATION_CONTRACT_VERSION = "subtitle-semantic-segmentation-v7"
EXPECTED_RENDERER_SHA256 = (
    "29ca4ed9705ab07c6dc2a273e1d6d6dbd238a0587b20dfbf4c4cd4bf98ffb71b"
)
EXPECTED_RENDERER_PYTHON_SHA256 = (
    "71720f1fc66989ebd691e81c96111b47ae6ff3f1a478666084d1cacbf0fccbf2"
)
EXPECTED_FONT_SHA256 = (
    "f887295caf2881cab9554b14c5ab4c9ee624c3895599da152ec37416b5aefae0"
)
TIMELINE_RELATIVE = Path(
    "studio/data/render-inputs/full-v004c-attempt-005/"
    "subtitle-timeline-v004c-semantic.json"
)
BASE_BUILDER_RELATIVE = Path(
    "studio/scripts/build-agent-skill-v004b-no-box-overlays.py"
)
CANDIDATE_PARENT_RELATIVE = Path(
    "outputs/studio/agent-skill-20260806/review-candidates"
)
CANDIDATE_DIRECTORY_NAME = (
    "v004c-semantic-subtitle-continuous-logo-proof-v001"
)
STAGING_DIRECTORY_PATTERN = re.compile(
    rf"^\.{re.escape(CANDIDATE_DIRECTORY_NAME)}\.part-"
    r"[a-f0-9]([-a-f0-9]{6,78}[a-f0-9])?$"
)
OUTPUT_DIRECTORY_NAME = "caption-overlays"
MANIFEST_FILE_NAME = "overlay-manifest-v004c-no-box-proof.json"
HASH_PATTERN = re.compile(r"^[a-f0-9]{64}$")


def load_base_builder() -> tuple[ModuleType, bytes]:
    script_path = Path(__file__).resolve()
    workspace_root = script_path.parents[2]
    base_path = (workspace_root / BASE_BUILDER_RELATIVE).resolve()
    if base_path == script_path or not base_path.is_file() or base_path.is_symlink():
        raise RuntimeError(f"v004b 字幕渲染器必须是普通文件：{base_path}")
    def read_base_bytes() -> bytes:
        flags = (
            os.O_RDONLY
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0)
        )
        descriptor = os.open(base_path, flags)
        try:
            with os.fdopen(descriptor, "rb", closefd=False) as source:
                return source.read()
        finally:
            os.close(descriptor)

    base_bytes = read_base_bytes()
    actual_sha256 = hashlib.sha256(base_bytes).hexdigest()
    if actual_sha256 != EXPECTED_RENDERER_SHA256:
        raise RuntimeError(
            "v004b 字幕渲染器 SHA-256 漂移："
            f"expected={EXPECTED_RENDERER_SHA256} actual={actual_sha256}"
        )
    spec = importlib.util.spec_from_file_location(
        "agent_skill_v004b_no_box_overlay_base", base_path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 v004b 字幕渲染器：{base_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if read_base_bytes() != base_bytes:
        raise RuntimeError("v004b 字幕渲染器在 import 期间发生漂移")
    return module, base_bytes


BASE, BASE_BUILDER_SNAPSHOT = load_base_builder()


def sha256_argument(value: str) -> str:
    if not HASH_PATTERN.fullmatch(value):
        raise argparse.ArgumentTypeError("必须是 64 位小写 SHA-256")
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build fixed v004c proof-only no-box caption overlays."
    )
    parser.add_argument("--timeline", required=True, type=Path)
    parser.add_argument(
        "--expected-timeline-sha256", required=True, type=sha256_argument
    )
    parser.add_argument("--output-directory", required=True, type=Path)
    parser.add_argument("--start-frame", required=True, type=int)
    parser.add_argument("--frame-count", required=True, type=int)
    parser.add_argument("--mode", required=True, choices=(MODE,))
    return parser.parse_args()


def absolute(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def read_plain_bytes(path: Path, label: str) -> bytes:
    details = path.lstat()
    if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode):
        raise RuntimeError(f"{label} 必须是普通文件且不能是符号链接：{path}")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            raise RuntimeError(f"{label} 必须是普通文件：{path}")
        with os.fdopen(descriptor, "rb", closefd=False) as source:
            return source.read()
    finally:
        os.close(descriptor)


def file_sha256(path: Path) -> str:
    return hashlib.sha256(read_plain_bytes(path, "hash input")).hexdigest()


def assert_inside(parent: Path, child: Path, label: str) -> None:
    try:
        child.relative_to(parent)
    except ValueError as error:
        raise RuntimeError(f"{label} 越出允许目录：{child}") from error


def atomic_rename_no_replace(source: Path, target: Path) -> None:
    if target.exists() or target.is_symlink():
        raise RuntimeError(f"拒绝覆盖既有 proof 字幕目录：{target}")
    library = ctypes.CDLL(None, use_errno=True)
    source_bytes = os.fsencode(source)
    target_bytes = os.fsencode(target)
    if sys.platform == "darwin":
        rename = library.renamex_np
        rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        result = rename(source_bytes, target_bytes, 0x00000004)
    elif sys.platform.startswith("linux"):
        rename = library.renameat2
        rename.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        rename.restype = ctypes.c_int
        result = rename(-100, source_bytes, -100, target_bytes, 0x00000001)
    else:
        raise RuntimeError("当前平台不支持原子 no-replace 目录发布")
    if result == 0:
        return
    error_number = ctypes.get_errno()
    if error_number in (errno.EEXIST, errno.ENOTEMPTY):
        raise RuntimeError(f"拒绝覆盖既有 proof 字幕目录：{target}")
    raise OSError(error_number, os.strerror(error_number), os.fspath(target))


def validate_fixed_arguments(args: argparse.Namespace) -> tuple[Path, Path]:
    script_path = absolute(Path(__file__))
    workspace_root = script_path.parents[2]
    timeline_path = absolute(args.timeline)
    output_directory = absolute(args.output_directory)
    expected_timeline = absolute(workspace_root / TIMELINE_RELATIVE)
    expected_parent = absolute(workspace_root / CANDIDATE_PARENT_RELATIVE)
    if args.mode != MODE:
        raise RuntimeError("v004c builder 只允许 proof 模式")
    if args.start_frame != PROOF_START_FRAME:
        raise RuntimeError(f"proof start-frame 必须严格为 {PROOF_START_FRAME}")
    if args.frame_count != PROOF_FRAME_COUNT:
        raise RuntimeError(f"proof frame-count 必须严格为 {PROOF_FRAME_COUNT}")
    if timeline_path != expected_timeline:
        raise RuntimeError(f"只接受 immutable attempt-005 timeline：{expected_timeline}")
    if args.expected_timeline_sha256 != EXPECTED_TIMELINE_SHA256:
        raise RuntimeError("attempt-005 timeline SHA-256 不等于源码锁定值")
    if output_directory.name != OUTPUT_DIRECTORY_NAME:
        raise RuntimeError(f"proof overlay 输出目录名必须为 {OUTPUT_DIRECTORY_NAME}")
    staging_parent = output_directory.parent
    if staging_parent.parent != expected_parent:
        raise RuntimeError("proof overlay 必须写入固定候选父目录内的 staging")
    if not STAGING_DIRECTORY_PATTERN.fullmatch(staging_parent.name):
        raise RuntimeError("proof overlay staging 目录名称不符合固定 no-replace 合同")
    if output_directory.exists() or output_directory.is_symlink():
        raise RuntimeError(f"拒绝覆盖既有 proof 字幕目录：{output_directory}")
    return timeline_path, output_directory


def cue_values(raw_cue: Any, expected_index: int) -> dict[str, Any]:
    if not isinstance(raw_cue, dict):
        raise RuntimeError(f"第 {expected_index} 条 displayCue 必须是对象")
    if raw_cue.get("index") != expected_index:
        raise RuntimeError("displayCue index 必须从 1 连续递增")
    text = raw_cue.get("text")
    start_frame = raw_cue.get("startFrame")
    end_frame = raw_cue.get("endFrameExclusive")
    start = raw_cue.get("start")
    end = raw_cue.get("end")
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError(f"第 {expected_index} 条 displayCue 文本无效")
    if type(start_frame) is not int or type(end_frame) is not int:
        raise RuntimeError(f"第 {expected_index} 条 displayCue 帧必须是整数")
    if end_frame <= start_frame or start_frame < 0 or end_frame > FULL_DURATION_IN_FRAMES:
        raise RuntimeError(f"第 {expected_index} 条 displayCue 帧范围无效")
    if isinstance(start, bool) or not isinstance(start, (int, float)):
        raise RuntimeError(f"第 {expected_index} 条 displayCue start 无效")
    if isinstance(end, bool) or not isinstance(end, (int, float)):
        raise RuntimeError(f"第 {expected_index} 条 displayCue end 无效")
    if abs(start_frame / FPS - float(start)) > 1 / FPS + 1e-6:
        raise RuntimeError(f"第 {expected_index} 条 displayCue start 与帧不一致")
    if abs(end_frame / FPS - float(end)) > 1 / FPS + 1e-6:
        raise RuntimeError(f"第 {expected_index} 条 displayCue end 与帧不一致")
    return {
        "index": expected_index,
        "speechSegmentIndex": raw_cue.get("speechSegmentIndex"),
        "sceneId": raw_cue.get("sceneId"),
        "text": text,
        "start": float(start),
        "end": float(end),
        "startFrame": start_frame,
        "endFrameExclusive": end_frame,
        "sourceText": raw_cue.get("sourceText", text),
        "sourceCharacterStart": raw_cue.get("sourceCharacterStart"),
        "sourceCharacterEnd": raw_cue.get("sourceCharacterEnd"),
        "displayContextStart": raw_cue.get("displayContextStart"),
        "rollingCarryApplied": raw_cue.get("rollingCarryApplied") is True,
        "rollingGroup": raw_cue.get("rollingGroup"),
    }


def validate_timeline(
    timeline: dict[str, Any], timeline_path: Path
) -> list[dict[str, Any]]:
    if timeline.get("schemaVersion") != EXPECTED_TIMELINE_SCHEMA_VERSION:
        raise RuntimeError("attempt-005 timeline schemaVersion 不匹配")
    if timeline.get("fps") != FPS or timeline.get("durationInFrames") != FULL_DURATION_IN_FRAMES:
        raise RuntimeError("attempt-005 timeline 必须为 30fps / 18000 帧")
    if timeline.get("sampleRate") != 48_000 or timeline.get("durationInSamples") != 28_800_000:
        raise RuntimeError("attempt-005 timeline 音频合同必须为 48kHz / 28800000 samples")
    accepted_prefix = timeline.get("acceptedPrefix")
    if not isinstance(accepted_prefix, dict) or accepted_prefix.get("reused") is not False:
        raise RuntimeError("attempt-005 必须声明不复用旧字幕 PNG")
    segmentation = timeline.get("semanticSegmentation")
    visual_fit = segmentation.get("visualFit") if isinstance(segmentation, dict) else None
    checks = {
        "segmentationContractV7": isinstance(segmentation, dict)
        and segmentation.get("contractVersion") == EXPECTED_SEGMENTATION_CONTRACT_VERSION,
        "sourceTimelineSha256": isinstance(segmentation, dict)
        and segmentation.get("sourceTimelineSha256") == EXPECTED_SOURCE_TIMELINE_SHA256,
        "markerAligned": isinstance(segmentation, dict)
        and segmentation.get("markerAligned") is True,
        "audioUnchanged": isinstance(segmentation, dict)
        and segmentation.get("audioChanged") is False,
        "acceptedPrefixNotReused": isinstance(segmentation, dict)
        and segmentation.get("acceptedPrefixCuePngsReused") is False,
        "visualChunkFitsEnforced": isinstance(segmentation, dict)
        and segmentation.get("visualChunkFitsEnforced") is True,
        "visualFitVerified": isinstance(visual_fit, dict)
        and visual_fit.get("verified") is True,
        "visualFitPublicationEligible": isinstance(visual_fit, dict)
        and visual_fit.get("publicationEligible") is True,
        "realRendererMeasurement": isinstance(visual_fit, dict)
        and visual_fit.get("measurementProvenance") == "real-overlay-renderer"
        and visual_fit.get("testDouble") is False,
        "measurementSnapshotsReverified": isinstance(visual_fit, dict)
        and isinstance(visual_fit.get("renderer"), dict)
        and visual_fit["renderer"].get("snapshotReverifiedAfterMeasurement") is True,
        "allSelectedChunksFit": isinstance(visual_fit, dict)
        and visual_fit.get("allSelectedChunksFit") is True,
        "thresholdsNotRelaxed": isinstance(visual_fit, dict)
        and isinstance(visual_fit.get("renderer"), dict)
        and visual_fit["renderer"].get("alphaAndSafeAreaThresholdsRelaxed") is False
        and visual_fit["renderer"].get("builderSha256") == EXPECTED_RENDERER_SHA256
        and visual_fit["renderer"].get("pythonSha256") == EXPECTED_RENDERER_PYTHON_SHA256
        and visual_fit["renderer"].get("fontSha256") == EXPECTED_FONT_SHA256
        and visual_fit["renderer"].get("fontFamily") == "Hiragino Sans GB"
        and visual_fit["renderer"].get("fontWeight") == "W3"
        and visual_fit["renderer"].get("fontSize") == 40
        and visual_fit["renderer"].get("overlaySize") == [1480, 130],
        "maximumDurationAtMost5_5": isinstance(segmentation, dict)
        and float(segmentation.get("maximumCueDurationSeconds", 99)) <= 5.5
        and isinstance(visual_fit, dict)
        and float(visual_fit.get("maximumActualCueDurationSeconds", 99)) <= 5.5,
        "timelinePathAttempt005": timeline_path.parts[-2] == "full-v004c-attempt-005",
    }
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        raise RuntimeError(f"attempt-005 semantic/visual-fit 合同失败：{', '.join(failed)}")
    raw_cues = timeline.get("displayCues")
    if not isinstance(raw_cues, list) or not raw_cues:
        raise RuntimeError("attempt-005 缺少 displayCues")
    cues = [cue_values(raw, index) for index, raw in enumerate(raw_cues, start=1)]
    previous_end = 0
    for cue in cues:
        if cue["startFrame"] < previous_end:
            raise RuntimeError(f"displayCue {cue['index']} 与上一条重叠")
        previous_end = cue["endFrameExclusive"]
    selected = [
        cue
        for cue in cues
        if cue["endFrameExclusive"] > PROOF_START_FRAME
        and cue["startFrame"] < PROOF_END_FRAME_EXCLUSIVE
    ]
    if not selected:
        raise RuntimeError("05:36-05:56 proof 范围没有字幕")
    return selected


def rolling_layout_groups(cues: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    grouped: dict[tuple[int, int], list[dict[str, Any]]] = {}
    for cue in cues:
        context_start = cue.get("displayContextStart")
        character_start = cue.get("sourceCharacterStart")
        character_end = cue.get("sourceCharacterEnd")
        segment_index = cue.get("speechSegmentIndex")
        if not all(type(value) is int for value in (
            context_start, character_start, character_end, segment_index
        )):
            continue
        grouped.setdefault((segment_index, context_start), []).append(cue)

    by_cue: dict[int, dict[str, Any]] = {}
    for (segment_index, context_start), members in grouped.items():
        members.sort(key=lambda cue: int(cue["sourceCharacterEnd"]))
        if not any(cue["rollingCarryApplied"] for cue in members):
            continue
        final_cue = members[-1]
        declared_groups = [cue.get("rollingGroup") for cue in members]
        if not all(isinstance(group, dict) for group in declared_groups):
            raise RuntimeError(
                f"rolling group S{segment_index:02d}:{context_start} 缺少显式 rollingGroup"
            )
        declared = declared_groups[0]
        final_text = str(declared.get("finalText", ""))
        if (
            not final_text
            or any(group.get("id") != declared.get("id") for group in declared_groups)
            or any(group.get("finalText") != final_text for group in declared_groups)
            or any(
                group.get("displayAnchor") != "group-source-start"
                for group in declared_groups
            )
            or any(group.get("sourceStart") != context_start for group in declared_groups)
            or any(
                group.get("sourceEnd") != final_cue["sourceCharacterEnd"]
                for group in declared_groups
            )
            or int(declared.get("cueCount", -1)) != len(members)
            or [int(group.get("cueOrdinal", -1)) for group in declared_groups]
            != list(range(1, len(members) + 1))
            or final_text != str(final_cue["text"])
        ):
            raise RuntimeError(
                f"rolling group S{segment_index:02d}:{context_start} 显式合同不一致"
            )
        if not all(final_text.startswith(str(cue["text"])) for cue in members):
            raise RuntimeError(
                f"rolling group S{segment_index:02d}:{context_start} 不是严格前缀扩展"
            )
        group = {
            "id": str(declared["id"]),
            "speechSegmentIndex": segment_index,
            "displayContextStart": context_start,
            "finalText": final_text,
            "cueIndexes": [cue["index"] for cue in members],
        }
        for cue in members:
            by_cue[cue["index"]] = group
    return by_cue


def final_layout_line_prefixes(
    display_text: str, final_text: str, final_lines: list[str]
) -> list[str]:
    normalized_display = re.sub(r"\s+", " ", display_text).strip()
    normalized_final = re.sub(r"\s+", " ", final_text).strip()
    if not normalized_final.startswith(normalized_display):
        raise RuntimeError("rolling display 必须是 final expanded cue 的严格前缀")
    visible_length = len(normalized_display)
    cursor = 0
    prefixes: list[str] = []
    for line in final_lines:
        line_start = normalized_final.find(line, cursor)
        if line_start < 0:
            raise RuntimeError("无法把 rolling final lines 映射回最终文本")
        line_end = line_start + len(line)
        visible_end = min(visible_length, line_end)
        prefixes.append(
            normalized_final[line_start:visible_end] if visible_end > line_start else ""
        )
        cursor = line_end
    if "".join(prefixes).replace(" ", "") != normalized_display.replace(" ", ""):
        raise RuntimeError("rolling prefix 与 final layout 的可见字形不一致")
    return prefixes


def render_text_on_final_layout(
    display_text: str,
    final_text: str,
    font: Any,
) -> tuple[Any, list[str], dict[str, Any], list[str], list[float]]:
    # render_text() remains the source of truth for the final expanded cue and
    # its balanced lines.  Prefix cues use those exact line origins instead of
    # being re-centered independently.
    final_image, final_lines, final_contract = BASE.render_text(final_text, font)
    measurement_image = BASE.Image.new(
        "RGBA", (BASE.WIDTH, BASE.HEIGHT), (0, 0, 0, 0)
    )
    measurement = BASE.ImageDraw.Draw(measurement_image)
    boxes = [measurement.textbbox((0, 0), line, font=font) for line in final_lines]
    heights = [box[3] - box[1] for box in boxes]
    total_height = sum(heights) + max(0, len(final_lines) - 1) * 10
    cursor_y = (BASE.HEIGHT - total_height) / 2
    first_box = boxes[0]
    first_line_width = first_box[2] - first_box[0]
    fixed_anchor = [
        round((BASE.WIDTH - first_line_width) / 2 - first_box[0], 6),
        round(cursor_y - first_box[1], 6),
    ]
    if display_text == final_text:
        return final_image, final_lines, final_contract, final_lines, fixed_anchor
    visible_lines = final_layout_line_prefixes(display_text, final_text, final_lines)
    image = BASE.Image.new("RGBA", (BASE.WIDTH, BASE.HEIGHT), (0, 0, 0, 0))
    shadow = BASE.Image.new("RGBA", (BASE.WIDTH, BASE.HEIGHT), (0, 0, 0, 0))
    shadow_draw = BASE.ImageDraw.Draw(shadow)
    text_draw = BASE.ImageDraw.Draw(image)
    for final_line, visible_line, box, line_height in zip(
        final_lines, visible_lines, boxes, heights
    ):
        line_width = box[2] - box[0]
        x = (BASE.WIDTH - line_width) / 2 - box[0]
        y = cursor_y - box[1]
        if visible_line:
            shadow_draw.text(
                (x + BASE.SHADOW_OFFSET[0], y + BASE.SHADOW_OFFSET[1]),
                visible_line,
                font=font,
                fill=BASE.SHADOW_COLOR,
            )
            text_draw.text((x, y), visible_line, font=font, fill=BASE.TEXT_COLOR)
        cursor_y += line_height + 10
    shadow = shadow.filter(BASE.ImageFilter.GaussianBlur(radius=BASE.SHADOW_BLUR))
    image = BASE.Image.alpha_composite(shadow, image)
    contract = BASE.alpha_contract(image, allow_blank=False)
    return (
        image,
        [line for line in visible_lines if line],
        contract,
        final_lines,
        fixed_anchor,
    )


def audit_all_timeline_rolling_layouts(
    cues: list[dict[str, Any]],
    rolling_by_cue: dict[int, dict[str, Any]],
    font: Any,
) -> list[dict[str, Any]]:
    """Measure every rolling group without publishing extra cue PNG files.

    The 20-second decoded proof contains S35. S09 lives outside that range, so
    this deterministic geometry audit keeps the shared rendering rule gated for
    both known rolling groups.  The immutable timeline hash prevents a new
    rolling group from silently bypassing this exact-set assertion.
    """
    groups = {
        group["id"]: group
        for group in rolling_by_cue.values()
    }
    expected_group_ids = {"S09:0-39", "S35:65-96"}
    if set(groups) != expected_group_ids:
        raise RuntimeError(
            "attempt-005 rolling group 集合漂移："
            f"expected={sorted(expected_group_ids)} actual={sorted(groups)}"
        )
    audits: list[dict[str, Any]] = []
    for group_id in sorted(groups):
        group = groups[group_id]
        members = [
            cue
            for cue in cues
            if rolling_by_cue.get(cue["index"], {}).get("id") == group_id
        ]
        members.sort(key=lambda cue: cue["index"])
        measurements = []
        for cue in members:
            _, visible_lines, contract, final_lines, fixed_anchor = (
                render_text_on_final_layout(cue["text"], group["finalText"], font)
            )
            measurements.append(
                {
                    "cueIndex": cue["index"],
                    "startFrame": cue["startFrame"],
                    "endFrameExclusive": cue["endFrameExclusive"],
                    "visibleText": cue["text"],
                    "visibleLines": visible_lines,
                    "finalLines": final_lines,
                    "fixedFirstLineAnchor": fixed_anchor,
                    "alphaBoundingBox": contract["alphaBoundingBox"],
                }
            )
        anchors = {
            tuple(measurement["fixedFirstLineAnchor"])
            for measurement in measurements
        }
        alpha_left_edges = {
            measurement["alphaBoundingBox"][0]
            for measurement in measurements
        }
        final_line_layouts = {
            tuple(measurement["finalLines"])
            for measurement in measurements
        }
        right_edges = [
            measurement["alphaBoundingBox"][2]
            for measurement in measurements
        ]
        anchor_stable = len(anchors) == 1
        leading_glyph_stable = len(alpha_left_edges) == 1
        final_layout_stable = len(final_line_layouts) == 1
        grows_only_rightward = right_edges == sorted(right_edges)
        if not all(
            (anchor_stable, leading_glyph_stable, final_layout_stable, grows_only_rightward)
        ):
            raise RuntimeError(f"rolling group {group_id} 固定锚点几何门禁失败")
        audits.append(
            {
                "id": group_id,
                "speechSegmentIndex": group["speechSegmentIndex"],
                "cueIndexes": [member["index"] for member in members],
                "boundaryFrames": [
                    member["startFrame"] for member in members[1:]
                ],
                "finalText": group["finalText"],
                "measurements": measurements,
                "checks": {
                    "fixedFirstLineAnchorStable": anchor_stable,
                    "leadingGlyphAlphaLeftStable": leading_glyph_stable,
                    "finalLineLayoutStable": final_layout_stable,
                    "prefixGrowsOnlyRightward": grows_only_rightward,
                },
                "passed": True,
            }
        )
    return audits


def build_overlay_assets(
    timeline_path: Path,
    timeline_bytes: bytes,
    timeline_sha256: str,
    output_directory: Path,
) -> dict[str, Any]:
    try:
        timeline = json.loads(timeline_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("attempt-005 timeline 不是有效 JSON") from error
    if not isinstance(timeline, dict):
        raise RuntimeError("attempt-005 timeline 顶层必须是对象")
    selected_cues = validate_timeline(timeline, timeline_path)
    all_cues = [
        cue_values(raw, index)
        for index, raw in enumerate(timeline["displayCues"], start=1)
    ]
    rolling_by_cue = rolling_layout_groups(all_cues)
    font_bytes = read_plain_bytes(BASE.FONT_PATH, "固定字幕字体")
    font_sha256 = hashlib.sha256(font_bytes).hexdigest()
    if font_sha256 != EXPECTED_FONT_SHA256:
        raise RuntimeError(
            "固定字幕字体 SHA-256 漂移："
            f"expected={EXPECTED_FONT_SHA256} actual={font_sha256}"
        )
    python_sha256 = file_sha256(Path(sys.executable).resolve())
    if python_sha256 != EXPECTED_RENDERER_PYTHON_SHA256:
        raise RuntimeError(
            "字幕渲染 Python SHA-256 漂移："
            f"expected={EXPECTED_RENDERER_PYTHON_SHA256} actual={python_sha256}"
        )
    selected_font = BASE.ImageFont.truetype(
        str(BASE.FONT_PATH), size=BASE.FONT_SIZE, index=BASE.FONT_INDEX
    )
    family, weight = selected_font.getname()
    if family != BASE.FONT_FAMILY or weight != BASE.FONT_WEIGHT:
        raise RuntimeError("字幕字体不再是固定 Hiragino Sans GB W3")
    all_timeline_rolling_audits = audit_all_timeline_rolling_layouts(
        all_cues, rolling_by_cue, selected_font
    )

    output_directory.parent.mkdir(parents=True, exist_ok=True)
    staging = output_directory.with_name(
        f".{output_directory.name}.part-{os.getpid()}-{uuid.uuid4().hex}"
    )
    staging.mkdir(parents=False, exist_ok=False)
    frames_directory = staging / "frames"
    frames_directory.mkdir()
    try:
        blank_image, blank_lines, blank_contract = BASE.render_text(None, selected_font)
        if blank_lines:
            raise RuntimeError("blank overlay 不得包含文字行")
        blank_path = staging / "blank.png"
        blank_image.save(blank_path, format="PNG", optimize=True)
        blank_inspection = BASE.inspect_png(blank_path, "proof blank PNG", allow_blank=True)

        cue_records: list[dict[str, Any]] = []
        cue_paths: dict[int, Path] = {}
        for cue in selected_cues:
            rolling_group = rolling_by_cue.get(cue["index"])
            if rolling_group:
                image, lines, contract, final_lines, fixed_anchor = render_text_on_final_layout(
                    cue["text"], rolling_group["finalText"], selected_font
                )
            else:
                image, lines, contract = BASE.render_text(cue["text"], selected_font)
                final_lines = lines
                fixed_anchor = None
            image_path = staging / f"cue-{cue['index']:03d}.png"
            image.save(image_path, format="PNG", optimize=True)
            inspection = BASE.inspect_png(
                image_path, f"proof cue-{cue['index']:03d}", allow_blank=False
            )
            if inspection["contract"] != contract:
                raise RuntimeError(f"cue-{cue['index']:03d} 保存前后 alpha 合同漂移")
            cue_paths[cue["index"]] = image_path
            clipped_start = max(cue["startFrame"], PROOF_START_FRAME)
            clipped_end = min(cue["endFrameExclusive"], PROOF_END_FRAME_EXCLUSIVE)
            cue_records.append(
                {
                    **cue,
                    "proofGlobalStartFrame": clipped_start,
                    "proofGlobalEndFrameExclusive": clipped_end,
                    "proofLocalStartFrame": clipped_start - PROOF_START_FRAME,
                    "proofLocalEndFrameExclusive": clipped_end - PROOF_START_FRAME,
                    "imageFile": image_path.name,
                    "imageSha256": inspection["sha256"],
                    "fontSize": BASE.FONT_SIZE,
                    "fontWeight": BASE.FONT_WEIGHT,
                    "lines": lines,
                    "provenance": "fresh-render-from-immutable-v004c-attempt-005",
                    "rollingLayout": None if rolling_group is None else {
                        **rolling_group,
                        "finalLines": final_lines,
                        "fixedFirstLineAnchor": fixed_anchor,
                        "prefixAnchoredToFinalExpandedCue": True,
                    },
                    **contract,
                }
            )

        rolling_records = [
            record for record in cue_records if record["rollingLayout"] is not None
        ]
        rolling_group_records = []
        for group_id in sorted({record["rollingLayout"]["id"] for record in rolling_records}):
            members = [
                record
                for record in rolling_records
                if record["rollingLayout"]["id"] == group_id
            ]
            members.sort(key=lambda record: record["index"])
            anchors = [record["rollingLayout"]["fixedFirstLineAnchor"] for record in members]
            stable_anchor = len({tuple(anchor) for anchor in anchors}) == 1
            rolling_group_records.append({
                "id": group_id,
                "cueIndexes": [record["index"] for record in members],
                "finalText": members[-1]["rollingLayout"]["finalText"],
                "finalLines": members[-1]["rollingLayout"]["finalLines"],
                "alphaTopLeftByCue": [
                    {"cueIndex": record["index"], "topLeft": record["alphaBoundingBox"][:2]}
                    for record in members
                ],
                "fixedFirstLineAnchorByCue": [
                    {
                        "cueIndex": record["index"],
                        "anchor": record["rollingLayout"]["fixedFirstLineAnchor"],
                    }
                    for record in members
                ],
                "prefixAnchorStable": stable_anchor,
            })

        owners: list[int | None] = []
        for local_frame in range(PROOF_FRAME_COUNT):
            global_frame = PROOF_START_FRAME + local_frame
            owners_here = [
                cue["index"]
                for cue in selected_cues
                if cue["startFrame"] <= global_frame < cue["endFrameExclusive"]
            ]
            if len(owners_here) > 1:
                raise RuntimeError(f"全局 frame {global_frame} 有重叠字幕")
            owner = owners_here[0] if owners_here else None
            owners.append(owner)
            source = blank_path if owner is None else cue_paths[owner]
            os.symlink(
                os.path.relpath(source, start=frames_directory),
                frames_directory / f"frame-{local_frame:05d}.png",
            )

        assertions = {
            "attempt005Only": True,
            "timelineHashLocked": timeline_sha256 == EXPECTED_TIMELINE_SHA256,
            "visualFitVerified": True,
            "acceptedPrefixCuePngsNotReused": True,
            "everySelectedCueFreshlyRendered": len(cue_records) == len(selected_cues),
            "allCueFontSizesExactly40": all(
                record["fontSize"] == 40 for record in cue_records
            ),
            "allCueFontWeightsW3": all(
                record["fontWeight"] == "W3" for record in cue_records
            ),
            "allCueBordersAbsent": all(
                record["borderAlphaMax"] == 0
                and record["containerLikeAlpha"] is False
                for record in cue_records
            ),
            "allCueAlphaInsideSafeArea": all(
                record["insideCaptionSafeArea"] is True for record in cue_records
            ),
            "blankFullyTransparent": blank_contract["alphaNonzeroPixels"] == 0,
            "localFrameSequenceExactly600": len(owners) == PROOF_FRAME_COUNT,
            "ownerFramesBoundInGlobalDomain": True,
            "rollingGroupsPresentInProof": len(rolling_group_records) > 0,
            "rollingPrefixesAnchoredToFinalExpandedLayout": all(
                group["prefixAnchorStable"] for group in rolling_group_records
            ),
            "allTimelineRollingGroupsExactlyS09AndS35": {
                audit["id"] for audit in all_timeline_rolling_audits
            } == {"S09:0-39", "S35:65-96"},
            "allTimelineRollingGeometryPassed": all(
                audit["passed"] for audit in all_timeline_rolling_audits
            ),
        }
        if not all(assertions.values()):
            raise RuntimeError(f"v004c proof overlay assertions failed: {assertions}")
        manifest = {
            "schemaVersion": "agent-skill-v004c-no-box-proof-overlay-v1",
            "status": "proof-input-only",
            "warning": "临时 Tingting 系统旁白 proof；不是最终真人录音，也不是十分钟成片验收。",
            "timeline": {
                "path": str(timeline_path),
                "sha256": timeline_sha256,
                "schemaVersion": timeline.get("schemaVersion"),
                "attempt": 5,
                "visualFitVerified": True,
                "publicationEligible": True,
                "measurementProvenance": "real-overlay-renderer",
                "testDouble": False,
            },
            "proofRange": {
                "startTimestamp": "05:36.000",
                "endTimestampExclusive": "05:56.000",
                "fps": FPS,
                "globalStartFrame": PROOF_START_FRAME,
                "globalEndFrameExclusive": PROOF_END_FRAME_EXCLUSIVE,
                "localStartFrame": 0,
                "localEndFrameExclusive": PROOF_FRAME_COUNT,
                "frameCount": PROOF_FRAME_COUNT,
                "frameOwnerDomain": "global-frame-index",
                "frameFileDomain": "proof-local-frame-index",
            },
            "style": {
                "width": BASE.WIDTH,
                "height": BASE.HEIGHT,
                "targetX": BASE.TARGET_X,
                "targetY": BASE.TARGET_Y,
                "background": "transparent",
                "noContainer": True,
                "fontPath": str(BASE.FONT_PATH),
                "fontIndex": BASE.FONT_INDEX,
                "fontFamily": family,
                "fontWeight": weight,
                "fontSize": BASE.FONT_SIZE,
                "fontSha256": font_sha256,
            },
            "reuse": {
                "historicalPrefixCount": 0,
                "historicalCuePngsReused": False,
                "allSelectedCuesFreshlyRendered": True,
                "renderTextImplementation": str(
                    absolute(Path(__file__).parents[2] / BASE_BUILDER_RELATIVE)
                ),
                "inspectPngImplementation": str(
                    absolute(Path(__file__).parents[2] / BASE_BUILDER_RELATIVE)
                ),
                "implementationSha256": hashlib.sha256(
                    BASE_BUILDER_SNAPSHOT
                ).hexdigest(),
                "pythonPath": str(Path(sys.executable).resolve()),
                "pythonSha256": python_sha256,
                "fontSha256": font_sha256,
            },
            "assertions": assertions,
            "displayCueCount": len(cue_records),
            "displayCues": cue_records,
            "rollingLayoutGroups": rolling_group_records,
            "allTimelineRollingLayoutAudits": all_timeline_rolling_audits,
            "captionFrameCount": sum(owner is not None for owner in owners),
            "blankFrameCount": sum(owner is None for owner in owners),
            "frameOwnerSha256": hashlib.sha256(
                json.dumps(owners, separators=(",", ":")).encode("utf-8")
            ).hexdigest(),
            "blankImageFile": blank_path.name,
            "blankImageSha256": blank_inspection["sha256"],
            "frameDirectory": "frames",
            "publication": {
                "strategy": "sibling-staging-atomic-no-replace",
                "overwritingAllowed": False,
            },
        }
        manifest_path = staging / MANIFEST_FILE_NAME
        with manifest_path.open("x", encoding="utf-8") as destination:
            json.dump(manifest, destination, ensure_ascii=False, indent=2)
            destination.write("\n")
        if read_plain_bytes(timeline_path, "attempt-005 timeline") != timeline_bytes:
            raise RuntimeError("attempt-005 timeline 在构建期间发生漂移")
        base_builder_path = absolute(Path(__file__).parents[2] / BASE_BUILDER_RELATIVE)
        if (
            read_plain_bytes(base_builder_path, "v004b 字幕渲染器")
            != BASE_BUILDER_SNAPSHOT
        ):
            raise RuntimeError("v004b 字幕渲染器在构建期间发生漂移")
        if read_plain_bytes(BASE.FONT_PATH, "固定字幕字体") != font_bytes:
            raise RuntimeError("固定字幕字体在构建期间发生漂移")
        if file_sha256(Path(sys.executable).resolve()) != python_sha256:
            raise RuntimeError("字幕渲染 Python 在构建期间发生漂移")
        atomic_rename_no_replace(staging, output_directory)
        return manifest
    except Exception:
        # Only the unpublished staging directory owned by this invocation may
        # be removed.  Existing proof versions and unrelated outputs are never
        # touched.
        if staging.exists() and not output_directory.exists():
            shutil.rmtree(staging)
        raise


def main() -> None:
    args = parse_args()
    timeline_path, output_directory = validate_fixed_arguments(args)
    timeline_bytes = read_plain_bytes(timeline_path, "immutable attempt-005 timeline")
    timeline_sha256 = hashlib.sha256(timeline_bytes).hexdigest()
    if timeline_sha256 != args.expected_timeline_sha256:
        raise RuntimeError(
            "attempt-005 timeline SHA-256 漂移："
            f"expected={args.expected_timeline_sha256} actual={timeline_sha256}"
        )
    manifest = build_overlay_assets(
        timeline_path, timeline_bytes, timeline_sha256, output_directory
    )
    manifest_path = output_directory / MANIFEST_FILE_NAME
    print(
        json.dumps(
            {
                "outputDirectory": str(output_directory),
                "manifestPath": str(manifest_path),
                "manifestSha256": file_sha256(manifest_path),
                "displayCueCount": manifest["displayCueCount"],
                "assertions": manifest["assertions"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
