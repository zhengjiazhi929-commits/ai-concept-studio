import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {tmpdir} from "node:os";
import {promisify} from "node:util";
import test from "node:test";
import {resolveLockedPythonRuntime} from "../scripts/qa-agent-skill-long-review-wide-v004.mjs";


const execFileAsync = promisify(execFile);
const SCRIPT_PATH = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../scripts/build-agent-skill-v004b-no-box-overlays.py",
);
const FONT_PATH = resolve(import.meta.dirname, "helpers/overlay-python-harness.py");
const PREFIX_SCHEMA =
  "agent-skill-v013-natural-technical-caption-overlay-v004b-no-box-proof";


function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}


const {path: PYTHON} = await resolveLockedPythonRuntime();


async function runPython(argumentsList, options = {}) {
  const args = argumentsList[0] === SCRIPT_PATH
    ? [FONT_PATH, ...argumentsList]
    : argumentsList;
  return execFileAsync(PYTHON, ["-I", "-B", ...args], {
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONHASHSEED: "0",
      PYTHONNOUSERSITE: "1",
    },
    ...options,
  });
}


async function writeJson(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path, bytes, {flag: "wx"});
  return sha256(bytes);
}


async function removeTemporaryRoot(root) {
  if (!existsSync(root)) return;
  async function restoreDirectoryWrite(path) {
    const details = await lstat(path);
    if (!details.isDirectory() || details.isSymbolicLink()) return;
    await chmod(path, 0o700);
    const entries = await readdir(path, {withFileTypes: true});
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await restoreDirectoryWrite(resolve(path, entry.name));
      }
    }
  }
  await restoreDirectoryWrite(root);
  await rm(root, {recursive: true, force: true});
}


async function rewriteJson(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path, bytes);
  return sha256(bytes);
}


async function makeFixture() {
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(resolve(temporaryRoot, "v004b-overlay-builder-"));
  const prefixDirectory = resolve(root, "accepted-prefix");
  await mkdir(prefixDirectory);
  await runPython([
    "-c",
    [
      "from pathlib import Path",
      "from PIL import Image, ImageDraw, ImageFont",
      "import sys",
      "root = Path(sys.argv[1])",
      "font = ImageFont.load_default(size=40)",
      "Image.new('RGBA', (1480, 130), (0, 0, 0, 0)).save(root / 'blank.png', format='PNG')",
      "for index in range(1, 25):",
      "    image = Image.new('RGBA', (1480, 130), (0, 0, 0, 0))",
      "    draw = ImageDraw.Draw(image)",
      "    draw.text((80, 42), f'Accepted cue {index:02d}', font=font, fill=(19, 34, 29, 255))",
      "    image.save(root / f'cue-{index:03d}.png', format='PNG', optimize=True)",
    ].join("\n"),
    prefixDirectory,
    FONT_PATH,
  ]);

  const displayCues = [];
  for (let index = 1; index <= 24; index += 1) {
    const startFrame = index - 1;
    const endFrameExclusive = index;
    displayCues.push({
      index,
      text: `Accepted cue ${String(index).padStart(2, "0")}`,
      start: startFrame / 30,
      end: endFrameExclusive / 30,
      startFrame,
      endFrameExclusive,
      frameCount: 1,
      fontSize: 40,
      lines: [`Accepted cue ${String(index).padStart(2, "0")}`],
      imageFile: `cue-${String(index).padStart(3, "0")}.png`,
      imageSha256: sha256(
        await readFile(
          resolve(prefixDirectory, `cue-${String(index).padStart(3, "0")}.png`),
        ),
      ),
    });
  }
  const prefixManifest = {
    schemaVersion: PREFIX_SCHEMA,
    status: "proof-only",
    fps: 30,
    durationInFrames: 24,
    fontSha256: sha256(await readFile(FONT_PATH)),
    overlay: {
      width: 1480,
      height: 130,
      targetX: 220,
      targetY: 870,
      background: "transparent",
      backgroundAlpha: 0,
      fill: null,
      outline: null,
      borderWidth: 0,
      rectangle: false,
      noContainer: true,
      fontSize: 40,
      fontFamily: "Hiragino Sans GB",
    },
    assertions: {
      blankFullyTransparent: true,
      allCueFontSizesExactly40: true,
      allCueBordersAbsent: true,
      allAlphaLocalizedNearGlyphs: true,
      noContainer: true,
    },
    blankImageFile: "blank.png",
    blankImageSha256: sha256(await readFile(resolve(prefixDirectory, "blank.png"))),
    displayCues,
  };
  const prefixManifestPath = resolve(prefixDirectory, "overlay-manifest.json");
  const prefixManifestSha256 = await writeJson(prefixManifestPath, prefixManifest);

  const timeline = {
    fps: 30,
    durationSeconds: 1,
    durationInFrames: 30,
    displayCues: [
      ...displayCues.map(({index, text, start, end, startFrame, endFrameExclusive}) => ({
        index,
        text,
        start,
        end,
        startFrame,
        endFrameExclusive,
      })),
      {
        index: 25,
        text: "Synthetic new cue 25",
        start: 24 / 30,
        end: 1,
        startFrame: 24,
        endFrameExclusive: 30,
      },
    ],
  };
  const timelinePath = resolve(root, "timeline.json");
  const timelineSha256 = await writeJson(timelinePath, timeline);
  return {
    root,
    prefixDirectory,
    prefixManifest,
    prefixManifestPath,
    prefixManifestSha256,
    timeline,
    timelinePath,
    timelineSha256,
  };
}


