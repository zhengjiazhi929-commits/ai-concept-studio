import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import test from "node:test";
import {promisify} from "node:util";
import {resolveLockedPythonRuntime} from "../scripts/qa-agent-skill-long-review-wide-v004.mjs";

import {
  V004C_SEMANTIC_LOGO_PROOF_CONTRACT,
  V004C_SEMANTIC_LOGO_PROOF_PATHS,
} from "../scripts/render-agent-skill-v004c-semantic-logo-proof.mjs";
import {
  V004C_CONTACT_SHEET_SUPPLEMENT_CONTRACT,
  V004C_CONTACT_SHEET_SUPPLEMENT_PATHS,
} from "../scripts/build-agent-skill-v004c-contact-sheet-supplement.mjs";


const execFileAsync = promisify(execFile);
const STUDIO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const HARNESS_PATH = resolve(import.meta.dirname, "helpers/overlay-python-harness.py");


function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}


test("proof contact sheet locks Hiragino Sans GB W3/W6 collection faces", () => {
  assert.deepEqual(V004C_SEMANTIC_LOGO_PROOF_CONTRACT.contactSheet, {
    builderSchemaVersion: "agent-skill-v004c-contact-sheet-builder-v1",
    fontPath: "/System/Library/Fonts/Hiragino Sans GB.ttc",
    fontSha256:
      "f887295caf2881cab9554b14c5ab4c9ee624c3895599da152ec37416b5aefae0",
    fontFamily: "Hiragino Sans GB",
    regular: {index: 0, weight: "W3"},
    bold: {index: 2, weight: "W6"},
    cjkGlyphProbe: "中文标题字幕语义锚点",
  });
  assert.equal(
    V004C_CONTACT_SHEET_SUPPLEMENT_CONTRACT.contactSheet,
    V004C_SEMANTIC_LOGO_PROOF_CONTRACT.contactSheet,
  );
});


