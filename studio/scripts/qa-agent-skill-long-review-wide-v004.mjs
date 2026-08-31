import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  open,
  realpath,
  readdir,
  readFile,
  rename,
  rmdir,
  rm,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { RenderInternals } from "@remotion/renderer";

import {
  inspectRenderedMedia,
  renderedMediaTechnicalChecks
} from "../src/server/qa.mjs";
import {
  assertLongReviewRenderJobFilesystemSafety,
  validateLongReviewRenderJob
} from "../src/server/production/long-render-job.mjs";
import {
  captureLongReviewCandidateSourceIdentity,
  LONG_REVIEW_PUBLICATION_RECEIPT_FILE_NAME,
  LONG_REVIEW_QA_SCHEMA_VERSION,
  validateLongReviewCandidateManifest,
  validateLongReviewPublicationDurableReceipt
} from "../src/server/production/long-review-qa.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STUDIO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const QA_JOB_ENVIRONMENT_KEY = "AI_CONCEPT_STUDIO_LONG_REVIEW_QA_JOB";
const QA_JOB_CONFIG_PATH = process.env[QA_JOB_ENVIRONMENT_KEY]
  ? resolve(process.env[QA_JOB_ENVIRONMENT_KEY])
  : null;
const CONFIGURED_RENDER_JOB = await (async () => {
  if (!QA_JOB_CONFIG_PATH) return null;
  const pathFromWorkspace = relative(WORKSPACE_ROOT, QA_JOB_CONFIG_PATH);
  if (pathFromWorkspace.startsWith("..") || isAbsolute(pathFromWorkspace)) {
    throw new Error("QA render-job config escapes the workspace");
  }
  await assertPlainFile(QA_JOB_CONFIG_PATH, "QA render-job config");
  const job = validateLongReviewRenderJob(
    JSON.parse(await readFile(QA_JOB_CONFIG_PATH, "utf8")),
    { workspaceRoot: WORKSPACE_ROOT }
  );
  await assertLongReviewRenderJobFilesystemSafety(job, {
    workspaceRoot: WORKSPACE_ROOT,
    jobConfigPath: QA_JOB_CONFIG_PATH
  });
  return job;
})();
const REVIEW_CANDIDATES_ROOT = resolve(
  CONFIGURED_RENDER_JOB
    ? dirname(CONFIGURED_RENDER_JOB.resolvedPaths.finalDirectory)
    : resolve(WORKSPACE_ROOT, "outputs/studio/agent-skill-20260806/review-candidates")
);
const DEFAULT_CANDIDATE_DIRECTORY = CONFIGURED_RENDER_JOB?.resolvedPaths.finalDirectory ??
  resolve(REVIEW_CANDIDATES_ROOT, "full-video-current-visual-upgrade-v004");
const ANALYZER_PATH = resolve(
  STUDIO_ROOT,
  "scripts/qa-agent-skill-long-review-wide-v004.py"
);
const GENERIC_QA_SCRIPT_PATH = resolve(
  STUDIO_ROOT,
  "scripts/qa-agent-skill-long-review.mjs"
);
const LONG_REVIEW_QA_BINDING_PATH = resolve(
  STUDIO_ROOT,
  "src/server/production/long-review-qa.mjs"
);
const QA_MEDIA_INSPECTOR_PATH = resolve(STUDIO_ROOT, "src/server/qa.mjs");
export const PYTHON_RUNTIME_LOCK_PATH = resolve(
  STUDIO_ROOT,
  "scripts/qa-agent-skill-long-review-wide-v004-python-runtime.json"
);
export const PYTHON_REQUIREMENTS_LOCK_PATH = resolve(
  STUDIO_ROOT,
  "scripts/qa-agent-skill-long-review-wide-v004-requirements.lock.txt"
);

const SCENES = Object.freeze([
  { id: "S01", startSecond: 0, endSecond: 30 },
  { id: "S02", startSecond: 30, endSecond: 64 },
  { id: "S03", startSecond: 64, endSecond: 98 },
  { id: "S04", startSecond: 98, endSecond: 132 },
  { id: "S05", startSecond: 132, endSecond: 166 },
  { id: "S06", startSecond: 166, endSecond: 200 },
  { id: "S07", startSecond: 200, endSecond: 234 },
  { id: "S08", startSecond: 234, endSecond: 268 },
  { id: "S09", startSecond: 268, endSecond: 302 },
  { id: "S10", startSecond: 302, endSecond: 336 },
  { id: "S11", startSecond: 336, endSecond: 370 },
  { id: "S12", startSecond: 370, endSecond: 404 },
  { id: "S13", startSecond: 404, endSecond: 438 },
  { id: "S14", startSecond: 438, endSecond: 472 },
  { id: "S15", startSecond: 472, endSecond: 506 },
  { id: "S16", startSecond: 506, endSecond: 540 },
  { id: "S17", startSecond: 540, endSecond: 574 },
  { id: "S18", startSecond: 574, endSecond: 600 }
]);

export const WIDE_V004_QA_CONTRACT = Object.freeze({
  schemaVersion: CONFIGURED_RENDER_JOB
    ? LONG_REVIEW_QA_SCHEMA_VERSION
    : "agent-skill-long-review-wide-v004-qa-pipeline-v2",
  candidateVersion: CONFIGURED_RENDER_JOB?.candidateVersion ?? 4,
  expectedMedia: Object.freeze({
    width: 1920,
    height: 1080,
    fps: 30,
    durationSeconds: 600,
    durationToleranceSeconds: 0.25,
    durationInFrames: 18_000,
    audioCodec: "aac",
    audioSampleRate: 48_000
  }),
  scenes: SCENES,
  representativeFrameFraction: 0.5,
  boundaryOffsetsInFrames: Object.freeze([-8, -1, 0, 1, 8]),
  periodicIntervalSeconds: 2,
  periodicWidth: 480,
  frameExtractionStrategy: "sequential-decode-split-trim-by-frame-index",
  fullFrameExtractionConcurrency: 1,
  periodicExtractionConcurrency: 1,
  finalQaDirectoryName: "qa",
  temporaryQaDirectoryName: "qa.rendering-<pid>-<uuid>",
  sourceVideoNames: Object.freeze(
    CONFIGURED_RENDER_JOB
      ? ["review-10m.mp4"]
      : ["review-10m-wide.mp4", "review-10m.mp4"]
  )
});

function parseArguments(argv) {
  const result = {
    candidateDirectory: DEFAULT_CANDIDATE_DIRECTORY,
    videoPath: null,
    qaDirectoryName: WIDE_V004_QA_CONTRACT.finalQaDirectoryName,
    help: false
  };
  for (const argument of argv) {
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    if (argument.startsWith("--candidate-dir=")) {
      if (CONFIGURED_RENDER_JOB) {
        throw new Error("versioned QA candidate directory is fixed by --job-config");
      }
      const value = argument.slice("--candidate-dir=".length);
      if (!value) throw new Error("--candidate-dir 不能为空");
      result.candidateDirectory = isAbsolute(value)
        ? resolve(value)
        : resolve(WORKSPACE_ROOT, value);
      continue;
    }
    if (argument.startsWith("--video=")) {
      const value = argument.slice("--video=".length);
      if (!value) throw new Error("--video 不能为空");
      result.videoPath = value;
      continue;
    }
    if (argument.startsWith("--qa-dir-name=")) {
      const value = argument.slice("--qa-dir-name=".length);
      if (!/^qa(?:-v[0-9]{3})?$/u.test(value)) {
        throw new Error("--qa-dir-name 只允许 qa 或 qa-vNNN");
      }
      result.qaDirectoryName = value;
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }
  return result;
}

function printHelp() {
  process.stdout.write(`横版 10 分钟候选 v004 的只读媒体 QA 产物流水线。\n\n`);
  process.stdout.write(`用法：\n`);
  process.stdout.write(`  node studio/scripts/qa-agent-skill-long-review-wide-v004.mjs \\\n`);
  process.stdout.write(`    [--candidate-dir=outputs/.../full-video-current-visual-upgrade-v004] \\\n`);
  process.stdout.write(`    [--video=review-10m-wide.mp4] \\\n`);
  process.stdout.write(`    [--qa-dir-name=qa-v002]\n\n`);
  process.stdout.write(`输出：候选目录下全新 qa/ 或 qa-vNNN/；如果目标已存在则拒绝覆盖。\n`);
}

function ensureInside(root, candidate, label) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const pathFromRoot = relative(resolvedRoot, resolvedCandidate);
  if (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  ) {
    return resolvedCandidate;
  }
  throw new Error(`${label} 超出允许范围：${resolvedCandidate}`);
}