function builderArguments(fixture, outputDirectory, overrides = {}) {
  return [
    SCRIPT_PATH,
    "--timeline",
    fixture.timelinePath,
    "--expected-timeline-sha256",
    overrides.timelineSha256 ?? fixture.timelineSha256,
    "--accepted-prefix-manifest",
    fixture.prefixManifestPath,
    "--expected-accepted-prefix-manifest-sha256",
    overrides.prefixManifestSha256 ?? fixture.prefixManifestSha256,
    "--accepted-prefix-directory",
    fixture.prefixDirectory,
    "--output-directory",
    outputDirectory,
    "--mode",
    overrides.mode ?? "dry-test",
    "--fps",
    String(overrides.fps ?? 30),
    "--duration-in-frames",
    String(overrides.durationInFrames ?? 30),
    "--duration-seconds",
    String(overrides.durationSeconds ?? 1),
    "--reuse-prefix-count",
    "24",
  ];
}


test("合成字体 dry-test 逐字节复用前24图并生成透明字幕，不作中文视觉证据", async () => {
  const fixture = await makeFixture();
  try {
    const outputDirectory = resolve(fixture.root, "overlay-complete");
    const {stdout} = await runPython(builderArguments(fixture, outputDirectory));
    const result = JSON.parse(stdout.trim());
    assert.equal(result.outputDirectory, outputDirectory);
    const manifestPath = resolve(outputDirectory, "overlay-manifest-v004b-no-box.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.deepEqual(manifest.parameters, {
      mode: "dry-test",
      fps: 30,
      durationSeconds: 1,
      durationInFrames: 30,
      reusePrefixCount: 24,
    });
    assert.equal(manifest.builder.scriptSha256, sha256(await readFile(SCRIPT_PATH)));
    assert.equal(manifest.timeline.sha256, fixture.timelineSha256);
    assert.equal(manifest.timelineSha256, fixture.timelineSha256);
    assert.equal(
      manifest.acceptedPrefix.manifestSha256,
      fixture.prefixManifestSha256,
    );
    assert.equal(manifest.acceptedPrefix.allCuePngByteExact, true);
    assert.equal(manifest.acceptedPrefix.verification.actualPngsReverified, true);
    assert.equal(manifest.acceptedPrefix.verification.fontIdentityReverified, true);
    assert.equal(manifest.assertions.allCueAlphaInsideSafeArea, true);
    assert.equal(manifest.assertions.noContainer, true);
    assert.equal(manifest.displayCueCount, 25);
    assert.equal(manifest.reusedCueCount, 24);
    assert.equal(manifest.generatedCueCount, 1);
    assert.equal((await lstat(outputDirectory)).mode & 0o777, 0o555);
    assert.equal((await lstat(manifestPath)).mode & 0o777, 0o444);
    assert.equal(
      (await lstat(resolve(outputDirectory, "blank.png"))).mode & 0o777,
      0o444,
    );
    assert.equal(
      (await lstat(resolve(outputDirectory, "frames"))).mode & 0o777,
      0o555,
    );
    for (let index = 1; index <= 24; index += 1) {
      const name = `cue-${String(index).padStart(3, "0")}.png`;
      assert.equal(
        (await lstat(resolve(outputDirectory, name))).mode & 0o777,
        0o444,
      );
      assert.deepEqual(
        await readFile(resolve(outputDirectory, name)),
        await readFile(resolve(fixture.prefixDirectory, name)),
      );
    }
    const generated = manifest.displayCues[24];
    assert.equal(generated.fontSize, 40);
    assert.equal(generated.fontWeight, "W3");
    assert.equal(generated.borderAlphaMax, 0);
    assert.equal(generated.insideCaptionSafeArea, true);
    assert.equal(generated.containerLikeAlpha, false);
    const frameEntries = await readdir(resolve(outputDirectory, "frames"));
    assert.equal(frameEntries.length, 30);
    assert.equal(
      (await lstat(resolve(outputDirectory, "frames/frame-00029.png"))).isSymbolicLink(),
      true,
    );
    assert.deepEqual(
      (await readdir(fixture.root)).filter((name) => name.includes(".part-")),
      [],
    );
  } finally {
    await removeTemporaryRoot(fixture.root);
  }
});


