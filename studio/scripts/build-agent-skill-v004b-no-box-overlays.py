from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import io
import json
import math
import os
import platform
import re
import shutil
import stat
import sys
import uuid
from pathlib import Path

import PIL
from PIL import Image, ImageDraw, ImageFilter, ImageFont


SCHEMA_VERSION = "agent-skill-v013-caption-overlay-v004b-no-box-v1"
FULL_FPS = 30
FULL_DURATION_SECONDS = 600
FULL_DURATION_IN_FRAMES = 18_000
REUSED_PREFIX_COUNT = 24
VIDEO_WIDTH = 1920
VIDEO_HEIGHT = 1080
FONT_PATH = Path("/System/Library/Fonts/Hiragino Sans GB.ttc")
FONT_INDEX = 0
FONT_FAMILY = "Hiragino Sans GB"
FONT_WEIGHT = "W3"
FONT_SIZE = 40
WIDTH = 1480
HEIGHT = 130
TARGET_X = 220
TARGET_Y = 870
SAFE_AREA = {"left": 96, "top": 810, "right": 1824, "bottom": 1000}
HORIZONTAL_PADDING = 56
VERTICAL_PADDING = 12
MAX_LINES = 2
TEXT_COLOR = (19, 34, 29, 255)
SHADOW_COLOR = (19, 34, 29, 38)
SHADOW_OFFSET = (1, 2)
SHADOW_BLUR = 2
HASH_PATTERN = re.compile(r"^[a-f0-9]{64}$")
ACCEPTED_PREFIX_SCHEMA_VERSION = (
    "agent-skill-v013-natural-technical-caption-overlay-v004b-no-box-proof"
)
ACCEPTED_PREFIX_STATUS = "proof-only"
READ_ONLY_FILE_MODE = 0o444
READ_ONLY_DIRECTORY_MODE = 0o555
FULL_OUTPUT_DIRECTORY_RELATIVE = Path(
    "outputs/studio/agent-skill-20260806/review-candidates/"
    "full-video-current-visual-upgrade-v014-natural-technical-"
    "v004b-no-box-overlay-input-v001"
)
FULL_TIMELINE_RELATIVE = Path(
    "studio/data/render-inputs/full-v004b-attempt-001/"
    "subtitle-timeline-v004-full.json"
)


def sha256_argument(value: str) -> str:
    if not HASH_PATTERN.fullmatch(value):
        raise argparse.ArgumentTypeError("必须是 64 位小写 SHA-256")
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build non-overwriting v004b no-box caption PNG overlays."
    )
    parser.add_argument("--timeline", required=True, type=Path)
    parser.add_argument(
        "--expected-timeline-sha256", required=True, type=sha256_argument
    )
    parser.add_argument("--output-directory", required=True, type=Path)
    parser.add_argument("--accepted-prefix-manifest", required=True, type=Path)
    parser.add_argument(
        "--expected-accepted-prefix-manifest-sha256",
        required=True,
        type=sha256_argument,
    )
    parser.add_argument("--accepted-prefix-directory", required=True, type=Path)
    parser.add_argument("--fps", default=FULL_FPS, type=int)
    parser.add_argument(
        "--duration-in-frames", default=FULL_DURATION_IN_FRAMES, type=int
    )
    parser.add_argument(
        "--duration-seconds", default=FULL_DURATION_SECONDS, type=int
    )
    parser.add_argument(
        "--reuse-prefix-count", default=REUSED_PREFIX_COUNT, type=int
    )
    parser.add_argument("--mode", choices=("full", "dry-test"), default="full")
    return parser.parse_args()


def absolute_path(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def read_plain_bytes(path: Path, label: str = "文件") -> bytes:
    try:
        details = path.lstat()
    except OSError as error:
        raise RuntimeError(f"{label} 不可读取：{path}") from error
    if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode):
        raise RuntimeError(f"{label} 必须是普通文件且不能是符号链接：{path}")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise RuntimeError(f"{label} 必须是普通文件且不能是符号链接：{path}") from error
    try:
        opened_details = os.fstat(descriptor)
        if not stat.S_ISREG(opened_details.st_mode):
            raise RuntimeError(f"{label} 必须是普通文件：{path}")
        with os.fdopen(descriptor, "rb", closefd=False) as source:
            return source.read()
    finally:
        os.close(descriptor)


def file_sha256(path: Path) -> str:
    return hashlib.sha256(read_plain_bytes(path)).hexdigest()


def stable_json_sha256(value: object) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def read_json_snapshot(
    path: Path, label: str, expected_sha256: str
) -> dict[str, object]:
    raw_bytes = read_plain_bytes(path, label)
    actual_sha256 = hashlib.sha256(raw_bytes).hexdigest()
    if actual_sha256 != expected_sha256:
        raise RuntimeError(
            f"{label} SHA-256 与冻结值不一致：expected={expected_sha256} "
            f"actual={actual_sha256}"
        )
    try:
        value = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"{label} 不是有效 JSON：{path}") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{label} 顶层必须是对象：{path}")
    return {
        "path": path,
        "bytes": raw_bytes,
        "sha256": actual_sha256,
        "value": value,
    }


def assert_snapshot_unchanged(snapshot: dict[str, object], label: str) -> None:
    current_bytes = read_plain_bytes(Path(snapshot["path"]), label)
    if current_bytes != snapshot["bytes"]:
        raise RuntimeError(f"{label} 在构建期间发生漂移，拒绝发布")


