import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {resolve} from "node:path";
import {tmpdir} from "node:os";
import {promisify} from "node:util";
import test from "node:test";
import {resolveLockedPythonRuntime} from "../scripts/qa-agent-skill-long-review-wide-v004.mjs";

import {
  V004C_SEMANTIC_LOGO_PROOF_CONTRACT,
} from "../scripts/render-agent-skill-v004c-semantic-logo-proof.mjs";


const execFileAsync = promisify(execFile);
const STUDIO_ROOT = resolve(import.meta.dirname, "..");
const SCRIPT_PATH = resolve(
  STUDIO_ROOT,
  "scripts/build-agent-skill-v004c-no-box-overlays.py",
);
const HARNESS_PATH = resolve(import.meta.dirname, "helpers/overlay-python-harness.py");
const {path: PYTHON} = await resolveLockedPythonRuntime();


async function runPython(argumentsList, options = {}) {
  return execFileAsync(PYTHON, ["-B", ...argumentsList], {
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONHASHSEED: "0",
      PYTHONNOUSERSITE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
    },
    ...options,
  });
}


test("rolling prefix helper 用内置合成字体验证 final expanded cue 固定左锚点", async () => {
  const code = [
    "import importlib.util, json, sys",
    "from pathlib import Path",
    "path = Path(sys.argv[1])",
    "spec = importlib.util.spec_from_file_location('v004c_builder', path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "font = module.BASE.ImageFont.load_default(size=40)",
    "prefix = 'Evidence stays bound'",
    "expanded = 'Evidence stays bound to the source input.'",
    "short = module.render_text_on_final_layout(prefix, expanded, font)",
    "full = module.render_text_on_final_layout(expanded, expanded, font)",
    "print(json.dumps({",
    "  'shortLength': len(short), 'fullLength': len(full),",
    "  'shortAnchor': short[4], 'fullAnchor': full[4],",
    "  'shortBbox': short[2]['alphaBoundingBox'],",
    "  'fullBbox': full[2]['alphaBoundingBox'],",
    "  'shortLines': short[1], 'finalLines': short[3]",
    "}, ensure_ascii=False))",
  ].join("\n");
  const {stdout} = await runPython(["-I", "-c", code, SCRIPT_PATH]);
  const result = JSON.parse(stdout);
  assert.equal(result.shortLength, 5);
  assert.equal(result.fullLength, 5);
  assert.deepEqual(result.shortAnchor, result.fullAnchor);
  assert.equal(result.shortBbox[0], result.fullBbox[0]);
  assert.ok(result.shortBbox[2] < result.fullBbox[2]);
  assert.ok(result.shortLines.length >= 1);
  assert.ok(result.finalLines.length >= result.shortLines.length);
});


test("builder 源码显式绑定 rollingGroup.finalText 且禁止复用历史 cue PNG", async () => {
  const source = await readFile(SCRIPT_PATH, "utf8");
  assert.match(source, /declared\.get\("finalText"/u);
  assert.match(source, /prefixAnchoredToFinalExpandedCue/u);
  assert.match(source, /rollingPrefixesAnchoredToFinalExpandedLayout/u);
  assert.match(source, /historicalCuePngsReused": False/u);
  assert.match(source, /BASE\.render_text\(final_text, font\)/u);
  assert.match(source, /BASE\.inspect_png/u);
  assert.doesNotMatch(source, /REUSED_PREFIX_COUNT/u);
});


test("错误范围与 attempt-002 在任何输出创建前 fail closed", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "v004c-overlay-fixture-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const invalidStaging = resolve(root, "not-created");
  const invalidOutput = resolve(invalidStaging, "caption-overlays");
  await assert.rejects(
    runPython([
      "-I",
      SCRIPT_PATH,
      "--timeline",
      resolve(
        STUDIO_ROOT,
        "data/render-inputs/full-v004c-attempt-002/subtitle-timeline-v004c-semantic.json",
      ),
      "--expected-timeline-sha256",
      "a".repeat(64),
      "--output-directory",
      invalidOutput,
      "--start-frame",
      "10081",
      "--frame-count",
      "600",
      "--mode",
      "proof",
    ]),
    /start-frame.*10080/u,
  );
  assert.equal(existsSync(invalidStaging), false);
});


test("合成 timeline 在临时目录生成600帧、保持rolling锚点且拒绝覆盖，不作正式证据", async () => {
  const staging = await mkdtemp(resolve(tmpdir(), "v004c-overlay-fixture-"));
  try {
    const {stdout} = await runPython([
      "-I",
      resolve(import.meta.dirname, "helpers/v004c-overlay-fixture.py"),
      HARNESS_PATH,
      SCRIPT_PATH,
      staging,
    ]);
    const result = JSON.parse(stdout);
    const manifest = result.manifest;
    assert.equal(result.fixtureOnly, true);
    assert.equal(result.formalEvidence, false);
    assert.equal(manifest.timeline.attempt, 5);
    assert.match(manifest.timeline.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(manifest.proofRange.globalStartFrame, 10_080);
    assert.equal(manifest.proofRange.globalEndFrameExclusive, 10_680);
    assert.equal(manifest.proofRange.frameCount, 600);
    assert.equal(manifest.reuse.historicalCuePngsReused, false);
    assert.equal(
      manifest.reuse.implementationSha256,
      V004C_SEMANTIC_LOGO_PROOF_CONTRACT.semanticMeasurement.builderSha256,
    );
    assert.match(manifest.reuse.pythonSha256, /^[a-f0-9]{64}$/u);
    assert.match(manifest.reuse.fontSha256, /^[a-f0-9]{64}$/u);
    assert.equal(manifest.assertions.everySelectedCueFreshlyRendered, true);
    assert.equal(manifest.assertions.rollingGroupsPresentInProof, true);
    assert.equal(
      manifest.assertions.rollingPrefixesAnchoredToFinalExpandedLayout,
      true,
    );
    assert.equal(manifest.assertions.allTimelineRollingGroupsExactlyS09AndS35, true);
    assert.equal(manifest.assertions.allTimelineRollingGeometryPassed, true);
    assert.deepEqual(
      manifest.allTimelineRollingLayoutAudits.map((audit) => audit.id),
      ["S09:0-39", "S35:65-96"],
    );
    for (const audit of manifest.allTimelineRollingLayoutAudits) {
      assert.equal(audit.passed, true);
      assert.ok(Object.values(audit.checks).every(Boolean));
      assert.equal(
        new Set(
          audit.measurements.map((measurement) =>
            JSON.stringify(measurement.fixedFirstLineAnchor),
          ),
        ).size,
        1,
      );
      assert.equal(
        new Set(
          audit.measurements.map(
            (measurement) => measurement.alphaBoundingBox[0],
          ),
        ).size,
        1,
      );
    }
    assert.ok(
      manifest.rollingLayoutGroups.some(
        (group) =>
          group.id.startsWith("S35:") &&
          group.prefixAnchorStable === true &&
          group.cueIndexes.length >= 2,
      ),
    );
    assert.equal(result.frameCount, 600);
  } finally {
    if (existsSync(staging)) await rm(staging, {recursive: true, force: true});
  }
});