test("冻结哈希、prefix合同、严格cue类型和正式600秒合同全部 fail closed", async () => {
  const fixture = await makeFixture();
  try {
    for (const [name, overrides, pattern] of [
      ["bad-timeline-hash", {timelineSha256: "a".repeat(64)}, /时间线 SHA-256/u],
      ["bad-prefix-hash", {prefixManifestSha256: "b".repeat(64)}, /accepted prefix manifest SHA-256/u],
      [
        "wrong-full-contract",
        {mode: "full", durationInFrames: 17_999, durationSeconds: 600},
        /duration-in-frames|18000/u,
      ],
      [
        "wrong-full-output",
        {mode: "full", durationInFrames: 18_000, durationSeconds: 600},
        /独立固定 overlay input 目录/u,
      ],
    ]) {
      const outputDirectory = resolve(fixture.root, name);
      await assert.rejects(
        runPython(builderArguments(fixture, outputDirectory, overrides)),
        pattern,
      );
      assert.equal(existsSync(outputDirectory), false);
    }

    const wrongSchema = {...fixture.prefixManifest, schemaVersion: "forged-proof"};
    fixture.prefixManifestSha256 = await rewriteJson(
      fixture.prefixManifestPath,
      wrongSchema,
    );
    await assert.rejects(
      runPython(builderArguments(fixture, resolve(fixture.root, "wrong-schema"))),
      /schemaVersion/u,
    );
    assert.equal(existsSync(resolve(fixture.root, "wrong-schema")), false);

    fixture.prefixManifestSha256 = await rewriteJson(
      fixture.prefixManifestPath,
      fixture.prefixManifest,
    );
    const invalidTimeline = structuredClone(fixture.timeline);
    invalidTimeline.displayCues[24].text = null;
    fixture.timelineSha256 = await rewriteJson(fixture.timelinePath, invalidTimeline);
    await assert.rejects(
      runPython(builderArguments(fixture, resolve(fixture.root, "null-text"))),
      /文本必须是字符串/u,
    );
    assert.equal(existsSync(resolve(fixture.root, "null-text")), false);
  } finally {
    await removeTemporaryRoot(fixture.root);
  }
});