function workspaceRelative(filePath) {
  return relative(WORKSPACE_ROOT, filePath).replaceAll("\\", "/");
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertPlainFile(filePath, label) {
  let fileStat;
  try {
    fileStat = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label}不存在：${workspaceRelative(filePath)}`);
    }
    throw error;
  }
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`${label}必须是普通文件且不能是符号链接：${workspaceRelative(filePath)}`);
  }
  return fileStat;
}

async function assertPlainDirectory(directory, label) {
  let directoryStat;
  try {
    directoryStat = await lstat(directory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label}不存在：${workspaceRelative(directory)}`);
    }
    throw error;
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`${label}必须是普通目录且不能是符号链接：${workspaceRelative(directory)}`);
  }
}

async function assertExistingRealPathInside(root, candidate, label) {
  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate)
  ]);
  const pathFromRoot = relative(resolvedRoot, resolvedCandidate);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} 经真实路径解析后超出允许范围：${resolvedCandidate}`);
  }
  return resolvedCandidate;
}

function statIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    mtimeNs: stat.mtimeNs
  };
}

function sameIdentity(left, right, { metadata = true } = {}) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    (!metadata || (left.size === right.size && left.mtimeNs === right.mtimeNs));
}

async function capturePathGuard(root, candidate, label, expectedType) {
  const lexicalRoot = resolve(root);
  const lexicalCandidate = ensureInside(lexicalRoot, candidate, label);
  const canonicalRoot = await realpath(lexicalRoot);
  const segments = relative(lexicalRoot, lexicalCandidate).split(sep).filter(Boolean);
  const chain = [];
  let current = lexicalRoot;
  for (const segment of [null, ...segments]) {
    if (segment !== null) current = resolve(current, segment);
    const stat = await lstat(current, { bigint: true });
    if (stat.isSymbolicLink()) throw new Error(`${label} 路径祖先不能是符号链接：${current}`);
    const canonicalCurrent = await realpath(current);
    const pathFromRoot = relative(canonicalRoot, canonicalCurrent);
    if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
      throw new Error(`${label} 经真实路径解析后超出允许范围：${canonicalCurrent}`);
    }
    chain.push({ path: current, identity: statIdentity(stat) });
  }
  const leaf = await lstat(lexicalCandidate, { bigint: true });
  if (expectedType === "file" && !leaf.isFile()) throw new Error(`${label} 必须是普通文件`);
  if (expectedType === "directory" && !leaf.isDirectory()) throw new Error(`${label} 必须是普通目录`);
  return { root: lexicalRoot, path: lexicalCandidate, label, expectedType, chain };
}

async function verifyPathGuard(guard, { allowLeafMetadataChange = false } = {}) {
  const current = await capturePathGuard(
    guard.root,
    guard.path,
    guard.label,
    guard.expectedType
  );
  if (current.chain.length !== guard.chain.length) {
    throw new Error(`${guard.label} 路径层级在 QA 期间发生变化`);
  }
  for (let index = 0; index < guard.chain.length; index += 1) {
    const before = guard.chain[index];
    const after = current.chain[index];
    const isLeaf = index === guard.chain.length - 1;
    if (
      before.path !== after.path ||
      !sameIdentity(before.identity, after.identity, {
        metadata: !(isLeaf && allowLeafMetadataChange) && isLeaf
      })
    ) {
      throw new Error(`${guard.label} inode 或元数据在 QA 期间发生变化：${before.path}`);
    }
  }
  return current;
}

export async function captureQaCandidatePathGuards({
  reviewCandidatesRoot,
  candidateDirectory,
  videoPath,
  manifestPath,
  publicationReceiptPath = null
}) {
  const guards = {
    candidate: await capturePathGuard(
      reviewCandidatesRoot,
      candidateDirectory,
      "候选目录",
      "directory"
    ),
    video: await capturePathGuard(candidateDirectory, videoPath, "源 MP4", "file"),
    manifest: await capturePathGuard(
      candidateDirectory,
      manifestPath,
      "候选 manifest",
      "file"
    )
  };
  if (publicationReceiptPath) {
    guards.publicationReceipt = await capturePathGuard(
      candidateDirectory,
      publicationReceiptPath,
      "durable publication receipt",
      "file"
    );
  }
  return guards;
}

export async function verifyQaCandidatePathGuards(
  guards,
  { allowCandidateMetadataChange = false } = {}
) {
  const candidate = await verifyPathGuard(guards.candidate, {
    allowLeafMetadataChange: allowCandidateMetadataChange
  });
  await verifyPathGuard(guards.video);
  await verifyPathGuard(guards.manifest);
  if (guards.publicationReceipt) {
    await verifyPathGuard(guards.publicationReceipt);
  }
  return { ...guards, candidate };
}

async function sha256(filePath) {
  const handle = await open(filePath, "r");
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error(`哈希目标必须是普通文件：${filePath}`);
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(filePath, { bigint: true });
    if (
      pathAfter.isSymbolicLink() ||
      !sameIdentity(statIdentity(before), statIdentity(after)) ||
      !sameIdentity(statIdentity(after), statIdentity(pathAfter))
    ) {
      throw new Error(`文件在哈希期间被替换或修改：${workspaceRelative(filePath)}`);
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

async function inspectFile(filePath) {
  const fileStat = await assertPlainFile(filePath, "QA 文件");
  return {
    path: workspaceRelative(filePath),
    bytes: fileStat.size,
    sha256: await sha256(filePath)
  };
}

function rationalToNumber(value) {
  if (typeof value !== "string") return Number.NaN;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return Number.NaN;
  }
  return numerator / denominator;
}

function runProcess(executable, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
    const maxOutputBytes = options.maxOutputBytes ?? 16 * 1024 * 1024;
    const child = spawn(executable, args, {
      cwd: WORKSPACE_ROOT,
      env: options.env ?? process.env,
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settle(reject, new Error(
        `${basename(executable)} 超过 ${timeoutMs}ms 未完成，已终止以避免无限挂起`
      ));
    }, timeoutMs);
    timeout.unref?.();
    if (!options.inherit) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      const capture = (target, chunk) => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > maxOutputBytes) {
          child.kill("SIGKILL");
          settle(reject, new Error(
            `${basename(executable)} 输出超过 ${maxOutputBytes} bytes，已终止`
          ));
          return target;
        }
        return target + chunk;
      };
      child.stdout.on("data", (chunk) => { stdout = capture(stdout, chunk); });
      child.stderr.on("data", (chunk) => { stderr = capture(stderr, chunk); });
    }
    child.on("error", (error) => settle(reject, error));
    child.on("exit", (code, signal) => {
      if (code !== 0) {
        settle(reject, new Error(
          `${basename(executable)} 失败：code=${code} signal=${signal ?? "none"}` +
          (stderr ? `\n${stderr.trim()}` : "")
        ));
        return;
      }
      settle(resolveRun, { stdout, stderr });
    });
  });
}

async function findRemotionTool(toolName) {
  const overrideName = toolName === "ffmpeg" ? "QA_FFMPEG" : "QA_FFPROBE";
  const override = process.env[overrideName];
  if (override) {
    const resolvedOverride = resolve(override);
    await assertPlainFile(resolvedOverride, overrideName);
    return { path: resolvedOverride, libraryDirectory: dirname(resolvedOverride), source: overrideName };
  }

  const candidate = RenderInternals.getExecutablePath({
    type: toolName,
    indent: false,
    logLevel: "error",
    binariesDirectory: null
  });
  await assertPlainFile(candidate, `package-lock 解析的 Remotion ${toolName}`);
  return {
    path: candidate,
    libraryDirectory: dirname(candidate),
    source: "@remotion/renderer:RenderInternals.getExecutablePath"
  };
}

function toolEnvironment(...tools) {
  const libraryDirectory = tools.find((tool) => tool.libraryDirectory)?.libraryDirectory;
  if (!libraryDirectory) return process.env;
  return { ...process.env, DYLD_LIBRARY_PATH: libraryDirectory };
}

export function validatePythonRuntimeIdentity(identity, lock) {
  if (lock?.schemaVersion !== "agent-skill-long-review-wide-v004-python-runtime-lock-v1") {
    throw new Error("QA Python runtime lock schema 无效");
  }
  if (lock?.requirementsLock !== basename(PYTHON_REQUIREMENTS_LOCK_PATH)) {
    throw new Error("QA Python requirements lock 未绑定到 runtime lock");
  }
  const mismatches = [];
  if (identity?.pythonVersion !== lock.pythonVersion) {
    mismatches.push(`python expected=${lock.pythonVersion} actual=${identity?.pythonVersion ?? "missing"}`);
  }
  if (identity?.implementation !== lock.implementation) {
    mismatches.push(
      `implementation expected=${lock.implementation} actual=${identity?.implementation ?? "missing"}`
    );
  }
  for (const packageName of ["numpy", "Pillow"]) {
    if (identity?.packages?.[packageName] !== lock?.packages?.[packageName]) {
      mismatches.push(
        `${packageName} expected=${lock?.packages?.[packageName] ?? "missing"} ` +
        `actual=${identity?.packages?.[packageName] ?? "missing"}`
      );
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`QA Python runtime 不符合仓库锁：${mismatches.join("; ")}`);
  }
  return true;
}

export async function resolveLockedPythonRuntime() {
  await Promise.all([
    assertPlainFile(PYTHON_RUNTIME_LOCK_PATH, "QA Python runtime lock"),
    assertPlainFile(PYTHON_REQUIREMENTS_LOCK_PATH, "QA Python requirements lock")
  ]);
  const lock = JSON.parse(await readFile(PYTHON_RUNTIME_LOCK_PATH, "utf8"));
  let pythonPath;
  let source;
  if (process.env.QA_PYTHON) {
    pythonPath = resolve(process.env.QA_PYTHON);
    source = "QA_PYTHON";
    pythonPath = await realpath(pythonPath);
    await assertPlainFile(pythonPath, "QA_PYTHON resolved target");
  } else {
    pythonPath = resolve(
      homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
    );
    source = "codex-bundled-runtime";
    if (!(await pathExists(pythonPath))) {
      throw new Error(
        "未找到锁定的 Codex Python runtime；请用 QA_PYTHON 明确指定满足仓库锁的解释器"
      );
    }
    pythonPath = await realpath(pythonPath);
    await assertPlainFile(pythonPath, "Codex bundled Python resolved target");
  }
  const inspectionCode = [
    "import json, platform, sys",
    "import numpy",
    "import PIL",
    "print(json.dumps({",
    "  'pythonVersion': platform.python_version(),",
    "  'implementation': platform.python_implementation(),",
    "  'executable': sys.executable,",
    "  'packages': {'numpy': numpy.__version__, 'Pillow': PIL.__version__}",
    "}, sort_keys=True))"
  ].join("\n");
  const { stdout } = await runProcess(pythonPath, ["-I", "-c", inspectionCode]);
  const identity = JSON.parse(stdout);
  validatePythonRuntimeIdentity(identity, lock);
  return {
    path: pythonPath,
    source,
    identity,
    lock,
    lockFile: await inspectFile(PYTHON_RUNTIME_LOCK_PATH),
    requirementsLockFile: await inspectFile(PYTHON_REQUIREMENTS_LOCK_PATH)
  };
}

export async function captureQaSourceIdentity() {
  const sourcePaths = [
    SCRIPT_PATH,
    ...(CONFIGURED_RENDER_JOB
      ? [GENERIC_QA_SCRIPT_PATH, LONG_REVIEW_QA_BINDING_PATH, QA_JOB_CONFIG_PATH]
      : []),
    ANALYZER_PATH,
    QA_MEDIA_INSPECTOR_PATH,
    PYTHON_RUNTIME_LOCK_PATH,
    PYTHON_REQUIREMENTS_LOCK_PATH
  ];
  const pathspecs = sourcePaths.map((path) => workspaceRelative(path));
  const [head, status, diff, sourceFiles] = await Promise.all([
    runProcess("git", ["rev-parse", "HEAD"], { timeoutMs: 30_000 }),
    runProcess("git", ["status", "--porcelain=v1", "--", ...pathspecs], {
      timeoutMs: 30_000
    }),
    runProcess("git", ["diff", "--binary", "--no-ext-diff", "HEAD", "--", ...pathspecs], {
      timeoutMs: 30_000,
      maxOutputBytes: 32 * 1024 * 1024
    }),
    Promise.all(sourcePaths.map(inspectFile))
  ]);
  const gitHead = head.stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(gitHead)) throw new Error(`Git HEAD 无效：${gitHead}`);
  const worktreePayload = {
    statusPorcelain: status.stdout,
    diffSha256: createHash("sha256").update(diff.stdout).digest("hex"),
    sourceFiles
  };
  return {
    gitHead,
    dirty: status.stdout.length > 0,
    worktreeSha256: createHash("sha256")
      .update(JSON.stringify(worktreePayload))
      .digest("hex"),
    sourceFiles
  };
}

async function toolVersion(tool, env) {
  const result = await runProcess(tool.path, ["-version"], { env });
  const text = `${result.stdout}\n${result.stderr}`.trim();
  return text.split(/\r?\n/u)[0] ?? "unknown";
}

async function resolveVideoPath(candidateDirectory, videoArgument) {
  if (videoArgument) {
    const candidate = isAbsolute(videoArgument)
      ? resolve(videoArgument)
      : resolve(candidateDirectory, videoArgument);
    return ensureInside(candidateDirectory, candidate, "源 MP4");
  }
  const existing = [];
  for (const name of WIDE_V004_QA_CONTRACT.sourceVideoNames) {
    const candidate = resolve(candidateDirectory, name);
    if (await pathExists(candidate)) existing.push(candidate);
  }
  if (existing.length === 0) {
    throw new Error(
      `源 MP4 不存在；候选目录中需要唯一一个：${WIDE_V004_QA_CONTRACT.sourceVideoNames.join(" 或 ")}`
    );
  }
  if (existing.length > 1) {
    throw new Error(`发现多个可能的源 MP4；请用 --video 明确指定：${existing.map(workspaceRelative).join(", ")}`);
  }
  return existing[0];
}

export function qaArtifactPaths({
  candidateDirectory,
  qaDirectoryName,
  runId = `${process.pid}-${randomUUID()}`
}) {
  const stagingRoot = dirname(candidateDirectory);
  const candidateName = basename(candidateDirectory);
  return {
    finalQaDirectory: ensureInside(
      candidateDirectory,
      resolve(candidateDirectory, qaDirectoryName),
      "最终 QA 目录"
    ),
    temporaryQaDirectory: ensureInside(
      stagingRoot,
      resolve(stagingRoot, `.${candidateName}.${qaDirectoryName}.rendering-${runId}`),
      "临时 QA 目录"
    ),
    publicationLockDirectory: ensureInside(
      stagingRoot,
      resolve(stagingRoot, `.${candidateName}.${qaDirectoryName}.publish-lock`),
      "QA 发布锁"
    )
  };
}

async function publishQaArtifactDirectory({
  temporaryQaDirectory,
  finalQaDirectory,
  publicationLockDirectory,
  assertPathsCurrent = async () => {},
  validationContext
}) {
  if (!validationContext) {
    throw new TypeError("QA publication requires a complete validation context");
  }
  await validateLongReviewAnalyzerArtifacts({
    qaDirectory: temporaryQaDirectory,
    ...validationContext
  });
  await assertPathsCurrent("before-publication-lock");
  try {
    await mkdir(publicationLockDirectory, { recursive: false });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`同一 QA 版本正在发布，拒绝并发覆盖：${workspaceRelative(publicationLockDirectory)}`);
    }
    throw error;
  }
  try {
    await assertPathsCurrent("after-publication-lock");
    if (await pathExists(finalQaDirectory)) {
      throw new Error(`最终 QA 目录已存在；为保留旧产物，拒绝覆盖：${workspaceRelative(finalQaDirectory)}`);
    }
    await validateLongReviewAnalyzerArtifacts({
      qaDirectory: temporaryQaDirectory,
      ...validationContext
    });
    await assertPathsCurrent("before-publication-rename");
    await rename(temporaryQaDirectory, finalQaDirectory);
    await assertPathsCurrent("after-publication-rename", {
      allowCandidateMetadataChange: true,
      skipTemporaryDirectory: true
    });
    await assertPlainDirectory(finalQaDirectory, "已发布 QA 目录");
    await assertExistingRealPathInside(
      dirname(finalQaDirectory),
      finalQaDirectory,
      "已发布 QA 目录"
    );
  } finally {
    await rmdir(publicationLockDirectory).catch((error) => {
      process.stderr.write(
        `警告：QA 发布锁清理失败，但不会把已完成的原子发布误报为失败：${error.message}\n`
      );
    });
  }
}

function frameForSecond(second) {
  return Math.max(
    0,
    Math.min(
      WIDE_V004_QA_CONTRACT.expectedMedia.durationInFrames - 1,
      Math.round(second * WIDE_V004_QA_CONTRACT.expectedMedia.fps)
    )
  );
}

function buildFramePlan() {
  const fullByFrame = new Map();
  const periodicByFrame = new Map();
  const add = (map, rawFrame, tag) => {
    const frame = Math.max(
      0,
      Math.min(WIDE_V004_QA_CONTRACT.expectedMedia.durationInFrames - 1, Math.round(rawFrame))
    );
    const tags = map.get(frame) ?? [];
    if (!tags.includes(tag)) tags.push(tag);
    map.set(frame, tags);
  };

  add(fullByFrame, 0, "endpoint:first");
  add(
    fullByFrame,
    WIDE_V004_QA_CONTRACT.expectedMedia.durationInFrames - 1,
    "endpoint:last"
  );

  for (const scene of SCENES) {
    const representativeSecond = scene.startSecond +
      (scene.endSecond - scene.startSecond) * WIDE_V004_QA_CONTRACT.representativeFrameFraction;
    add(fullByFrame, frameForSecond(representativeSecond), `representative:${scene.id}`);
  }

  for (let index = 1; index < SCENES.length; index += 1) {
    const previous = SCENES[index - 1];
    const next = SCENES[index];
    const boundaryFrame = frameForSecond(next.startSecond);
    for (const offset of WIDE_V004_QA_CONTRACT.boundaryOffsetsInFrames) {
      add(fullByFrame, boundaryFrame + offset, `boundary:${previous.id}>${next.id}:offset:${offset}`);
    }
  }

  for (
    let second = 0;
    second < WIDE_V004_QA_CONTRACT.expectedMedia.durationSeconds;
    second += WIDE_V004_QA_CONTRACT.periodicIntervalSeconds
  ) {
    add(periodicByFrame, frameForSecond(second), `periodic:${second}`);
  }
  add(
    periodicByFrame,
    WIDE_V004_QA_CONTRACT.expectedMedia.durationInFrames - 1,
    `periodic:${WIDE_V004_QA_CONTRACT.expectedMedia.durationSeconds - 1 / 30}`
  );

  const toSamples = (map, directoryName) => [...map.entries()]
    .sort(([left], [right]) => left - right)
    .map(([frame, tags]) => ({
      frame,
      second: frame / WIDE_V004_QA_CONTRACT.expectedMedia.fps,
      tags,
      filename: `${directoryName}/frame-${String(frame).padStart(6, "0")}.png`
    }));

  const fullSamples = toSamples(fullByFrame, "frames/full");
  const periodicSamples = toSamples(periodicByFrame, "frames/periodic");
  const representativeCount = fullSamples.reduce(
    (count, item) => count + item.tags.filter((tag) => tag.startsWith("representative:")).length,
    0
  );
  const boundaryCount = fullSamples.reduce(
    (count, item) => count + item.tags.filter((tag) => tag.startsWith("boundary:")).length,
    0
  );
  if (representativeCount !== SCENES.length) {
    throw new Error(`代表帧计划错误：expected=${SCENES.length} actual=${representativeCount}`);
  }
  const expectedBoundaryCount = (SCENES.length - 1) *
    WIDE_V004_QA_CONTRACT.boundaryOffsetsInFrames.length;
  if (boundaryCount !== expectedBoundaryCount) {
    throw new Error(`边界帧计划错误：expected=${expectedBoundaryCount} actual=${boundaryCount}`);
  }
  return { fullSamples, periodicSamples };
}

export function buildExactFrameExtractionArgs({
  samples,
  videoPath,
  qaDirectory,
  periodic = false
}) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("精确抽帧计划不能为空");
  }
  const sourceLabels = samples.map((_, index) => `[source-${index}]`).join("");
  const filterSteps = [`[0:v:0]split=${samples.length}${sourceLabels}`];
  for (const [index, sample] of samples.entries()) {
    if (!Number.isSafeInteger(sample.frame) || sample.frame < 0) {
      throw new Error(`精确抽帧编号无效：${sample.frame}`);
    }
    const scale = periodic
      ? `,scale=${WIDE_V004_QA_CONTRACT.periodicWidth}:-2:flags=lanczos`
      : "";
    filterSteps.push(
      `[source-${index}]trim=start_frame=${sample.frame}:end_frame=${sample.frame + 1}` +
      `${scale}[frame-${index}]`
    );
  }

  const args = [
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    "-filter_complex_threads", "1",
    "-n",
    "-i", videoPath,
    "-filter_complex", filterSteps.join(";")
  ];
  for (const [index, sample] of samples.entries()) {
    args.push(
      "-map", `[frame-${index}]`,
      "-frames:v", "1",
      "-c:v", "png",
      resolve(qaDirectory, sample.filename)
    );
  }
  return args;
}

export async function extractSamples({ samples, videoPath, qaDirectory, ffmpeg, env, periodic }) {
  const args = buildExactFrameExtractionArgs({
    samples,
    videoPath,
    qaDirectory,
    periodic
  });
  await runProcess(ffmpeg, args, { env });
  for (const sample of samples) {
    await assertPlainFile(resolve(qaDirectory, sample.filename), "提取帧");
  }
  process.stdout.write(
    `${periodic ? "周期" : "代表/边界"}帧：${samples.length}/${samples.length}（顺序解码，按帧索引精确提取）\n`
  );
}

export function evaluateWideV004MediaProbe(raw) {
  const video = raw.streams?.find((stream) => stream.codec_type === "video") ?? null;
  const audio = raw.streams?.find((stream) => stream.codec_type === "audio") ?? null;
  const actualFps = rationalToNumber(video?.avg_frame_rate);
  const actualFrames = decodedVideoFrameCount(video);
  const duration = Number(raw.format?.duration);
  const expected = WIDE_V004_QA_CONTRACT.expectedMedia;
  const checks = {
    mp4Container: raw.format?.format_name?.split(",").includes("mp4") === true,
    width1920: video?.width === expected.width,
    height1080: video?.height === expected.height,
    fps30: Math.abs(actualFps - expected.fps) < 0.0001,
    durationApproximately600Seconds:
      Number.isFinite(duration) && Math.abs(duration - expected.durationSeconds) <= expected.durationToleranceSeconds,
    exactly18000VideoFrames: actualFrames === expected.durationInFrames,
    h264Video: video?.codec_name === "h264",
    yuv420p: video?.pix_fmt === "yuv420p",
    exactlyOneAudioTrack:
      raw.streams?.filter((stream) => stream.codec_type === "audio").length === 1,
    aacAudio: audio?.codec_name === expected.audioCodec,
    audioSampleRate48k: Number(audio?.sample_rate) === expected.audioSampleRate
  };
  return { video, audio, actualFps, actualFrames, duration, expected, checks };
}

export function validateWideV004CandidateManifest(manifest, videoIntegrity, videoPath) {
  const expected = WIDE_V004_QA_CONTRACT.expectedMedia;
  const checks = {
    finalManifestSchema:
      manifest?.schemaVersion === "agent-skill-long-review-wide-v004-chunked-final-v1",
    renderContractSchema:
      manifest?.contract?.schemaVersion === "agent-skill-long-review-wide-v004-chunked-v1",
    candidateVersion: manifest?.contract?.candidateVersion === 4,
    episodeId: manifest?.contract?.episodeId === "agent-skill-20260806",
    compositionId: manifest?.contract?.compositionId === "AgentSkillLongReview",
    dimensions: manifest?.contract?.width === expected.width
      && manifest?.contract?.height === expected.height,
    timeline: manifest?.contract?.fps === expected.fps
      && manifest?.contract?.durationInFrames === expected.durationInFrames,
    finalMediaSchema:
      manifest?.finalMedia?.schemaVersion ===
        "agent-skill-long-review-wide-v004-final-media-v1",
    finalMediaBytes: manifest?.finalMedia?.file?.bytes === videoIntegrity?.bytes,
    finalMediaSha256: manifest?.finalMedia?.file?.sha256 === videoIntegrity?.sha256,
    publishedOutputPath: manifest?.publication?.outputPath === workspaceRelative(videoPath)
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`候选 manifest 未强绑定本次 v004 MP4：${failed.join(", ")}`);
  }
  return { passed: true, checks };
}

export function validateConfiguredLongReviewCandidateManifest(
  manifest,
  videoIntegrity,
  videoPath,
  currentInputIdentity = null,
  requireCurrentInputIdentity = true
) {
  if (!CONFIGURED_RENDER_JOB) {
    return validateWideV004CandidateManifest(manifest, videoIntegrity, videoPath);
  }
  return validateLongReviewCandidateManifest({
    manifest,
    job: CONFIGURED_RENDER_JOB,
    videoIntegrity,
    videoPath,
    workspaceRoot: WORKSPACE_ROOT,
    currentInputIdentity,
    requireCurrentInputIdentity
  });
}

export async function probeMedia({ videoPath, manifestPath, ffprobe, env }) {
  const { stdout } = await runProcess(ffprobe, [
    "-v", "error",
    "-count_frames",
    "-count_packets",
    "-show_entries",
    "format=format_name,format_long_name,start_time,duration,bit_rate,size:" +
      "stream=index,codec_type,codec_name,profile,codec_tag_string,width,height,pix_fmt," +
      "r_frame_rate,avg_frame_rate,time_base,start_time,duration,nb_frames,nb_read_frames," +
      "nb_read_packets,sample_rate,channels,channel_layout",
    "-of", "json",
    videoPath
  ], { env });
  const raw = JSON.parse(stdout);
  const { video, actualFps, actualFrames, duration, expected, checks } =
    evaluateWideV004MediaProbe(raw);
  return {
    schemaVersion: CONFIGURED_RENDER_JOB
      ? "agent-skill-long-review-media-metadata-v1"
      : "agent-skill-long-review-wide-v004-media-metadata-v1",
    generatedAt: new Date().toISOString(),
    source: {
      video: await inspectFile(videoPath),
      manifest: manifestPath ? await inspectFile(manifestPath) : null
    },
    expected,
    format: raw.format,
    streams: raw.streams,
    normalized: {
      durationSeconds: duration,
      videoFrameCount: actualFrames,
      declaredVideoFrameCount: Number(video?.nb_frames),
      readVideoPacketCount: Number(video?.nb_read_packets),
      videoFps: actualFps,
      width: video?.width ?? null,
      height: video?.height ?? null
    },
    checks,
    status: Object.values(checks).every(Boolean) ? "pass" : "review_required"
  };
}

async function listFilesRecursively(directory) {
  const files = [];
  const visit = async (current) => {
    const entries = (await readdir(current, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const candidate = resolve(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`QA 产物中不允许符号链接：${candidate}`);
      if (entry.isDirectory()) await visit(candidate);
      if (entry.isFile()) files.push(candidate);
    }
  };
  await visit(directory);
  return files;
}

async function readStableArtifact(filePath, label) {
  const before = await inspectFile(filePath);
  const contents = await readFile(filePath);
  const after = await inspectFile(filePath);
  if (
    JSON.stringify(before) !== JSON.stringify(after) ||
    contents.length !== before.bytes ||
    createHash("sha256").update(contents).digest("hex") !== before.sha256
  ) {
    throw new Error(`${label} 在读取期间发生变化`);
  }
  return contents;
}

async function readStableJsonArtifact(filePath, label) {
  const contents = await readStableArtifact(filePath, label);
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} 不是有效 JSON：${error.message}`);
  }
}