def assert_plain_directory(path: Path, label: str) -> None:
    try:
        details = path.lstat()
    except OSError as error:
        raise RuntimeError(f"{label} 不可读取：{path}") from error
    if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode):
        raise RuntimeError(f"{label} 必须是普通目录且不能是符号链接：{path}")


def atomic_rename_no_replace(source: Path, target: Path) -> None:
    if target.exists() or target.is_symlink():
        raise RuntimeError(f"拒绝覆盖既有字幕图层目录：{target}")
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
        raise RuntimeError(
            "当前平台没有受支持的原子 no-replace 目录发布原语，拒绝降级覆盖"
        )
    if result == 0:
        return
    error_number = ctypes.get_errno()
    if error_number in (errno.EEXIST, errno.ENOTEMPTY):
        raise RuntimeError(f"拒绝覆盖既有字幕图层目录：{target}")
    raise OSError(
        error_number,
        f"原子发布字幕图层目录失败：{os.strerror(error_number)}",
        os.fspath(target),
    )


def assert_inside(parent: Path, child: Path, label: str) -> None:
    try:
        child.relative_to(parent)
    except ValueError as error:
        raise RuntimeError(f"{label} 越出允许目录：{child}") from error


def tokens(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9_.-]+|\s+|.", text, flags=re.DOTALL)


def text_width(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont
) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def balanced_two_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    max_width: int,
) -> list[str] | None:
    parts = tokens(text)
    prohibited_line_starts = set("，。！？；：、,.!?;:%）】》」』")
    prohibited_line_ends = set("（【《「『")
    semantic_break_marks = set("，。！？；：、,.!?;:")
    candidates: list[tuple[int, int, int, list[str]]] = []
    for split_at in range(1, len(parts)):
        first = "".join(parts[:split_at]).strip()
        second = "".join(parts[split_at:]).strip()
        if not first or not second:
            continue
        if second[0] in prohibited_line_starts or first[-1] in prohibited_line_ends:
            continue
        first_width = text_width(draw, first, font)
        second_width = text_width(draw, second, font)
        if first_width > max_width or second_width > max_width:
            continue
        candidates.append(
            (
                0 if first[-1] in semantic_break_marks else 1,
                abs(first_width - second_width),
                max(first_width, second_width),
                [first, second],
            )
        )
    if not candidates:
        return None
    return min(candidates, key=lambda candidate: candidate[:3])[3]


def wrap_text(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont
) -> list[str]:
    max_width = WIDTH - 2 * HORIZONTAL_PADDING
    if text_width(draw, text, font) <= max_width:
        return [text]
    return balanced_two_lines(draw, text, font, max_width) or []