test("proof uses the fixed-font builder and no longer delegates labels to module.font", async () => {
  const [proofSource, builderSource] = await Promise.all([
    readFile(
      resolve(STUDIO_ROOT, "scripts/render-agent-skill-v004c-semantic-logo-proof.mjs"),
      "utf8",
    ),
    readFile(V004C_SEMANTIC_LOGO_PROOF_PATHS.contactSheetBuilderPath, "utf8"),
  ]);
  assert.match(proofSource, /CONTACT_SHEET_BUILDER_PATH/u);
  assert.match(proofSource, /contactSheetChineseLabelsReadable/u);
  assert.doesNotMatch(proofSource, /module\.font\(/u);
  assert.match(
    builderSource,
    /FONT_PATH = Path\("\/System\/Library\/Fonts\/Hiragino Sans GB\.ttc"\)/u,
  );
  assert.match(builderSource, /REGULAR_FONT_INDEX = 0/u);
  assert.match(builderSource, /BOLD_FONT_INDEX = 2/u);
  assert.match(builderSource, /selected\.getname\(\) != expected_name/u);
  assert.match(builderSource, /failed the CJK glyph raster probe/u);
});


test("synthetic frames produce a deterministic contact sheet without claiming CJK acceptance", async (context) => {
  const {path: pythonPath} = await resolveLockedPythonRuntime();
  const directory = await mkdtemp(join(tmpdir(), "v004c-contact-sheet-font-test-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const output = join(directory, "contact-sheet.png");
  const program = `
import importlib.util, json, sys
from pathlib import Path
from PIL import Image
spec = importlib.util.spec_from_file_location('fixture_harness', sys.argv[1])
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
module = harness.load_fixture_module(sys.argv[2])
# A test-only font and ASCII glyph probe exercise layout and identity checks.
# They are never used to attest production Chinese typography.
module.FONT_SHA256 = module.sha256_bytes(module.FONT_PATH.read_bytes())
module.CJK_GLYPH_PROBE = 'abcdefghij'
root = Path(sys.argv[4]).resolve()
samples = []
for offset in [0, 60, 120]:
    filename = f'frame-{offset:03d}.png'
    Image.new('RGB', (1920, 1080), (238, 243, 240)).save(root / filename)
    tags = [f'watermark-motion-sample:chunk-01:offset:{offset}']
    if offset == 0:
        tags.extend(['rolling-boundary:1:before', 'subtitle-cue:1'])
    elif offset == 60:
        tags.append('rolling-boundary:1:after')
    samples.append({'frame': offset, 'globalFrame': 10080 + offset,
                    'second': offset / 30, 'filename': filename, 'tags': tags})
index = {
    'proofGlobalStartFrame': 10080, 'proofGlobalEndFrameExclusive': 10680,
    'watermarkCadenceId': 'continuous', 'watermarkCycleInFrames': 120,
    'watermarkMotionSampleOffsetsInFrames': [0, 60, 120],
    'watermarkCropPixels': {'left': 1760, 'top': 40, 'width': 120, 'height': 120},
    'watermarkMotionProof': {
        'schemaVersion': 'synthetic-fixture-not-acceptance',
        'minimumDistinctCropHashCount': 5, 'minimumMateriallyChangedPhaseCount': 4,
        'materialChangeDhashHammingMinimum': 128, 'cycleReturnDhashHammingMaximum': 96},
    'chunkCount': 1, 'chunkDurationInFrames': 900,
    'fullSamples': samples, 'subtitleEvidence': [{'cueIndex': 1, 'text': 'Fixture label'}]}
index_path = root / 'frame-index.json'
index_path.write_text(json.dumps(index))
output = root / 'contact-sheet.png'
first = module.build_contact_sheet(Path(sys.argv[3]), root, index_path, output)
second = module.build_contact_sheet(Path(sys.argv[3]), root, index_path, root / 'repeat.png')
assert first['contactSheet']['sha256'] == second['contactSheet']['sha256']
try:
    module.build_contact_sheet(Path(sys.argv[3]), root, index_path, output)
    raise AssertionError('existing contact sheet was overwritten')
except FileExistsError:
    pass
module.FONT_SHA256 = '0' * 64
try:
    module.verify_font_contract()
    raise AssertionError('font hash drift accepted')
except RuntimeError as error:
    assert 'SHA-256' in str(error)
print(json.dumps(first))
`;
  const {stdout} = await execFileAsync(
    pythonPath,
    [
      "-I",
      "-B",
      "-c",
      program,
      HARNESS_PATH,
      V004C_SEMANTIC_LOGO_PROOF_PATHS.contactSheetBuilderPath,
      V004C_SEMANTIC_LOGO_PROOF_PATHS.qaAnalyzerPath,
      directory,
    ],
    {timeout: 120_000, maxBuffer: 32 * 1024 * 1024},
  );
  const result = JSON.parse(stdout);
  const bytes = await readFile(output);
  assert.equal(result.status, "fail", "static synthetic frames must not attest watermark motion");
  assert.equal(result.contactSheet.width, 1272);
  assert.ok(result.contactSheet.height >= 1000);
  assert.equal(result.contactSheet.sha256, sha256(bytes));
  assert.equal(result.contactSheet.typography.cjkGlyphProbe.text, "abcdefghij");
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});


test("supplement is a fixed sibling, binds the published source hashes, and forbids overwrite/video/Git", () => {
  const contract = V004C_CONTACT_SHEET_SUPPLEMENT_CONTRACT;
  assert.match(
    V004C_CONTACT_SHEET_SUPPLEMENT_PATHS.targetDirectory,
    /v004c-semantic-subtitle-continuous-logo-proof-v001-contact-sheet-supplement-v001$/u,
  );
  assert.equal(
    contract.sourceProofManifestSha256,
    "aab16de22d70968aed3306c408658047a9e4f1f1dff45b4705567e9c04ebabd6",
  );
  assert.equal(
    contract.sourceFrameIndexSha256,
    "cb50b2a4753c6d3b1a8ad03007c9ba394907705f85d59afc63f37af439eb7a62",
  );
  assert.equal(
    contract.sourceVideoSha256,
    "6d7dc9c56f1e283a708b6164b1bd2deb0609be7c02dc7fe3ec9c8ed748f666bb",
  );
  assert.equal(contract.modifiesSourceCandidate, false);
  assert.equal(contract.rerendersVideo, false);
  assert.equal(contract.overwritingAllowed, false);
  assert.equal(contract.authorizesGit, false);
  assert.equal(contract.tenMinuteAcceptance, false);
  assert.equal(
    V004C_CONTACT_SHEET_SUPPLEMENT_PATHS.sourceDirectory.startsWith(
      resolve(WORKSPACE_ROOT, "outputs"),
    ),
    true,
  );
});