export async function validateLongReviewAnalyzerArtifacts({
  qaDirectory,
  contract,
  candidateManifestBinding,
  sourceVideo,
  sourceManifest,
  sourcePublicationReceipt = null,
  publicationReceiptBinding = null
}) {
  const generic = contract.schemaVersion === LONG_REVIEW_QA_SCHEMA_VERSION;
  const expected = {
    summary: generic
      ? "agent-skill-long-review-qa-summary-v1"
      : "agent-skill-long-review-wide-v004-qa-summary-v1",
    metrics: generic
      ? "agent-skill-long-review-frame-analysis-v1"
      : "agent-skill-long-review-wide-v004-frame-analysis-v1"
  };
  const [runManifest, mediaEvidence, frameIndex, metrics, summary, reportBytes] =
    await Promise.all([
      readStableJsonArtifact(resolve(qaDirectory, "run-manifest.json"), "QA run manifest"),
      readStableJsonArtifact(
        resolve(qaDirectory, "media-integrity-evidence.json"),
        "媒体完整性证据"
      ),
      readStableJsonArtifact(resolve(qaDirectory, "frame-index.json"), "帧索引"),
      readStableJsonArtifact(resolve(qaDirectory, "frame-metrics.json"), "帧指标"),
      readStableJsonArtifact(resolve(qaDirectory, "qa-summary.json"), "QA summary"),
      readStableArtifact(resolve(qaDirectory, "QA-REPORT.md"), "QA 报告")
    ]);
  const categories = summary?.manualReview?.categories;
  const report = reportBytes.toString("utf8");
  const checks = {
    runManifestSchema: runManifest?.schemaVersion === contract.schemaVersion,
    runManifestCandidateVersion:
      runManifest?.contract?.candidateVersion === contract.candidateVersion,
    runManifestBinding:
      runManifest?.candidateManifestBinding?.passed === true &&
      JSON.stringify(runManifest.candidateManifestBinding) ===
        JSON.stringify(candidateManifestBinding),
    runManifestSource:
      JSON.stringify(runManifest?.sourceVideo) === JSON.stringify(sourceVideo) &&
      JSON.stringify(runManifest?.sourceManifest) === JSON.stringify(sourceManifest),
    runManifestPublicationReceipt: generic
      ? runManifest?.publicationReceiptBinding?.passed === true &&
        JSON.stringify(runManifest.publicationReceiptBinding) ===
          JSON.stringify(publicationReceiptBinding) &&
        JSON.stringify(runManifest.sourcePublicationReceipt) ===
          JSON.stringify(sourcePublicationReceipt)
      : runManifest?.publicationReceiptBinding == null &&
        runManifest?.sourcePublicationReceipt == null,
    runManifestManualPending:
      runManifest?.guarantees?.manualVisualJudgmentsRemainPending === true,
    mediaEvidenceMachineOnly:
      mediaEvidence?.machineOnly === true &&
      mediaEvidence?.manualPlaybackRequired === true &&
      mediaEvidence?.passed === true,
    frameIndexCandidateVersion:
      frameIndex?.candidateVersion === contract.candidateVersion,
    summarySchema: summary?.schemaVersion === expected.summary,
    summaryCandidateVersion: summary?.candidateVersion === contract.candidateVersion,
    summarySource:
      JSON.stringify(summary?.candidate?.video) === JSON.stringify(sourceVideo) &&
      JSON.stringify(summary?.candidate?.manifest) === JSON.stringify(sourceManifest),
    summaryNotRegistered:
      summary?.candidate?.registered === false &&
      summary?.candidate?.approvalStatus === "not_approved",
    summaryPending:
      summary?.status === "pending_manual_visual_review" &&
      summary?.manualReview?.status === "pending",
    categoriesPending:
      Array.isArray(categories) &&
      categories.length > 0 &&
      categories.every((category) => category?.status === "pending"),
    metricsSchema: metrics?.schemaVersion === expected.metrics,
    metricsCandidateVersion: metrics?.candidateVersion === contract.candidateVersion,
    reportCandidateVersion:
      report.includes(`v${String(contract.candidateVersion).padStart(3, "0")}`),
    reportPending:
      report.includes("待人工视觉审查") && report.includes("不代表视觉批准"),
    reportNotApproved:
      !/(?:\baccepted\b|\bapproved\b|已批准|视觉批准[：:]?\s*通过)/iu.test(report)
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`Python analyzer 产物未保持正式 QA 的 pending 绑定：${failed.join(", ")}`);
  }
  return { passed: true, checks };
}