def alpha_contract(image: Image.Image, *, allow_blank: bool) -> dict[str, object]:
    if image.mode != "RGBA" or image.size != (WIDTH, HEIGHT):
        raise RuntimeError(
            f"字幕 PNG 必须是 RGBA {WIDTH}x{HEIGHT}，实际 {image.mode} {image.size}"
        )
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    histogram = alpha.histogram()
    nonzero_pixels = sum(histogram[1:])
    opaque_pixels = histogram[255]
    coverage = nonzero_pixels / (WIDTH * HEIGHT)
    border_pixels = list(alpha.crop((0, 0, WIDTH, 1)).get_flattened_data())
    border_pixels += list(
        alpha.crop((0, HEIGHT - 1, WIDTH, HEIGHT)).get_flattened_data()
    )
    border_pixels += list(alpha.crop((0, 0, 1, HEIGHT)).get_flattened_data())
    border_pixels += list(
        alpha.crop((WIDTH - 1, 0, WIDTH, HEIGHT)).get_flattened_data()
    )
    border_alpha_max = max(border_pixels, default=0)
    near_full_width_rows = 0
    max_horizontal_alpha_run = 0
    max_horizontal_strong_alpha_run = 0
    strong_alpha_pixels = 0
    strong_alpha_threshold = 192
    alpha_bytes = alpha.tobytes()
    for y in range(HEIGHT):
        row = alpha_bytes[y * WIDTH : (y + 1) * WIDTH]
        if sum(value > 0 for value in row) >= WIDTH * 0.90:
            near_full_width_rows += 1
        current_run = 0
        current_strong_run = 0
        for value in row:
            if value > 0:
                current_run += 1
                max_horizontal_alpha_run = max(
                    max_horizontal_alpha_run, current_run
                )
            else:
                current_run = 0
            if value >= strong_alpha_threshold:
                strong_alpha_pixels += 1
                current_strong_run += 1
                max_horizontal_strong_alpha_run = max(
                    max_horizontal_strong_alpha_run, current_strong_run
                )
            else:
                current_strong_run = 0

    alpha_fill_ratio_within_bbox = 0.0
    strong_alpha_fill_ratio_within_bbox = 0.0
    container_like_alpha = False
    if bbox is not None:
        glyph_width = bbox[2] - bbox[0]
        glyph_height = bbox[3] - bbox[1]
        bbox_area = glyph_width * glyph_height
        alpha_fill_ratio_within_bbox = nonzero_pixels / bbox_area
        strong_alpha_fill_ratio_within_bbox = strong_alpha_pixels / bbox_area
        long_run_threshold = max(FONT_SIZE * 4, math.ceil(glyph_width * 0.65))
        container_like_alpha = (
            glyph_width >= FONT_SIZE * 4
            and glyph_height >= FONT_SIZE * 0.70
            and (
                strong_alpha_fill_ratio_within_bbox >= 0.72
                or max_horizontal_strong_alpha_run >= long_run_threshold
            )
        )

    if allow_blank:
        if (
            bbox is not None
            or nonzero_pixels != 0
            or border_alpha_max != 0
            or near_full_width_rows != 0
        ):
            raise RuntimeError("blank overlay 必须全透明")
    else:
        if bbox is None or nonzero_pixels == 0:
            raise RuntimeError("字幕图层没有 glyph alpha")
        glyph_width = bbox[2] - bbox[0]
        glyph_height = bbox[3] - bbox[1]
        if glyph_width >= WIDTH * 0.94 or glyph_height >= HEIGHT * 0.86:
            raise RuntimeError(f"alpha 超出 glyph 邻域：bbox={bbox}")
        if coverage >= 0.30:
            raise RuntimeError(f"alpha 覆盖率像容器而不是文字：{coverage}")
        if border_alpha_max != 0:
            raise RuntimeError("图层边缘出现 alpha，疑似边框或背景容器")
        if near_full_width_rows != 0:
            raise RuntimeError("图层出现近全宽 alpha 行，疑似矩形轮廓")
        if container_like_alpha:
            raise RuntimeError(
                "图层 alpha 呈现内部矩形/容器，不是透明纯文字："
                f"strongFill={strong_alpha_fill_ratio_within_bbox} "
                f"maxStrongRun={max_horizontal_strong_alpha_run}"
            )

    global_bbox = None
    if bbox is not None:
        global_bbox = [
            TARGET_X + bbox[0],
            TARGET_Y + bbox[1],
            TARGET_X + bbox[2],
            TARGET_Y + bbox[3],
        ]
        if not (
            global_bbox[0] >= SAFE_AREA["left"]
            and global_bbox[1] >= SAFE_AREA["top"]
            and global_bbox[2] <= SAFE_AREA["right"]
            and global_bbox[3] <= SAFE_AREA["bottom"]
        ):
            raise RuntimeError(f"glyph alpha 越出字幕安全区：{global_bbox}")

    return {
        "alphaBoundingBox": list(bbox) if bbox is not None else None,
        "globalAlphaBoundingBox": global_bbox,
        "alphaNonzeroPixels": nonzero_pixels,
        "alphaOpaquePixels": opaque_pixels,
        "alphaCoverageRatio": coverage,
        "borderAlphaMax": border_alpha_max,
        "nearFullWidthAlphaRows": near_full_width_rows,
        "maxHorizontalAlphaRun": max_horizontal_alpha_run,
        "maxHorizontalStrongAlphaRun": max_horizontal_strong_alpha_run,
        "alphaFillRatioWithinBoundingBox": alpha_fill_ratio_within_bbox,
        "strongAlphaFillRatioWithinBoundingBox": (
            strong_alpha_fill_ratio_within_bbox
        ),
        "containerLikeAlpha": container_like_alpha,
        "insideCaptionSafeArea": global_bbox is None
        or (
            global_bbox[0] >= SAFE_AREA["left"]
            and global_bbox[1] >= SAFE_AREA["top"]
            and global_bbox[2] <= SAFE_AREA["right"]
            and global_bbox[3] <= SAFE_AREA["bottom"]
        ),
    }


def inspect_png(
    path: Path, label: str, *, allow_blank: bool
) -> dict[str, object]:
    raw_bytes = read_plain_bytes(path, label)
    try:
        with Image.open(io.BytesIO(raw_bytes)) as source_image:
            image_format = source_image.format
            source_image.load()
            image = source_image.copy()
    except (OSError, ValueError) as error:
        raise RuntimeError(f"{label} 不是可完整解码的 PNG：{path}") from error
    if image_format != "PNG":
        raise RuntimeError(f"{label} 必须是真实 PNG，实际格式：{image_format}")
    contract = alpha_contract(image, allow_blank=allow_blank)
    return {
        "bytes": raw_bytes,
        "sha256": hashlib.sha256(raw_bytes).hexdigest(),
        "contract": contract,
    }


def render_text(
    text: str | None, font: ImageFont.FreeTypeFont
) -> tuple[Image.Image, list[str], dict[str, object]]:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    if text is None:
        return image, [], alpha_contract(image, allow_blank=True)
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        raise RuntimeError("字幕文本不能为空")
    measurement = ImageDraw.Draw(image)
    lines = wrap_text(measurement, normalized, font)
    if not lines or len(lines) > MAX_LINES:
        raise RuntimeError(f"字幕不能以固定 40px W3 在两行内排下：{normalized}")
    boxes = [measurement.textbbox((0, 0), line, font=font) for line in lines]
    heights = [box[3] - box[1] for box in boxes]
    total_height = sum(heights) + max(0, len(lines) - 1) * 10
    if total_height > HEIGHT - 2 * VERTICAL_PADDING:
        raise RuntimeError(f"固定 40px W3 字幕垂直溢出：{normalized}")

    shadow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    text_draw = ImageDraw.Draw(image)
    cursor_y = (HEIGHT - total_height) / 2
    for line, box, line_height in zip(lines, boxes, heights):
        line_width = box[2] - box[0]
        x = (WIDTH - line_width) / 2 - box[0]
        y = cursor_y - box[1]
        shadow_draw.text(
            (x + SHADOW_OFFSET[0], y + SHADOW_OFFSET[1]),
            line,
            font=font,
            fill=SHADOW_COLOR,
        )
        text_draw.text((x, y), line, font=font, fill=TEXT_COLOR)
        cursor_y += line_height + 10
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=SHADOW_BLUR))
    image = Image.alpha_composite(shadow, image)
    return image, lines, alpha_contract(image, allow_blank=False)