test("accepted PNG 必须是普通真实PNG，内部矩形容器不能冒充glyph alpha", async () => {
  const fixture = await makeFixture();
  try {
    const cuePath = resolve(fixture.prefixDirectory, "cue-001.png");
    const realCuePath = resolve(fixture.prefixDirectory, "cue-001-real.png");
    await writeFile(realCuePath, await readFile(cuePath), {flag: "wx"});
    await rm(cuePath);
    await symlink("cue-001-real.png", cuePath);
    await assert.rejects(
      runPython(builderArguments(fixture, resolve(fixture.root, "symlink-png"))),
      /普通文件|符号链接/u,
    );
    assert.equal(existsSync(resolve(fixture.root, "symlink-png")), false);

    await rm(cuePath);
    await runPython([
      "-c",
      [
        "from PIL import Image, ImageDraw",
        "import sys",
        "image = Image.new('RGBA', (1480, 130), (0, 0, 0, 0))",
        "ImageDraw.Draw(image).rectangle((540, 25, 940, 104), fill=(19, 34, 29, 255))",
        "image.save(sys.argv[1], format='PNG')",
      ].join("\n"),
      cuePath,
    ]);
    const forged = structuredClone(fixture.prefixManifest);
    forged.displayCues[0].imageSha256 = sha256(await readFile(cuePath));
    fixture.prefixManifestSha256 = await rewriteJson(fixture.prefixManifestPath, forged);
    await assert.rejects(
      runPython(builderArguments(fixture, resolve(fixture.root, "rectangle-alpha"))),
      /容器|矩形/u,
    );
    assert.equal(existsSync(resolve(fixture.root, "rectangle-alpha")), false);
  } finally {
    await removeTemporaryRoot(fixture.root);
  }
});


test("快照发布前重验且原子rename不覆盖并发创建的目标", async () => {
  const root = await mkdtemp(resolve(await realpath(tmpdir()), "v004b-overlay-helpers-"));
  try {
    const snapshotPath = resolve(root, "snapshot.json");
    await writeFile(snapshotPath, '{"value":1}\n');
    const sourceDirectory = resolve(root, "source");
    const targetDirectory = resolve(root, "target");
    await mkdir(sourceDirectory);
    await mkdir(targetDirectory);
    await writeFile(resolve(targetDirectory, "sentinel"), "keep");
    const snippet = [
      "import importlib.util, pathlib, sys",
      "spec = importlib.util.spec_from_file_location('overlay_builder', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "snapshot = module.read_json_snapshot(pathlib.Path(sys.argv[2]), 'snapshot', module.file_sha256(pathlib.Path(sys.argv[2])))",
      "pathlib.Path(sys.argv[2]).write_text('{\\\"value\\\":2}\\n', encoding='utf-8')",
      "try:",
      "    module.assert_snapshot_unchanged(snapshot, 'snapshot')",
      "except RuntimeError:",
      "    pass",
      "else:",
      "    raise AssertionError('snapshot drift was accepted')",
      "try:",
      "    module.atomic_rename_no_replace(pathlib.Path(sys.argv[3]), pathlib.Path(sys.argv[4]))",
      "except RuntimeError:",
      "    pass",
      "else:",
      "    raise AssertionError('existing target was replaced')",
    ].join("\n");
    await runPython(["-c", snippet, SCRIPT_PATH, snapshotPath, sourceDirectory, targetDirectory]);
    assert.equal(await readFile(resolve(targetDirectory, "sentinel"), "utf8"), "keep");
    assert.equal(existsSync(sourceDirectory), true);
  } finally {
    await removeTemporaryRoot(root);
  }
});


test("overlay manifest 逐字节保留 full timeline cue 文本，绘制阶段才规范空白", async () => {
  const snippet = [
    "import importlib.util, sys",
    "spec = importlib.util.spec_from_file_location('overlay_builder', sys.argv[1])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "cue = {'index': 1, 'text': 'Agent Skill ', 'start': 0.0, 'end': 1.0, 'startFrame': 0, 'endFrameExclusive': 30}",
    "actual = module.cue_values(cue, 1)",
    "assert actual['text'] == 'Agent Skill '",
    "font = module.ImageFont.load_default(size=module.FONT_SIZE)",
    "image, lines, contract = module.render_text(actual['text'], font)",
    "assert lines == ['Agent Skill']",
    "assert contract['alphaNonzeroPixels'] > 0",
  ].join("\n");
  await runPython(["-c", snippet, SCRIPT_PATH]);
});