async function writeArtifactIndex(qaDirectory, sentinelPath) {
  const indexPath = resolve(qaDirectory, "artifact-index.json");
  const checksumPath = resolve(qaDirectory, "qa-artifacts.sha256");
  const excluded = new Set([sentinelPath, indexPath, checksumPath]);
  const files = (await listFilesRecursively(qaDirectory)).filter((filePath) => !excluded.has(filePath));
  const artifacts = [];
  for (const filePath of files) {
    const inspected = await inspectFile(filePath);
    artifacts.push({
      ...inspected,
      path: relative(qaDirectory, filePath).replaceAll("\\", "/")
    });
  }
  const index = {
    schemaVersion: CONFIGURED_RENDER_JOB
      ? "agent-skill-long-review-artifact-index-v1"
      : "agent-skill-long-review-wide-v004-artifact-index-v1",
    generatedAt: new Date().toISOString(),
    artifactCount: artifacts.length,
    artifacts
  };
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  const checksumFiles = [...files, indexPath];
  const checksumLines = [];
  for (const filePath of checksumFiles) {
    checksumLines.push(`${await sha256(filePath)}  ${relative(qaDirectory, filePath).replaceAll("\\", "/")}`);
  }
  await writeFile(checksumPath, `${checksumLines.join("\n")}\n`, "utf8");
  return { indexPath, checksumPath, artifactCount: artifacts.length + 2 };
}

