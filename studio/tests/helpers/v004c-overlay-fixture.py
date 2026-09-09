"""Exercise overlay publication with synthetic data, never formal QA evidence."""

import hashlib
import importlib.util
import json
import sys
from pathlib import Path


spec = importlib.util.spec_from_file_location("fixture_harness", sys.argv[1])
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
module = harness.load_fixture_module(sys.argv[2])
root = Path(sys.argv[3]).resolve()
assert root.name.startswith("v004c-overlay-fixture-")

# Version identities below are injected only into this test process. Production
# CLI bindings remain unchanged and cannot consume these synthetic artifacts.
module.EXPECTED_FONT_SHA256 = module.file_sha256(module.BASE.FONT_PATH)
module.EXPECTED_RENDERER_PYTHON_SHA256 = module.file_sha256(Path(sys.executable).resolve())
cues = []
for segment, source_start, source_end, first_frame in [(9, 0, 39, 900), (35, 65, 96, 10110)]:
    length = source_end - source_start
    final_text = "Evidence stays bound to the source input"[:length].ljust(length, ".")
    group = {
        "id": f"S{segment:02d}:{source_start}-{source_end}",
        "sourceStart": source_start, "sourceEnd": source_end,
        "finalText": final_text, "cueCount": 2, "displayAnchor": "group-source-start",
    }
    for ordinal, text in enumerate([final_text[:12], final_text], start=1):
        start = first_frame + (ordinal - 1) * 90
        cues.append({
            "index": len(cues) + 1, "speechSegmentIndex": segment, "sceneId": "S11",
            "text": text, "sourceText": text if ordinal == 1 else final_text[12:],
            "sourceCharacterStart": source_start if ordinal == 1 else source_start + 12,
            "sourceCharacterEnd": source_start + len(text), "displayContextStart": source_start,
            "rollingCarryApplied": ordinal == 2, "rollingGroup": {**group, "cueOrdinal": ordinal},
            "startFrame": start, "endFrameExclusive": start + 90,
            "start": start / 30, "end": (start + 90) / 30,
        })
timeline = {
    "fixtureOnly": True,
    "schemaVersion": module.EXPECTED_TIMELINE_SCHEMA_VERSION,
    "fps": 30, "durationInFrames": 18000, "sampleRate": 48000, "durationInSamples": 28800000,
    "acceptedPrefix": {"reused": False},
    "semanticSegmentation": {
        "contractVersion": module.EXPECTED_SEGMENTATION_CONTRACT_VERSION,
        "sourceTimelineSha256": module.EXPECTED_SOURCE_TIMELINE_SHA256,
        "markerAligned": True, "audioChanged": False, "acceptedPrefixCuePngsReused": False,
        "visualChunkFitsEnforced": True, "maximumCueDurationSeconds": 5.5,
        # Synthetic declarations exercise validation plumbing only.
        "visualFit": {
            "verified": True, "publicationEligible": True, "testDouble": False,
            "measurementProvenance": "real-overlay-renderer", "allSelectedChunksFit": True,
            "maximumActualCueDurationSeconds": 3,
            "renderer": {
                "builderSha256": module.EXPECTED_RENDERER_SHA256,
                "pythonSha256": module.EXPECTED_RENDERER_PYTHON_SHA256,
                "fontSha256": module.EXPECTED_FONT_SHA256,
                "fontFamily": "Hiragino Sans GB", "fontWeight": "W3", "fontSize": 40,
                "overlaySize": [1480, 130], "alphaAndSafeAreaThresholdsRelaxed": False,
                "snapshotReverifiedAfterMeasurement": True,
            },
        },
    },
    "displayCues": cues,
}
timeline_path = root / "full-v004c-attempt-005" / "synthetic-timeline.json"
timeline_path.parent.mkdir()
timeline_bytes = json.dumps(timeline).encode()
timeline_path.write_bytes(timeline_bytes)
timeline_sha256 = hashlib.sha256(timeline_bytes).hexdigest()
module.EXPECTED_TIMELINE_SHA256 = timeline_sha256
output = root / "caption-overlays"
manifest = module.build_overlay_assets(timeline_path, timeline_bytes, timeline_sha256, output)
original_manifest_bytes = (output / module.MANIFEST_FILE_NAME).read_bytes()
try:
    module.build_overlay_assets(timeline_path, timeline_bytes, timeline_sha256, output)
    raise AssertionError("existing overlay directory was replaced")
except RuntimeError as error:
    assert "拒绝覆盖既有 proof 字幕目录" in str(error)
assert (output / module.MANIFEST_FILE_NAME).read_bytes() == original_manifest_bytes
print(json.dumps({
    "fixtureOnly": True, "formalEvidence": False,
    "frameCount": len(list((output / "frames").iterdir())),
    "manifest": manifest,
}))
