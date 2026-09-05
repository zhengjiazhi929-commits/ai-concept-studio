"""Test-only raster fixtures. These cannot attest a production CJK font or proof.

Production entry points retain their immutable font and artifact bindings. This
harness exercises their filesystem and layout behavior with Pillow's embedded
font, synthetic inputs, and temporary output roots on every CI platform.
"""

import importlib.util
import sys
from pathlib import Path

from PIL import ImageFont


FIXTURE_FONT_PATH = Path(__file__).resolve()
ORIGINAL_TRUETYPE = ImageFont.truetype


def synthetic_truetype(font, size=10, index=0, **kwargs):
    if str(font) != str(FIXTURE_FONT_PATH):
        return ORIGINAL_TRUETYPE(font, size=size, index=index, **kwargs)
    selected = ImageFont.load_default(size=size)
    # Metadata is a test double only; never use this output as font evidence.
    selected.getname = lambda: ("Hiragino Sans GB", "W3" if index == 0 else "W6")
    return selected


def load_fixture_module(path):
    spec = importlib.util.spec_from_file_location("overlay_fixture_target", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    target = getattr(module, "BASE", module)
    target.FONT_PATH = FIXTURE_FONT_PATH
    ImageFont.truetype = synthetic_truetype
    return module


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    target_path = Path(sys.argv.pop(1)).resolve()
    module = load_fixture_module(target_path)
    module.main()
