from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


STUDIO_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = STUDIO_ROOT.parent
OUTPUT_ROOT = PROJECT_ROOT / "outputs" / "studio" / "visual-system-sample-v3"
TRANSITION_ROOT = OUTPUT_ROOT / "transition-qa"
BACKGROUND = "#F5F7FA"
INK = "#16213A"
MUTED = "#667085"
LINE = "#DCE2EA"
BLUE = "#2F7FF7"


def font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def labeled_panel(image: Image.Image, size: tuple[int, int], label: str) -> Image.Image:
    panel = Image.new("RGB", (size[0], size[1] + 62), "white")
    fitted = ImageOps.contain(image.convert("RGB"), size, method=Image.Resampling.LANCZOS)
    x = (size[0] - fitted.width) // 2
    y = 54 + (size[1] - fitted.height) // 2
    panel.paste(fitted, (x, y))
    draw = ImageDraw.Draw(panel)
    draw.text((20, 14), label, fill=INK, font=font(24))
    draw.line((0, 53, size[0], 53), fill=LINE, width=1)
    return panel


def build_reference_comparison(source_path: Path) -> Path:
    source = Image.open(source_path)
    implementation = Image.open(OUTPUT_ROOT / "wide-concept.png")
    left = labeled_panel(source, (1200, 675), "SELECTED LIGHT VISUAL TARGET")
    right = labeled_panel(implementation, (1200, 675), "REMOTION IMPLEMENTATION · 1920 × 1080")
    canvas = Image.new("RGB", (2460, 797), BACKGROUND)
    canvas.paste(left, (20, 40))
    canvas.paste(right, (1240, 40))
    draw = ImageDraw.Draw(canvas)
    draw.text((20, 8), "VISUAL FIDELITY COMPARISON", fill=BLUE, font=font(24))
    path = OUTPUT_ROOT / "qa-reference-vs-wide-v3.png"
    canvas.save(path, quality=95)
    return path


def build_responsive_board() -> Path:
    wide = Image.open(OUTPUT_ROOT / "wide-concept.png")
    vertical = Image.open(OUTPUT_ROOT / "vertical-concept.png")
    wide_panel = labeled_panel(wide, (1200, 675), "WIDE · 1920 × 1080")
    vertical_panel = labeled_panel(vertical, (380, 675), "VERTICAL · 1080 × 1920")
    canvas = Image.new("RGB", (1640, 797), BACKGROUND)
    canvas.paste(wide_panel, (20, 40))
    canvas.paste(vertical_panel, (1240, 40))
    draw = ImageDraw.Draw(canvas)
    draw.text((20, 8), "RESPONSIVE RECOMPOSITION", fill=BLUE, font=font(24))
    path = OUTPUT_ROOT / "qa-responsive-v3.png"
    canvas.save(path, quality=95)
    return path


def transition_files(label: str, handoff: int) -> list[Path]:
    return sorted(TRANSITION_ROOT.glob(f"{label}-handoff-{handoff}-frame-*.png"))


def build_filmstrip(label: str) -> Path:
    vertical = label == "vertical"
    columns = 9 if vertical else 5
    thumb = (210, 373) if vertical else (448, 252)
    label_height = 34
    gap = 14
    margin = 20
    title_height = 72
    section_gap = 54
    handoffs = [transition_files(label, 1), transition_files(label, 2)]
    rows_per_section = [(len(files) + columns - 1) // columns for files in handoffs]
    width = margin * 2 + columns * thumb[0] + (columns - 1) * gap
    height = (
        title_height
        + sum(rows * (thumb[1] + label_height + gap) for rows in rows_per_section)
        + section_gap * 2
        + margin
    )
    canvas = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    draw.text(
        (margin, 18),
        f"{label.upper()} · SINGLE-WINDOW TRANSITION · DENSE FRAME AUDIT",
        fill=INK,
        font=font(26),
    )
    y = title_height
    for index, files in enumerate(handoffs, start=1):
        draw.text((margin, y), f"HANDOFF {index}", fill=BLUE, font=font(22))
        y += section_gap
        for position, path in enumerate(files):
            row, column = divmod(position, columns)
            x = margin + column * (thumb[0] + gap)
            cell_y = y + row * (thumb[1] + label_height + gap)
            frame = Image.open(path).convert("RGB")
            fitted = ImageOps.fit(frame, thumb, method=Image.Resampling.LANCZOS)
            canvas.paste(fitted, (x, cell_y))
            draw.rectangle((x, cell_y, x + thumb[0] - 1, cell_y + thumb[1] - 1), outline=LINE, width=1)
            frame_number = path.stem.rsplit("-", 1)[-1]
            draw.text((x + 6, cell_y + thumb[1] + 6), f"frame {frame_number}", fill=MUTED, font=font(16))
        y += rows_per_section[index - 1] * (thumb[1] + label_height + gap)
    output = OUTPUT_ROOT / f"qa-transition-filmstrip-{label}-v3.png"
    canvas.save(output, quality=94)
    return output


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: build-visual-qa-boards.py /absolute/path/to/source-target.png")
    source_path = Path(sys.argv[1]).resolve()
    if not source_path.exists():
        raise FileNotFoundError(source_path)
    outputs = [
        build_reference_comparison(source_path),
        build_responsive_board(),
        build_filmstrip("wide"),
        build_filmstrip("vertical"),
    ]
    for output in outputs:
        print(output)


if __name__ == "__main__":
    main()
