import {execFile} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, relative, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {promisify} from "node:util";

import {
  V004C_SEMANTIC_LOGO_PROOF_CONTRACT,
  V004C_SEMANTIC_LOGO_PROOF_PATHS,
} from "./render-agent-skill-v004c-semantic-logo-proof.mjs";


const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STUDIO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const REVIEW_CANDIDATES_ROOT = resolve(
  WORKSPACE_ROOT,
  "outputs/studio/agent-skill-20260806/review-candidates",
);
const SOURCE_DIRECTORY = V004C_SEMANTIC_LOGO_PROOF_PATHS.candidateDirectory;
const SOURCE_VIDEO = V004C_SEMANTIC_LOGO_PROOF_PATHS.outputPath;
const SOURCE_MANIFEST = resolve(SOURCE_DIRECTORY, "proof-manifest.json");
const SOURCE_QA_DIRECTORY = resolve(SOURCE_DIRECTORY, "qa");
const SOURCE_FRAME_INDEX = resolve(SOURCE_QA_DIRECTORY, "frame-index.json");
const SOURCE_OLD_CONTACT_SHEET = resolve(SOURCE_QA_DIRECTORY, "contact-sheet.png");
const TARGET_DIRECTORY_NAME =
  "v004c-semantic-subtitle-continuous-logo-proof-v001-contact-sheet-supplement-v001";
const TARGET_DIRECTORY = resolve(REVIEW_CANDIDATES_ROOT, TARGET_DIRECTORY_NAME);
const OUTPUT_FILE_NAME = "contact-sheet-readable.png";
const MANIFEST_FILE_NAME = "supplement-manifest.json";
const CONTACT_SHEET_BUILDER = V004C_SEMANTIC_LOGO_PROOF_PATHS.contactSheetBuilderPath;
const QA_ANALYZER = V004C_SEMANTIC_LOGO_PROOF_PATHS.qaAnalyzerPath;


export const V004C_CONTACT_SHEET_SUPPLEMENT_CONTRACT = Object.freeze({
  schemaVersion: "agent-skill-v004c-contact-sheet-supplement-v1",
  status: "readable-contact-sheet-supplement-only",
  sourceCandidateDirectoryName:
    V004C_SEMANTIC_LOGO_PROOF_CONTRACT.candidateDirectoryName,
  sourceProofManifestSha256:
    "aab16de22d70968aed3306c408658047a9e4f1f1dff45b4705567e9c04ebabd6",
  sourceFrameIndexSha256:
    "cb50b2a4753c6d3b1a8ad03007c9ba394907705f85d59afc63f37af439eb7a62",
  sourceVideoSha256:
    "6d7dc9c56f1e283a708b6164b1bd2deb0609be7c02dc7fe3ec9c8ed748f666bb",
  targetDirectoryName: TARGET_DIRECTORY_NAME,
  outputFileName: OUTPUT_FILE_NAME,
  manifestFileName: MANIFEST_FILE_NAME,
  contactSheet: V004C_SEMANTIC_LOGO_PROOF_CONTRACT.contactSheet,
  modifiesSourceCandidate: false,
  rerendersVideo: false,
  overwritingAllowed: false,
  authorizesGit: false,
  tenMinuteAcceptance: false,
});


export const V004C_CONTACT_SHEET_SUPPLEMENT_PATHS = Object.freeze({
  sourceDirectory: SOURCE_DIRECTORY,
  sourceVideo: SOURCE_VIDEO,
  sourceManifest: SOURCE_MANIFEST,
  sourceQaDirectory: SOURCE_QA_DIRECTORY,
  sourceFrameIndex: SOURCE_FRAME_INDEX,
  sourceOldContactSheet: SOURCE_OLD_CONTACT_SHEET,
  targetDirectory: TARGET_DIRECTORY,
  outputPath: resolve(TARGET_DIRECTORY, OUTPUT_FILE_NAME),
  manifestPath: resolve(TARGET_DIRECTORY, MANIFEST_FILE_NAME),
  contactSheetBuilder: CONTACT_SHEET_BUILDER,
  qaAnalyzer: QA_ANALYZER,
});


function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}


function workspaceRelative(path) {
  return relative(WORKSPACE_ROOT, path);
}


async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}


