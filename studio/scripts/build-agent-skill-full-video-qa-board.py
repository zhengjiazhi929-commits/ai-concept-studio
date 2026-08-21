from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_ROOT = PROJECT_ROOT / "outputs" / "studio" / "agent-skill-20260806"
SOURCE_ROOT = OUTPUT_ROOT / "visual-proof-v014-stills"


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


def cell(path: Path, label: str) -> Image.Image:
    source = Image.open(path).convert("RGB")
    fitted = ImageOps.contain(source, (270, 480), method=Image.Resampling.LANCZOS)
    panel = Image.new("RGB", (290, 535), "white")
    panel.paste(fitted, ((290 - fitted.width) // 2, 43))
    draw = ImageDraw.Draw(panel)
    draw.text((12, 11), label, fill="#18201E", font=font(15))
    draw.rectangle((0, 0, 289, 534), outline="#CDD5D0", width=1)
    return panel


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", type=int, default=5)
    args = parser.parse_args()
    implementation_root = OUTPUT_ROOT / f"full-video-v{args.version:03d}-design-qa"
    pairs = [
        (SOURCE_ROOT / "frame-0030.png", "SOURCE v014 · opening", implementation_root / "second-001.png", f"FULL v{args.version} · opening"),
        (SOURCE_ROOT / "frame-1020.png", "SOURCE v014 · diagram", implementation_root / "second-274.png", f"FULL v{args.version} · diagram"),
        (SOURCE_ROOT / "frame-1650.png", "SOURCE v014 · late scene", implementation_root / "second-546.png", f"FULL v{args.version} · late scene"),
    ]
    canvas = Image.new("RGB", (1220, 1745), "#F5F6F2")
    draw = ImageDraw.Draw(canvas)
    draw.text((20, 12), f"AGENT SKILL · APPROVED v014 TO FULL VIDEO v{args.version}", fill="#F06C32", font=font(22))
    y = 62
    for source_path, source_label, implementation_path, implementation_label in pairs:
        canvas.paste(cell(source_path, source_label), (20, y))
        canvas.paste(cell(implementation_path, implementation_label), (320, y))
        y += 560
    output = OUTPUT_ROOT / f"full-video-v{args.version:03d}-design-qa-comparison.png"
    canvas.crop((0, 0, 630, 1742)).save(output, quality=95)
    print(output)


if __name__ == "__main__":
    main()