def validate_overlay_geometry() -> None:
    if not (
        TARGET_X >= SAFE_AREA["left"]
        and TARGET_Y >= SAFE_AREA["top"]
        and TARGET_X + WIDTH <= SAFE_AREA["right"]
        and TARGET_Y + HEIGHT <= SAFE_AREA["bottom"]
    ):
        raise RuntimeError("字幕 overlay 画布越出固定安全区")
    if TARGET_X + WIDTH > VIDEO_WIDTH or TARGET_Y + HEIGHT > VIDEO_HEIGHT:
        raise RuntimeError("字幕 overlay 画布越出视频画面")


def validate_prefix_manifest(
    manifest: dict[str, object], prefix_count: int, font_sha256: str
) -> list[dict[str, object]]:
    if manifest.get("schemaVersion") != ACCEPTED_PREFIX_SCHEMA_VERSION:
        raise RuntimeError("accepted prefix schemaVersion 不匹配")
    if manifest.get("status") != ACCEPTED_PREFIX_STATUS:
        raise RuntimeError("accepted prefix status 必须是 proof-only")
    if type(manifest.get("fps")) is not int or manifest.get("fps") != FULL_FPS:
        raise RuntimeError("accepted prefix fps 必须严格为 30")
    overlay = manifest.get("overlay")
    assertions = manifest.get("assertions")
    records = manifest.get("displayCues")
    if not isinstance(overlay, dict) or not isinstance(assertions, dict):
        raise RuntimeError("accepted prefix manifest 缺少 overlay/assertions")
    expected_style = {
        "width": WIDTH,
        "height": HEIGHT,
        "targetX": TARGET_X,
        "targetY": TARGET_Y,
        "background": "transparent",
        "backgroundAlpha": 0,
        "fill": None,
        "outline": None,
        "borderWidth": 0,
        "rectangle": False,
        "noContainer": True,
        "fontSize": FONT_SIZE,
        "fontFamily": FONT_FAMILY,
    }
    for key, value in expected_style.items():
        if overlay.get(key) != value:
            raise RuntimeError(f"accepted prefix 样式不匹配：{key}")
    for key in (
        "blankFullyTransparent",
        "allCueFontSizesExactly40",
        "allCueBordersAbsent",
        "allAlphaLocalizedNearGlyphs",
        "noContainer",
    ):
        if assertions.get(key) is not True:
            raise RuntimeError(f"accepted prefix alpha/style 门禁未通过：{key}")
    for optional_assertion in (
        "allCueAlphaInsideSafeArea",
        "allCuePngsRgba1480x130",
    ):
        if (
            optional_assertion in assertions
            and assertions.get(optional_assertion) is not True
        ):
            raise RuntimeError(
                f"accepted prefix 可选门禁明确失败：{optional_assertion}"
            )
    declared_font_index = manifest.get("fontIndex", overlay.get("fontIndex"))
    if declared_font_index is not None and (
        type(declared_font_index) is not int or declared_font_index != FONT_INDEX
    ):
        raise RuntimeError("accepted prefix fontIndex 与固定 index 0 不一致")
    declared_font_weight = manifest.get(
        "fontWeight", overlay.get("fontWeight")
    )
    if declared_font_weight is not None and declared_font_weight != FONT_WEIGHT:
        raise RuntimeError("accepted prefix fontWeight 与固定 W3 不一致")
    if manifest.get("fontSha256") != font_sha256:
        raise RuntimeError("accepted prefix 字体哈希与当前 W3 字体不一致")
    if (
        not isinstance(records, list)
        or len(records) != prefix_count
        or manifest.get("displayCueCount", len(records)) != prefix_count
    ):
        raise RuntimeError(f"accepted prefix 必须恰好包含 {prefix_count} 条")
    result: list[dict[str, object]] = []
    for index, record in enumerate(records[:prefix_count], start=1):
        if not isinstance(record, dict) or record.get("index") != index:
            raise RuntimeError("accepted prefix cue 编号必须从 1 连续递增")
        if not HASH_PATTERN.fullmatch(str(record.get("imageSha256", ""))):
            raise RuntimeError(f"accepted prefix cue-{index:03d} 缺少有效哈希")
        result.append(record)
    return result


def cue_values(cue: object, expected_index: int) -> dict[str, object]:
    if not isinstance(cue, dict):
        raise RuntimeError(f"第 {expected_index} 条字幕必须是对象")
    index = cue.get("index")
    text_value = cue.get("text")
    start = cue.get("start")
    end = cue.get("end")
    start_frame = cue.get("startFrame")
    end_frame = cue.get("endFrameExclusive")
    if type(index) is not int:
        raise RuntimeError(f"第 {expected_index} 条字幕 index 必须是整数")
    if not isinstance(text_value, str):
        raise RuntimeError(f"第 {expected_index} 条字幕文本必须是字符串")
    # Keep the timeline text byte-for-byte in the published manifest. Rendering
    # normalizes whitespace inside render_text(), but the final-candidate gate
    # must still be able to bind every cue back to the frozen timeline exactly.
    text = text_value
    if (
        isinstance(start, bool)
        or not isinstance(start, (int, float))
        or isinstance(end, bool)
        or not isinstance(end, (int, float))
    ):
        raise RuntimeError(f"第 {expected_index} 条字幕 start/end 必须是数值")
    if type(start_frame) is not int or type(end_frame) is not int:
        raise RuntimeError(f"第 {expected_index} 条字幕帧必须是整数")
    if index != expected_index:
        raise RuntimeError("字幕 cue 编号必须从 1 连续递增")
    if not text.strip() or not math.isfinite(start) or not math.isfinite(end) or end <= start:
        raise RuntimeError(f"第 {index} 条字幕文本/时间无效")
    return {
        "index": index,
        "text": text,
        "start": start,
        "end": end,
        "startFrame": start_frame,
        "endFrameExclusive": end_frame,
    }