async function assertPlainFile(path, label) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a plain file: ${path}`);
  }
}


async function inspectFile(path) {
  await assertPlainFile(path, workspaceRelative(path));
  const bytes = await readFile(path);
  const details = await lstat(path);
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    dev: details.dev,
    ino: details.ino,
    mtimeMs: details.mtimeMs,
  };
}


function assertExpectedHash(integrity, expected, label) {
  if (integrity.sha256 !== expected) {
    throw new Error(
      `${label} SHA-256 drift: expected=${expected} actual=${integrity.sha256}`,
    );
  }
}


function assertSafeFrameFilename(filename) {
  if (!/^frame-local-\d{5}-global-\d{5}\.png$/u.test(filename)) {
    throw new Error(`Unsafe or unexpected proof frame filename: ${filename}`);
  }
}


async function captureSourceEvidence() {
  const contract = V004C_CONTACT_SHEET_SUPPLEMENT_CONTRACT;
  const [manifestIntegrity, frameIndexIntegrity, videoIntegrity, oldSheetIntegrity] =
    await Promise.all([
      inspectFile(SOURCE_MANIFEST),
      inspectFile(SOURCE_FRAME_INDEX),
      inspectFile(SOURCE_VIDEO),
      inspectFile(SOURCE_OLD_CONTACT_SHEET),
    ]);
  assertExpectedHash(
    manifestIntegrity,
    contract.sourceProofManifestSha256,
    "source proof manifest",
  );
  assertExpectedHash(
    frameIndexIntegrity,
    contract.sourceFrameIndexSha256,
    "source frame index",
  );
  assertExpectedHash(videoIntegrity, contract.sourceVideoSha256, "source video");
  const [manifest, frameIndex] = await Promise.all([
    readFile(SOURCE_MANIFEST, "utf8").then(JSON.parse),
    readFile(SOURCE_FRAME_INDEX, "utf8").then(JSON.parse),
  ]);
  if (
    manifest.output?.sha256 !== contract.sourceVideoSha256 ||
    frameIndex.sourceVideo !== workspaceRelative(SOURCE_VIDEO)
  ) {
    throw new Error("Source proof manifest/frame index no longer bind the fixed video");
  }
  if (!Array.isArray(frameIndex.fullSamples) || frameIndex.fullSamples.length === 0) {
    throw new Error("Source proof frame index has no evidence frames");
  }
  const frames = [];
  for (const sample of frameIndex.fullSamples) {
    assertSafeFrameFilename(sample.filename);
    const path = resolve(SOURCE_QA_DIRECTORY, sample.filename);
    if (dirname(path) !== SOURCE_QA_DIRECTORY) {
      throw new Error(`Proof frame escaped the source QA directory: ${sample.filename}`);
    }
    frames.push({
      filename: sample.filename,
      frame: sample.frame,
      globalFrame: sample.globalFrame,
      tags: sample.tags,
      integrity: await inspectFile(path),
    });
  }
  return {
    manifestIntegrity,
    frameIndexIntegrity,
    videoIntegrity,
    oldSheetIntegrity,
    frameIndex,
    frames,
  };
}


function stableEvidenceSnapshot(evidence) {
  return JSON.stringify({
    manifestIntegrity: evidence.manifestIntegrity,
    frameIndexIntegrity: evidence.frameIndexIntegrity,
    videoIntegrity: evidence.videoIntegrity,
    oldSheetIntegrity: evidence.oldSheetIntegrity,
    frames: evidence.frames,
  });
}


async function resolvePinnedPython(sourceManifest) {
  const configured = sourceManifest.runtime?.pythonPath;
  if (typeof configured !== "string" || configured.length === 0) {
    throw new Error("Source proof manifest does not pin its Python runtime");
  }
  const fallback = resolve(
    homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3",
  );
  const path = await realpath(configured || fallback);
  const integrity = await inspectFile(path);
  if (integrity.sha256 !== sourceManifest.runtime.pythonSha256) {
    throw new Error("Pinned Python runtime drifted from the source proof manifest");
  }
  return {path, integrity, identity: sourceManifest.runtime.python};
}


async function atomicPublishDirectoryNoReplace(pythonPath, source, target) {
  const code = [
    "import ctypes, errno, os, sys",
    "source, target = os.fsencode(sys.argv[1]), os.fsencode(sys.argv[2])",
    "if os.path.lexists(sys.argv[2]): raise FileExistsError(sys.argv[2])",
    "lib = ctypes.CDLL(None, use_errno=True)",
    "fn = lib.renamex_np",
    "fn.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]",
    "result = fn(source, target, 0x00000004)",
    "if result != 0:",
    "  number = ctypes.get_errno()",
    "  if number in (errno.EEXIST, errno.ENOTEMPTY): raise FileExistsError(sys.argv[2])",
    "  raise OSError(number, os.strerror(number), sys.argv[2])",
  ].join("\n");
  await execFileAsync(pythonPath, ["-I", "-c", code, source, target], {
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}


function assertContactSheetContract(result) {
  const expected = V004C_CONTACT_SHEET_SUPPLEMENT_CONTRACT.contactSheet;
  const actual = result.contactSheet;
  if (
    result.status !== "pass" ||
    actual?.schemaVersion !== expected.builderSchemaVersion ||
    actual?.typography?.path !== expected.fontPath ||
    actual?.typography?.sha256 !== expected.fontSha256 ||
    actual?.typography?.family !== expected.fontFamily ||
    actual?.typography?.regular?.index !== expected.regular.index ||
    actual?.typography?.regular?.weight !== expected.regular.weight ||
    actual?.typography?.bold?.index !== expected.bold.index ||
    actual?.typography?.bold?.weight !== expected.bold.weight ||
    actual?.typography?.cjkGlyphProbe?.text !== expected.cjkGlyphProbe ||
    actual?.typography?.cjkGlyphProbe?.passed !== true ||
    actual?.chineseLabelsReadableByContract !== true
  ) {
    throw new Error("Readable contact-sheet font contract failed");
  }
}


export async function buildV004cContactSheetSupplement() {
  if (await pathExists(TARGET_DIRECTORY)) {
    throw new Error(`Fixed supplement directory already exists: ${TARGET_DIRECTORY}`);
  }
  const sourceDirectoryDetails = await lstat(SOURCE_DIRECTORY);
  if (!sourceDirectoryDetails.isDirectory() || sourceDirectoryDetails.isSymbolicLink()) {
    throw new Error("Source proof candidate must be a plain directory");
  }
  await Promise.all([
    assertPlainFile(CONTACT_SHEET_BUILDER, "fixed-font contact-sheet builder"),
    assertPlainFile(QA_ANALYZER, "QA analyzer"),
    assertPlainFile(
      V004C_CONTACT_SHEET_SUPPLEMENT_CONTRACT.contactSheet.fontPath,
      "pinned Hiragino Sans GB font",
    ),
  ]);
  const sourceBefore = await captureSourceEvidence();
  const sourceManifest = JSON.parse(await readFile(SOURCE_MANIFEST, "utf8"));
  const python = await resolvePinnedPython(sourceManifest);
  const stagingDirectory = resolve(
    REVIEW_CANDIDATES_ROOT,
    `.${TARGET_DIRECTORY_NAME}.part-${randomUUID()}`,
  );
  await mkdir(stagingDirectory, {recursive: false});
  let published = false;
  try {
    const stagingOutput = resolve(stagingDirectory, OUTPUT_FILE_NAME);
    const {stdout} = await execFileAsync(
      python.path,
      [
        "-I",
        CONTACT_SHEET_BUILDER,
        "--analyzer",
        QA_ANALYZER,
        "--qa-dir",
        SOURCE_QA_DIRECTORY,
        "--frame-index",
        SOURCE_FRAME_INDEX,
        "--output",
        stagingOutput,
      ],
      {timeout: 120_000, maxBuffer: 32 * 1024 * 1024},
    );
    const buildResult = JSON.parse(stdout);
    assertContactSheetContract(buildResult);
    const [outputIntegrity, builderIntegrity, analyzerIntegrity, scriptIntegrity] =
      await Promise.all([
        inspectFile(stagingOutput),
        inspectFile(CONTACT_SHEET_BUILDER),
        inspectFile(QA_ANALYZER),
        inspectFile(SCRIPT_PATH),
      ]);
    if (outputIntegrity.sha256 !== buildResult.contactSheet.sha256) {
      throw new Error("Readable contact-sheet hash differs from builder result");
    }
    const sourceAfter = await captureSourceEvidence();
    if (stableEvidenceSnapshot(sourceBefore) !== stableEvidenceSnapshot(sourceAfter)) {
      throw new Error("Source proof candidate changed while building the supplement");
    }
    const manifest = {
      schemaVersion: V004C_CONTACT_SHEET_SUPPLEMENT_CONTRACT.schemaVersion,
      status: V004C_CONTACT_SHEET_SUPPLEMENT_CONTRACT.status,
      createdAt: new Date().toISOString(),
      warning:
        "本目录只补充可读联系表；未修改源 proof-v001、未重渲 MP4，也不构成十分钟成片或真人配音验收。",
      source: {
        candidateDirectory: workspaceRelative(SOURCE_DIRECTORY),
        proofManifest: {
          path: workspaceRelative(SOURCE_MANIFEST),
          ...sourceBefore.manifestIntegrity,
        },
        video: {
          path: workspaceRelative(SOURCE_VIDEO),
          ...sourceBefore.videoIntegrity,
        },
        frameIndex: {
          path: workspaceRelative(SOURCE_FRAME_INDEX),
          ...sourceBefore.frameIndexIntegrity,
        },
        historicalContactSheet: {
          path: workspaceRelative(SOURCE_OLD_CONTACT_SHEET),
          ...sourceBefore.oldSheetIntegrity,
          reused: false,
          reasonReplacedInSupplement: "fallback Arial lacked Chinese glyphs",
        },
        frames: sourceBefore.frames.map((item) => ({
          path: workspaceRelative(resolve(SOURCE_QA_DIRECTORY, item.filename)),
          frame: item.frame,
          globalFrame: item.globalFrame,
          tags: item.tags,
          ...item.integrity,
        })),
      },
      output: {
        path: workspaceRelative(resolve(TARGET_DIRECTORY, OUTPUT_FILE_NAME)),
        ...outputIntegrity,
        width: buildResult.contactSheet.width,
        height: buildResult.contactSheet.height,
      },
      typography: buildResult.contactSheet.typography,
      checks: {
        sourceProofManifestHashMatched: true,
        sourceVideoHashMatched: true,
        sourceFrameIndexHashMatched: true,
        everyIndexedFrameHasBoundHash: true,
        sourceCandidateUnchangedBeforeAndAfter: true,
        cjkGlyphRasterProbePassed: true,
        chineseLabelsReadableByContract: true,
        historicalContactSheetReused: false,
        videoRerendered: false,
      },
      builder: {
        script: {path: workspaceRelative(SCRIPT_PATH), ...scriptIntegrity},
        contactSheet: {
          path: workspaceRelative(CONTACT_SHEET_BUILDER),
          ...builderIntegrity,
        },
        analyzer: {path: workspaceRelative(QA_ANALYZER), ...analyzerIntegrity},
        python: {path: python.path, ...python.integrity, identity: python.identity},
      },
      publication: {
        siblingOfSourceCandidate: true,
        atomicNoReplaceDirectoryRename: true,
        overwritingAllowed: false,
        sourceCandidateModifiedOrDeleted: false,
      },
      acceptanceBoundary: {
        supplementOnly: true,
        videoRerendered: false,
        tenMinuteVisualAcceptance: false,
        continuousOneXWatchCompleted: false,
        finalHumanRecording: false,
        authorizesGitCommitPushPrOrMerge: false,
      },
    };
    const stagingManifest = resolve(stagingDirectory, MANIFEST_FILE_NAME);
    await writeFile(stagingManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await Promise.all([chmod(stagingOutput, 0o444), chmod(stagingManifest, 0o444)]);
    await chmod(stagingDirectory, 0o555);
    await atomicPublishDirectoryNoReplace(
      python.path,
      stagingDirectory,
      TARGET_DIRECTORY,
    );
    published = true;
    return {
      outputPath: resolve(TARGET_DIRECTORY, OUTPUT_FILE_NAME),
      manifestPath: resolve(TARGET_DIRECTORY, MANIFEST_FILE_NAME),
      ...outputIntegrity,
    };
  } finally {
    if (!published && (await pathExists(stagingDirectory))) {
      await chmod(stagingDirectory, 0o755).catch(() => {});
      await rm(stagingDirectory, {recursive: true, force: false});
    }
  }
}


async function main() {
  if (process.argv.length > 2) {
    if (process.argv.length === 3 && ["-h", "--help"].includes(process.argv[2])) {
      process.stdout.write(
        "Build the fixed immutable v004c proof-v001 readable contact-sheet supplement.\n",
      );
      return;
    }
    throw new Error(`Unknown option: ${process.argv[2]}`);
  }
  const result = await buildV004cContactSheetSupplement();
  process.stdout.write(`${JSON.stringify({ok: true, ...result}, null, 2)}\n`);
}


if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