export async function runAgentSkillLongReviewQa(
  argv = process.argv.slice(2)
) {
  if (arguments.length > 1) {
    throw new TypeError("production long-review QA does not accept dependency injection");
  }
  const arguments_ = parseArguments(argv);
  if (arguments_.help) {
    printHelp();
    return;
  }

  const candidateDirectory = ensureInside(
    REVIEW_CANDIDATES_ROOT,
    arguments_.candidateDirectory,
    "候选目录"
  );
  if (
    CONFIGURED_RENDER_JOB &&
    candidateDirectory !== resolve(CONFIGURED_RENDER_JOB.resolvedPaths.finalDirectory)
  ) {
    throw new Error("候选目录与显式 render-job 不一致");
  }
  if (!CONFIGURED_RENDER_JOB && !/(?:^|[-_])v004(?:$|[-_.])/u.test(basename(candidateDirectory))) {
    throw new Error(`本脚本只允许写入 v004 候选目录：${workspaceRelative(candidateDirectory)}`);
  }
  if (!(await pathExists(candidateDirectory))) {
    throw new Error(
      `源 MP4 不存在：候选目录尚未生成 ${workspaceRelative(candidateDirectory)}`
    );
  }
  await assertPlainDirectory(candidateDirectory, "候选目录");
  await assertExistingRealPathInside(REVIEW_CANDIDATES_ROOT, candidateDirectory, "候选目录");

  const videoPath = await resolveVideoPath(candidateDirectory, arguments_.videoPath);
  await assertPlainFile(videoPath, "源 MP4");
  await assertExistingRealPathInside(candidateDirectory, videoPath, "源 MP4");
  if (videoPath.slice(-4).toLowerCase() !== ".mp4") {
    throw new Error(`源视频必须是 MP4：${workspaceRelative(videoPath)}`);
  }
  const manifestCandidate = resolve(candidateDirectory, "review-manifest.json");
  if (!(await pathExists(manifestCandidate))) {
    throw new Error("正式 QA 必须绑定 review-manifest.json；未找到时拒绝生成不可追溯证据");
  }
  const manifestPath = manifestCandidate;
  await assertPlainFile(manifestPath, "候选 manifest");
  await assertExistingRealPathInside(candidateDirectory, manifestPath, "候选 manifest");
  const candidateManifestBytes = await readFile(manifestPath);
  const candidateManifestIntegrityBefore = await inspectFile(manifestPath);
  if (
    candidateManifestBytes.length !== candidateManifestIntegrityBefore.bytes ||
    createHash("sha256").update(candidateManifestBytes).digest("hex") !==
      candidateManifestIntegrityBefore.sha256
  ) {
    throw new Error("候选 manifest 在读取时发生变化；拒绝使用非原子快照");
  }
  let candidateManifest;
  try {
    candidateManifest = JSON.parse(candidateManifestBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`候选 manifest 无法解析：${error.message}`);
  }
  const candidateVideoIntegrityBefore = await inspectFile(videoPath);
  let candidateManifestBinding = validateConfiguredLongReviewCandidateManifest(
    candidateManifest,
    candidateVideoIntegrityBefore,
    videoPath,
    null,
    !CONFIGURED_RENDER_JOB
  );
  const publicationReceiptPath = CONFIGURED_RENDER_JOB
    ? resolve(candidateDirectory, LONG_REVIEW_PUBLICATION_RECEIPT_FILE_NAME)
    : null;
  let publicationReceiptIntegrityBefore = null;
  let publicationReceipt = null;
  // Compatibility boundary: only the direct historical v004 entry (no job config)
  // may lack a generic durable receipt. Every configured/versioned job fails closed.
  if (CONFIGURED_RENDER_JOB) {
    if (!(await pathExists(publicationReceiptPath))) {
      const error = new Error(
        "generic long-review QA requires publication-durable-receipt.json; durability-unknown or historical candidates fail closed"
      );
      error.code = "long_review_publication_receipt_missing";
      throw error;
    }
    await assertPlainFile(publicationReceiptPath, "durable publication receipt");
    await assertExistingRealPathInside(
      candidateDirectory,
      publicationReceiptPath,
      "durable publication receipt"
    );
    const publicationReceiptBytes = await readFile(publicationReceiptPath);
    publicationReceiptIntegrityBefore = await inspectFile(publicationReceiptPath);
    if (
      publicationReceiptBytes.length !== publicationReceiptIntegrityBefore.bytes ||
      createHash("sha256").update(publicationReceiptBytes).digest("hex") !==
        publicationReceiptIntegrityBefore.sha256
    ) {
      throw new Error("durable publication receipt changed while being read");
    }
    try {
      publicationReceipt = JSON.parse(publicationReceiptBytes.toString("utf8"));
    } catch (error) {
      throw new Error(`durable publication receipt is not valid JSON: ${error.message}`);
    }
  }
  const publicationReceiptBinding = CONFIGURED_RENDER_JOB
    ? validateLongReviewPublicationDurableReceipt({
        receipt: publicationReceipt,
        manifest: candidateManifest,
        manifestIntegrity: candidateManifestIntegrityBefore,
        videoIntegrity: candidateVideoIntegrityBefore,
        job: CONFIGURED_RENDER_JOB
      })
    : null;
  let pathGuards = await captureQaCandidatePathGuards({
    reviewCandidatesRoot: REVIEW_CANDIDATES_ROOT,
    candidateDirectory,
    videoPath,
    manifestPath,
    publicationReceiptPath
  });
  if (
    publicationReceiptPath &&
    JSON.stringify(await inspectFile(publicationReceiptPath)) !==
      JSON.stringify(publicationReceiptIntegrityBefore)
  ) {
    throw new Error(
      "durable publication receipt changed before path binding; refusing QA"
    );
  }
  let temporaryDirectoryGuard = null;
  const assertPathsCurrent = async (_stage, options = {}) => {
    pathGuards = await verifyQaCandidatePathGuards(pathGuards, options);
    if (temporaryDirectoryGuard && !options.skipTemporaryDirectory) {
      temporaryDirectoryGuard = await verifyPathGuard(temporaryDirectoryGuard, {
        allowLeafMetadataChange: true
      });
    }
    return pathGuards;
  };
  const {
    finalQaDirectory,
    temporaryQaDirectory,
    publicationLockDirectory
  } = qaArtifactPaths({
    candidateDirectory,
    qaDirectoryName: arguments_.qaDirectoryName
  });
  if (await pathExists(finalQaDirectory)) {
    throw new Error(`最终 QA 目录已存在；为保留旧产物，拒绝覆盖：${workspaceRelative(finalQaDirectory)}`);
  }

  await assertPathsCurrent("after-initial-candidate-validation");

  const candidateInputIdentityBefore = CONFIGURED_RENDER_JOB
    ? await captureLongReviewCandidateSourceIdentity({
        job: CONFIGURED_RENDER_JOB,
        jobConfigPath: QA_JOB_CONFIG_PATH,
        workspaceRoot: WORKSPACE_ROOT
      })
    : null;
  if (CONFIGURED_RENDER_JOB) {
    candidateManifestBinding = validateConfiguredLongReviewCandidateManifest(
      candidateManifest,
      candidateVideoIntegrityBefore,
      videoPath,
      candidateInputIdentityBefore,
      true
    );
  }

  const expectedSentinel = {
    candidateDirectory: workspaceRelative(candidateDirectory),
    videoPath: workspaceRelative(videoPath)
  };
  const [ffmpeg, ffprobe, pythonRuntime, qaSourceIdentityBefore] = await Promise.all([
    findRemotionTool("ffmpeg"),
    findRemotionTool("ffprobe"),
    resolveLockedPythonRuntime(),
    captureQaSourceIdentity()
  ]);
  const mediaToolEnv = toolEnvironment(ffmpeg, ffprobe);
  const [ffmpegVersion, ffprobeVersion] = await Promise.all([
    toolVersion(ffmpeg, mediaToolEnv),
    toolVersion(ffprobe, mediaToolEnv)
  ]);
  await assertPlainFile(ANALYZER_PATH, "QA 分析脚本");

  await assertPathsCurrent("before-temporary-directory-create");
  await mkdir(temporaryQaDirectory, { recursive: false });
  temporaryDirectoryGuard = await capturePathGuard(
    REVIEW_CANDIDATES_ROOT,
    temporaryQaDirectory,
    "临时 QA 目录",
    "directory"
  );
  const sentinelPath = resolve(
    temporaryQaDirectory,
    CONFIGURED_RENDER_JOB
      ? ".qa-agent-skill-long-review.incomplete.json"
      : ".qa-agent-skill-long-review-wide-v004.incomplete.json"
  );
  const sentinel = {
    schemaVersion: WIDE_V004_QA_CONTRACT.schemaVersion,
    candidateDirectory: expectedSentinel.candidateDirectory,
    videoPath: expectedSentinel.videoPath,
    runId: basename(temporaryQaDirectory),
    pid: process.pid,
    startedAt: new Date().toISOString(),
    status: "running"
  };
  await assertPathsCurrent("before-sentinel-write");
  await writeFile(sentinelPath, `${JSON.stringify(sentinel, null, 2)}\n`, "utf8");

  try {
    await assertPathsCurrent("before-media-probe");
    const mediaMetadata = await probeMedia({
      videoPath,
      manifestPath,
      ffprobe: ffprobe.path,
      env: mediaToolEnv
    });
    if (
      JSON.stringify(mediaMetadata.source.video) !==
        JSON.stringify(candidateVideoIntegrityBefore) ||
      JSON.stringify(mediaMetadata.source.manifest) !==
        JSON.stringify(candidateManifestIntegrityBefore)
    ) {
      throw new Error("候选 MP4 或 manifest 在强绑定后发生变化；拒绝生成混合来源证据");
    }
    await assertPathsCurrent("before-media-metadata-write");
    await writeFile(
      resolve(temporaryQaDirectory, "media-metadata.json"),
      `${JSON.stringify(mediaMetadata, null, 2)}\n`,
      "utf8"
    );
    if (mediaMetadata.status !== "pass") {
      const failedMetadataChecks = Object.entries(mediaMetadata.checks)
        .filter(([, passed]) => !passed)
        .map(([name]) => name);
      throw new Error(`候选媒体规格未通过：${failedMetadataChecks.join(", ")}`);
    }
    const mediaEvidence = await inspectRenderedMedia(videoPath, {
      getExecutablePath: ({ type }) => type === "ffmpeg" ? ffmpeg.path : ffprobe.path
    });
    const mediaTechnicalChecks = renderedMediaTechnicalChecks(mediaEvidence);
    await assertPathsCurrent("before-media-evidence-write");
    await writeFile(
      resolve(temporaryQaDirectory, "media-integrity-evidence.json"),
      `${JSON.stringify({
        schemaVersion: CONFIGURED_RENDER_JOB
          ? "agent-skill-long-review-media-integrity-v1"
          : "agent-skill-long-review-wide-v004-media-integrity-v1",
        machineOnly: true,
        manualPlaybackRequired: true,
        statement: "机器完整解码、音频窗口与代表帧检查不能替代人工连续 1× 观看最终 MP4。",
        passed: mediaTechnicalChecks.every((check) => check.passed),
        checks: mediaTechnicalChecks,
        evidence: mediaEvidence
      }, null, 2)}\n`,
      "utf8"
    );
    const blockingMediaChecks = mediaTechnicalChecks.filter((check) => !check.passed);
    if (blockingMediaChecks.length > 0) {
      throw new Error(
        `完整媒体机器 QA 未通过：${blockingMediaChecks.map((check) => check.id).join(", ")}`
      );
    }

    const framePlan = buildFramePlan();
    await assertPathsCurrent("before-frame-directories-write");
    await mkdir(resolve(temporaryQaDirectory, "frames/full"), { recursive: true });
    await mkdir(resolve(temporaryQaDirectory, "frames/periodic"), { recursive: true });
    const frameIndex = {
      schemaVersion: CONFIGURED_RENDER_JOB
        ? "agent-skill-long-review-frame-index-v1"
        : "agent-skill-long-review-wide-v004-frame-index-v1",
      generatedAt: new Date().toISOString(),
      sourceVideo: workspaceRelative(videoPath),
      candidateVersion: WIDE_V004_QA_CONTRACT.candidateVersion,
      fps: WIDE_V004_QA_CONTRACT.expectedMedia.fps,
      durationInFrames: WIDE_V004_QA_CONTRACT.expectedMedia.durationInFrames,
      scenes: SCENES,
      representativeFrameCount: SCENES.length,
      boundaryTransitionCount: SCENES.length - 1,
      boundaryOffsetsInFrames: WIDE_V004_QA_CONTRACT.boundaryOffsetsInFrames,
      periodicIntervalSeconds: WIDE_V004_QA_CONTRACT.periodicIntervalSeconds,
      fullSamples: framePlan.fullSamples,
      periodicSamples: framePlan.periodicSamples
    };
    await assertPathsCurrent("before-frame-index-write");
    await writeFile(
      resolve(temporaryQaDirectory, "frame-index.json"),
      `${JSON.stringify(frameIndex, null, 2)}\n`,
      "utf8"
    );

    await assertPathsCurrent("before-full-frame-extraction");
    await extractSamples({
      samples: framePlan.fullSamples,
      videoPath,
      qaDirectory: temporaryQaDirectory,
      ffmpeg: ffmpeg.path,
      env: mediaToolEnv,
      periodic: false
    });
    await assertPathsCurrent("after-full-frame-extraction");
    await extractSamples({
      samples: framePlan.periodicSamples,
      videoPath,
      qaDirectory: temporaryQaDirectory,
      ffmpeg: ffmpeg.path,
      env: mediaToolEnv,
      periodic: true
    });

    await assertPathsCurrent("after-periodic-frame-extraction");
    const runManifest = {
      schemaVersion: WIDE_V004_QA_CONTRACT.schemaVersion,
      generatedAt: new Date().toISOString(),
      writeScope: `${workspaceRelative(candidateDirectory)}/${arguments_.qaDirectoryName} only`,
      qaDirectoryName: arguments_.qaDirectoryName,
      sourceVideo: await inspectFile(videoPath),
      sourceManifest: manifestPath ? await inspectFile(manifestPath) : null,
      sourcePublicationReceipt: publicationReceiptPath
        ? await inspectFile(publicationReceiptPath)
        : null,
      candidateManifestBinding,
      publicationReceiptBinding,
      qaSourceIdentity: qaSourceIdentityBefore,
      contract: WIDE_V004_QA_CONTRACT,
      mediaTechnicalChecks,
      tools: {
        ffmpeg: { path: ffmpeg.path, source: ffmpeg.source, version: ffmpegVersion },
        ffprobe: { path: ffprobe.path, source: ffprobe.source, version: ffprobeVersion },
        python: pythonRuntime
      },
      guarantees: {
        sourceVideoRequiredBeforeAnyQaWrite: true,
        existingFinalQaRefusesOverwrite: true,
        uniqueTemporaryDirectoryNeverDeletesAnotherRun: true,
        cooperativePublicationLockPreventsConcurrentOverwrite: true,
        sourceMediaMutated: false,
        sourceCodeMutated: false,
        manualVisualJudgmentsRemainPending: true
      }
    };
    await assertPathsCurrent("before-run-manifest-write");
    await writeFile(
      resolve(temporaryQaDirectory, "run-manifest.json"),
      `${JSON.stringify(runManifest, null, 2)}\n`,
      "utf8"
    );

    await assertPathsCurrent("before-analyzer");
    await runProcess(pythonRuntime.path, ["-I", ANALYZER_PATH, "--qa-dir", temporaryQaDirectory], {
      inherit: true
    });
    await assertPathsCurrent("after-analyzer");
    for (const required of [
      "frame-metrics.json",
      "qa-summary.json",
      "QA-REPORT.md",
      "contact-scenes-overview.png",
      "contact-periodic-overview.png",
      "contact-static-candidates.png",
      "contact-low-information-candidates.png"
    ]) {
      await assertPlainFile(resolve(temporaryQaDirectory, required), `必需 QA 产物 ${required}`);
    }
    await validateLongReviewAnalyzerArtifacts({
      qaDirectory: temporaryQaDirectory,
      contract: WIDE_V004_QA_CONTRACT,
      candidateManifestBinding,
      sourceVideo: mediaMetadata.source.video,
      sourceManifest: mediaMetadata.source.manifest,
      sourcePublicationReceipt: publicationReceiptIntegrityBefore,
      publicationReceiptBinding
    });

    const sourceVideoAfter = await inspectFile(videoPath);
    if (JSON.stringify(mediaMetadata.source.video) !== JSON.stringify(sourceVideoAfter)) {
      throw new Error("源 MP4 在 QA 期间发生变化；拒绝发布可能不一致的 QA 产物");
    }
    const sourceManifestAfter = await inspectFile(manifestPath);
    if (JSON.stringify(mediaMetadata.source.manifest) !== JSON.stringify(sourceManifestAfter)) {
      throw new Error("候选 manifest 在 QA 期间发生变化；拒绝发布可能不一致的 QA 产物");
    }
    if (publicationReceiptPath) {
      const sourcePublicationReceiptAfter = await inspectFile(publicationReceiptPath);
      if (
        JSON.stringify(publicationReceiptIntegrityBefore) !==
        JSON.stringify(sourcePublicationReceiptAfter)
      ) {
        throw new Error(
          "durable publication receipt changed during QA; refusing mixed-source evidence"
        );
      }
    }
    const qaSourceIdentityAfter = await captureQaSourceIdentity();
    if (JSON.stringify(qaSourceIdentityAfter) !== JSON.stringify(qaSourceIdentityBefore)) {
      throw new Error("QA 驱动、分析器、运行时锁或 Git HEAD 在 QA 期间发生变化；拒绝发布");
    }
    if (CONFIGURED_RENDER_JOB) {
      const candidateInputIdentityAfter = await captureLongReviewCandidateSourceIdentity({
        job: CONFIGURED_RENDER_JOB,
        jobConfigPath: QA_JOB_CONFIG_PATH,
        workspaceRoot: WORKSPACE_ROOT
      });
      if (JSON.stringify(candidateInputIdentityAfter) !== JSON.stringify(candidateInputIdentityBefore)) {
        throw new Error("候选源码、Git 工作树或旁白在 QA 期间发生变化；拒绝发布");
      }
    }

    await assertPathsCurrent("before-artifact-index-write");
    const artifactIndex = await writeArtifactIndex(temporaryQaDirectory, sentinelPath);
    await assertPathsCurrent("before-incomplete-sentinel-remove");
    await rm(sentinelPath, { force: false });
    await publishQaArtifactDirectory({
      temporaryQaDirectory,
      finalQaDirectory,
      publicationLockDirectory,
      assertPathsCurrent,
      validationContext: {
        contract: WIDE_V004_QA_CONTRACT,
        candidateManifestBinding,
        sourceVideo: mediaMetadata.source.video,
        sourceManifest: mediaMetadata.source.manifest,
        sourcePublicationReceipt: publicationReceiptIntegrityBefore,
        publicationReceiptBinding
      }
    });
    process.stdout.write(`${JSON.stringify({
      status: "qa_artifacts_ready_for_manual_review",
      candidateDirectory: workspaceRelative(candidateDirectory),
      sourceVideo: workspaceRelative(videoPath),
      qaDirectory: workspaceRelative(finalQaDirectory),
      artifactCount: artifactIndex.artifactCount,
      representativeScenes: SCENES.length,
      sceneTransitions: SCENES.length - 1,
      periodicSamples: framePlan.periodicSamples.length
    }, null, 2)}\n`);
  } catch (error) {
    const failureSentinel = {
      ...sentinel,
      status: "incomplete",
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    };
    try {
      await assertPathsCurrent("before-failure-sentinel-write");
      await writeFile(sentinelPath, `${JSON.stringify(failureSentinel, null, 2)}\n`, "utf8");
    } catch {
      // Preserve the original failure. Never follow a path that failed identity revalidation.
    }
    throw error;
  }
}

export function decodedVideoFrameCount(videoStream) {
  const count = Number(videoStream?.nb_read_frames);
  return Number.isSafeInteger(count) && count >= 0 ? count : Number.NaN;
}

const invokedAsCli = process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH;
if (invokedAsCli) await runAgentSkillLongReviewQa();