def plain_png_child(directory: Path, value: object, label: str) -> Path:
    if not isinstance(value, str) or not value or Path(value).name != value:
        raise RuntimeError(f"{label} 必须是目录内的单一 PNG 文件名")
    if Path(value).suffix.lower() != ".png":
        raise RuntimeError(f"{label} 必须使用 .png 扩展名")
    child = absolute_path(directory / value)
    assert_inside(directory, child, label)
    return child


def set_and_verify_mode(path: Path, mode: int, label: str) -> None:
    os.chmod(path, mode, follow_symlinks=False)
    actual_mode = stat.S_IMODE(path.lstat().st_mode)
    if actual_mode != mode:
        raise RuntimeError(
            f"{label} 权限固定失败：expected={oct(mode)} actual={oct(actual_mode)}"
        )


def strict_manifest_number(
    manifest: dict[str, object], key: str, expected: int, label: str
) -> None:
    if type(manifest.get(key)) is not int or manifest.get(key) != expected:
        raise RuntimeError(f"{label} {key} 必须严格等于 {expected}")


def main() -> None:
    args = parse_args()
    timeline_path = absolute_path(args.timeline)
    output_directory = absolute_path(args.output_directory)
    prefix_manifest_path = absolute_path(args.accepted_prefix_manifest)
    prefix_directory = absolute_path(args.accepted_prefix_directory)
    workspace_root = absolute_path(Path(__file__).parents[2])
    expected_full_output_directory = absolute_path(
        workspace_root / FULL_OUTPUT_DIRECTORY_RELATIVE
    )
    expected_full_timeline = absolute_path(workspace_root / FULL_TIMELINE_RELATIVE)
    if output_directory.exists():
        raise RuntimeError(f"拒绝覆盖既有字幕图层目录：{output_directory}")
    if args.fps <= 0 or args.duration_in_frames <= 0 or args.duration_seconds <= 0:
        raise RuntimeError("fps、帧数和秒数必须为正数")
    if args.duration_in_frames != args.fps * args.duration_seconds:
        raise RuntimeError("duration-in-frames 必须等于 fps × duration-seconds")
    if args.reuse_prefix_count != REUSED_PREFIX_COUNT:
        raise RuntimeError("v004b 必须逐文件复用恰好前 24 个 accepted cue PNG")
    if args.mode == "full" and (
        args.fps != FULL_FPS
        or args.duration_in_frames != FULL_DURATION_IN_FRAMES
        or args.duration_seconds != FULL_DURATION_SECONDS
    ):
        raise RuntimeError("full 模式必须恰好为 30fps / 18000 帧 / 600 秒")
    if args.mode == "full" and output_directory != expected_full_output_directory:
        raise RuntimeError(
            "full 模式必须使用独立固定 overlay input 目录："
            f"{expected_full_output_directory}"
        )
    if args.mode == "full" and timeline_path != expected_full_timeline:
        raise RuntimeError(
            "full 模式必须使用稳定 worktree 的冻结 timeline："
            f"{expected_full_timeline}"
        )
    validate_overlay_geometry()

    script_path = absolute_path(Path(__file__))
    script_bytes = read_plain_bytes(script_path, "overlay builder 源码")
    script_snapshot = {
        "path": script_path,
        "bytes": script_bytes,
        "sha256": hashlib.sha256(script_bytes).hexdigest(),
    }
    timeline_snapshot = read_json_snapshot(
        timeline_path, "字幕时间线", args.expected_timeline_sha256
    )
    prefix_manifest_snapshot = read_json_snapshot(
        prefix_manifest_path,
        "accepted prefix manifest",
        args.expected_accepted_prefix_manifest_sha256,
    )
    timeline = timeline_snapshot["value"]
    prefix_manifest = prefix_manifest_snapshot["value"]
    display_cues = timeline.get("displayCues")
    if not isinstance(display_cues, list) or len(display_cues) < args.reuse_prefix_count:
        raise RuntimeError("时间线必须至少包含 accepted 的前 24 条 displayCues")
    strict_manifest_number(timeline, "fps", args.fps, "字幕时间线")
    strict_manifest_number(
        timeline, "durationInFrames", args.duration_in_frames, "字幕时间线"
    )
    strict_manifest_number(
        timeline, "durationSeconds", args.duration_seconds, "字幕时间线"
    )

    font_bytes = read_plain_bytes(FONT_PATH, "固定字幕字体")
    font_snapshot = {
        "path": FONT_PATH,
        "bytes": font_bytes,
        "sha256": hashlib.sha256(font_bytes).hexdigest(),
    }
    selected_font = ImageFont.truetype(
        str(FONT_PATH), size=FONT_SIZE, index=FONT_INDEX
    )
    family, weight = selected_font.getname()
    if family != FONT_FAMILY or weight != FONT_WEIGHT:
        raise RuntimeError(f"固定字体必须是 {FONT_FAMILY} {FONT_WEIGHT}，实际 {family} {weight}")
    font_sha256 = str(font_snapshot["sha256"])
    prefix_records = validate_prefix_manifest(
        prefix_manifest, args.reuse_prefix_count, font_sha256
    )
    assert_plain_directory(prefix_directory, "accepted prefix directory")

    prefix_blank = plain_png_child(
        prefix_directory,
        prefix_manifest.get("blankImageFile"),
        "accepted blank PNG",
    )
    prefix_blank_inspection = inspect_png(
        prefix_blank, "accepted blank PNG", allow_blank=True
    )
    expected_blank_sha256 = prefix_manifest.get("blankImageSha256")
    if (
        not isinstance(expected_blank_sha256, str)
        or not HASH_PATTERN.fullmatch(expected_blank_sha256)
        or prefix_blank_inspection["sha256"] != expected_blank_sha256
    ):
        raise RuntimeError("accepted blank PNG SHA-256 与 manifest 不一致")

    parsed_cues: list[dict[str, object]] = []
    frame_owner: list[int | None] = [None] * args.duration_in_frames
    for position, raw_cue in enumerate(display_cues, start=1):
        cue = cue_values(raw_cue, position)
        start_frame = cue["startFrame"]
        end_frame = cue["endFrameExclusive"]
        if (
            start_frame < 0
            or end_frame > args.duration_in_frames
            or end_frame <= start_frame
        ):
            raise RuntimeError(f"第 {position} 条字幕帧范围无效")
        if abs(start_frame / args.fps - float(cue["start"])) > 1 / args.fps + 1e-6:
            raise RuntimeError(f"第 {position} 条字幕 start/startFrame 不一致")
        if abs(end_frame / args.fps - float(cue["end"])) > 1 / args.fps + 1e-6:
            raise RuntimeError(f"第 {position} 条字幕 end/endFrameExclusive 不一致")
        for frame in range(start_frame, end_frame):
            if frame_owner[frame] is not None:
                raise RuntimeError(f"第 {position} 条字幕重叠于 frame {frame}")
            frame_owner[frame] = position
        parsed_cues.append(cue)

    prefix_assets: list[dict[str, object]] = []
    for position, (cue, accepted_raw) in enumerate(
        zip(parsed_cues[: args.reuse_prefix_count], prefix_records), start=1
    ):
        accepted = cue_values(accepted_raw, position)
        for field in ("text", "startFrame", "endFrameExclusive"):
            if cue[field] != accepted[field]:
                raise RuntimeError(f"第 {position} 条字幕偏离 accepted prefix：{field}")
        for field in ("start", "end"):
            if abs(float(cue[field]) - float(accepted[field])) > 1e-6:
                raise RuntimeError(f"第 {position} 条字幕偏离 accepted prefix：{field}")
        source_image_path = plain_png_child(
            prefix_directory,
            accepted_raw.get("imageFile"),
            f"accepted cue-{position:03d} PNG",
        )
        inspection = inspect_png(
            source_image_path,
            f"accepted cue-{position:03d} PNG",
            allow_blank=False,
        )
        expected_sha256 = accepted_raw.get("imageSha256")
        if inspection["sha256"] != expected_sha256:
            raise RuntimeError(f"accepted cue-{position:03d} PNG 哈希已漂移")
        lines = accepted_raw.get("lines")
        if (
            not isinstance(lines, list)
            or not 1 <= len(lines) <= MAX_LINES
            or not all(isinstance(line, str) and line.strip() for line in lines)
        ):
            raise RuntimeError(f"accepted cue-{position:03d} 缺少有效换行记录")
        prefix_assets.append(
            {
                "path": source_image_path,
                "sha256": expected_sha256,
                "lines": lines,
                "contract": inspection["contract"],
            }
        )

    output_directory.parent.mkdir(parents=True, exist_ok=True)
    assert_plain_directory(output_directory.parent, "字幕图层输出父目录")
    if output_directory.exists() or output_directory.is_symlink():
        raise RuntimeError(f"拒绝覆盖既有字幕图层目录：{output_directory}")
    staging_directory = output_directory.with_name(
        f".{output_directory.name}.part-{os.getpid()}-{uuid.uuid4().hex}"
    )
    staging_directory.mkdir(parents=False, exist_ok=False)
    frame_directory = staging_directory / "frames"
    frame_directory.mkdir()

    blank_path = staging_directory / "blank.png"
    current_prefix_blank = inspect_png(
        prefix_blank, "accepted blank PNG before copy", allow_blank=True
    )
    if current_prefix_blank["sha256"] != expected_blank_sha256:
        raise RuntimeError("accepted blank PNG 在复制前发生漂移")
    shutil.copyfile(prefix_blank, blank_path)
    blank_inspection = inspect_png(blank_path, "copied blank PNG", allow_blank=True)
    if blank_inspection["sha256"] != expected_blank_sha256:
        raise RuntimeError("accepted blank PNG 复制后哈希不一致")
    blank_contract = blank_inspection["contract"]

    cue_records: list[dict[str, object]] = []
    reused_hashes: list[str] = []
    for position, cue in enumerate(parsed_cues, start=1):
        start_frame = cue["startFrame"]
        end_frame = cue["endFrameExclusive"]

        output_image = staging_directory / f"cue-{position:03d}.png"
        if position <= args.reuse_prefix_count:
            prefix_asset = prefix_assets[position - 1]
            source_image_path = prefix_asset["path"]
            expected_sha256 = prefix_asset["sha256"]
            current_source = inspect_png(
                source_image_path,
                f"accepted cue-{position:03d} PNG before copy",
                allow_blank=False,
            )
            if current_source["sha256"] != expected_sha256:
                raise RuntimeError(
                    f"accepted cue-{position:03d} PNG 在复制前发生漂移"
                )
            shutil.copyfile(source_image_path, output_image)
            output_inspection = inspect_png(
                output_image, f"copied cue-{position:03d} PNG", allow_blank=False
            )
            copied_sha256 = output_inspection["sha256"]
            if copied_sha256 != expected_sha256:
                raise RuntimeError(f"cue-{position:03d} 未逐字节复用 accepted PNG")
            contract = output_inspection["contract"]
            lines = prefix_asset["lines"]
            provenance = "byte-exact-accepted-v004b-proof"
            reused_hashes.append(copied_sha256)
        else:
            image, lines, contract = render_text(cue["text"], selected_font)
            image.save(output_image, format="PNG", optimize=True)
            generated_inspection = inspect_png(
                output_image, f"generated cue-{position:03d} PNG", allow_blank=False
            )
            copied_sha256 = generated_inspection["sha256"]
            contract = generated_inspection["contract"]
            provenance = "generated-with-accepted-v004b-style"

        cue_records.append(
            {
                **cue,
                "frameCount": end_frame - start_frame,
                "fontSize": FONT_SIZE,
                "fontWeight": FONT_WEIGHT,
                "lines": lines,
                "imageFile": output_image.name,
                "imageSha256": copied_sha256,
                "provenance": provenance,
                **contract,
            }
        )

    image_by_index = {
        int(record["index"]): staging_directory / str(record["imageFile"])
        for record in cue_records
    }
    for frame, owner in enumerate(frame_owner):
        source = blank_path if owner is None else image_by_index[owner]
        os.symlink(
            os.path.relpath(source, start=frame_directory),
            frame_directory / f"frame-{frame:05d}.png",
        )

    prefix_pngs_byte_exact = (
        len(reused_hashes) == args.reuse_prefix_count
        and all(
            reused_hashes[index] == prefix_records[index]["imageSha256"]
            for index in range(args.reuse_prefix_count)
        )
    )
    declared_font_index = prefix_manifest.get(
        "fontIndex", prefix_manifest.get("overlay", {}).get("fontIndex")
    )
    declared_font_weight = prefix_manifest.get(
        "fontWeight", prefix_manifest.get("overlay", {}).get("fontWeight")
    )
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "status": "full-input" if args.mode == "full" else "dry-test",
        "warning": "字幕为透明纯文字外置层；本构建不声明最终视频或真人录音已验收。",
        "builder": {
            "scriptPath": str(script_path),
            "scriptSha256": script_snapshot["sha256"],
        },
        "parameters": {
            "mode": args.mode,
            "fps": args.fps,
            "durationSeconds": args.duration_seconds,
            "durationInFrames": args.duration_in_frames,
            "reusePrefixCount": args.reuse_prefix_count,
        },
        "timeline": {
            "path": str(timeline_path),
            "sha256": timeline_snapshot["sha256"],
        },
        "timelinePath": str(timeline_path),
        "timelineSha256": timeline_snapshot["sha256"],
        "acceptedPrefix": {
            "manifestPath": str(prefix_manifest_path),
            "manifestSha256": prefix_manifest_snapshot["sha256"],
            "directory": str(prefix_directory),
            "reusePrefixCount": args.reuse_prefix_count,
            "cuePngSha256": reused_hashes,
            "allCuePngByteExact": prefix_pngs_byte_exact,
            "blankPngByteExact": blank_inspection["sha256"]
            == expected_blank_sha256,
            "verification": {
                "proofSchemaVersion": prefix_manifest.get("schemaVersion"),
                "proofStatus": prefix_manifest.get("status"),
                "proofDeclaredFontIndex": declared_font_index,
                "proofDeclaredFontWeight": declared_font_weight,
                "proofDeclaredFontIdentityComplete": declared_font_index
                is not None
                and declared_font_weight is not None,
                "fontIdentityReverified": FONT_INDEX == 0
                and family == FONT_FAMILY
                and weight == FONT_WEIGHT
                and prefix_manifest.get("fontSha256") == font_sha256,
                "fontIdentityEvidence": (
                    "fixed-index-0-runtime-getname-W3-plus-frozen-proof-font-sha256"
                ),
                "proofSafeAreaAssertionsPresent": all(
                    key in prefix_manifest.get("assertions", {})
                    for key in (
                        "allCueAlphaInsideSafeArea",
                        "allCuePngsRgba1480x130",
                    )
                ),
                "actualPngsReverified": len(prefix_assets)
                == args.reuse_prefix_count,
                "actualPngsOrdinaryNonSymlink": True,
                "actualPngFormatPng": True,
                "actualPngRgba1480x130": True,
                "actualPngAlphaAndSafeAreaReverified": all(
                    asset["contract"]["insideCaptionSafeArea"] is True
                    and asset["contract"]["containerLikeAlpha"] is False
                    for asset in prefix_assets
                ),
            },
        },
        "runtime": {
            "pythonVersion": platform.python_version(),
            "pillowVersion": PIL.__version__,
        },
        "fontPath": str(FONT_PATH),
        "fontIndex": FONT_INDEX,
        "fontFamily": FONT_FAMILY,
        "fontWeight": FONT_WEIGHT,
        "fontSha256": font_sha256,
        "fps": args.fps,
        "durationSeconds": args.duration_seconds,
        "durationInFrames": args.duration_in_frames,
        "video": {"width": VIDEO_WIDTH, "height": VIDEO_HEIGHT},
        "safeArea": SAFE_AREA,
        "overlay": {
            "width": WIDTH,
            "height": HEIGHT,
            "targetX": TARGET_X,
            "targetY": TARGET_Y,
            "background": "transparent",
            "backgroundAlpha": 0,
            "fill": None,
            "outline": None,
            "borderWidth": 0,
            "rectangle": False,
            "noContainer": True,
            "text": "rgba(19,34,29,255)",
            "fontSize": FONT_SIZE,
            "fontFamily": FONT_FAMILY,
            "fontWeight": FONT_WEIGHT,
            "shadow": {
                "color": "rgba(19,34,29,38)",
                "offset": list(SHADOW_OFFSET),
                "blur": SHADOW_BLUR,
            },
        },
        "assertions": {
            "blankFullyTransparent": blank_contract["alphaNonzeroPixels"] == 0,
            "allCueFontSizesExactly40": all(
                record["fontSize"] == FONT_SIZE for record in cue_records
            ),
            "allCueFontWeightsW3": all(
                record["fontWeight"] == FONT_WEIGHT for record in cue_records
            ),
            "allCueBordersAbsent": all(
                record["borderAlphaMax"] == 0
                and record["containerLikeAlpha"] is False
                for record in cue_records
            ),
            "allAlphaLocalizedNearGlyphs": all(
                record["alphaCoverageRatio"] < 0.30
                and record["containerLikeAlpha"] is False
                for record in cue_records
            ),
            "allCueAlphaInsideSafeArea": all(
                record["insideCaptionSafeArea"] is True for record in cue_records
            ),
            "allCuePngsRgba1480x130": True,
            "acceptedPrefixCuePngsByteExact": prefix_pngs_byte_exact,
            "noOverlappingCues": True,
            "noContainer": all(
                record["containerLikeAlpha"] is False for record in cue_records
            ),
            "allAssetFilesReadOnly": True,
            "frameDirectoryReadOnly": True,
            "outputDirectoryReadOnly": True,
        },
        "displayCueCount": len(cue_records),
        "reusedCueCount": args.reuse_prefix_count,
        "generatedCueCount": len(cue_records) - args.reuse_prefix_count,
        "captionFrames": sum(owner is not None for owner in frame_owner),
        "blankFrames": sum(owner is None for owner in frame_owner),
        "frameOwnerSha256": stable_json_sha256(frame_owner),
        "blankImageFile": blank_path.name,
        "blankImageSha256": file_sha256(blank_path),
        "blankImageContract": blank_contract,
        "frameDirectory": "frames",
        "displayCues": cue_records,
        "publication": {
            "strategy": "sibling-unique-staging-atomic-no-replace-rename",
            "fileMode": "0444",
            "directoryMode": "0555",
        },
    }
    if not all(manifest["assertions"].values()):
        raise RuntimeError(f"overlay contract 失败：{manifest['assertions']}")
    manifest_path = staging_directory / "overlay-manifest-v004b-no-box.json"
    with manifest_path.open("x", encoding="utf-8") as destination:
        json.dump(manifest, destination, ensure_ascii=False, indent=2)
        destination.write("\n")

    for snapshot, label in (
        (timeline_snapshot, "字幕时间线"),
        (prefix_manifest_snapshot, "accepted prefix manifest"),
        (script_snapshot, "overlay builder 源码"),
        (font_snapshot, "固定字幕字体"),
    ):
        assert_snapshot_unchanged(snapshot, label)
    for record in cue_records:
        set_and_verify_mode(
            staging_directory / str(record["imageFile"]),
            READ_ONLY_FILE_MODE,
            f"cue-{record['index']} PNG",
        )
    set_and_verify_mode(blank_path, READ_ONLY_FILE_MODE, "blank PNG")
    set_and_verify_mode(manifest_path, READ_ONLY_FILE_MODE, "overlay manifest")
    set_and_verify_mode(
        frame_directory, READ_ONLY_DIRECTORY_MODE, "overlay frame directory"
    )
    set_and_verify_mode(
        staging_directory, READ_ONLY_DIRECTORY_MODE, "overlay staging directory"
    )
    for snapshot, label in (
        (timeline_snapshot, "字幕时间线"),
        (prefix_manifest_snapshot, "accepted prefix manifest"),
        (script_snapshot, "overlay builder 源码"),
        (font_snapshot, "固定字幕字体"),
    ):
        assert_snapshot_unchanged(snapshot, f"{label}（原子发布前）")
    atomic_rename_no_replace(staging_directory, output_directory)
    assert_plain_directory(output_directory, "published overlay directory")
    if stat.S_IMODE(output_directory.lstat().st_mode) != READ_ONLY_DIRECTORY_MODE:
        raise RuntimeError("published overlay directory 不是 0555")
    manifest_path = output_directory / "overlay-manifest-v004b-no-box.json"
    print(
        json.dumps(
            {
                "outputDirectory": str(output_directory),
                "manifestPath": str(manifest_path),
                "manifestSha256": file_sha256(manifest_path),
                "assertions": manifest["assertions"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
