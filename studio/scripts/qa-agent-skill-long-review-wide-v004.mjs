import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STUDIO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const REVIEW_CANDIDATES_ROOT = resolve(
  WORKSPACE_ROOT,
  "outputs/studio/agent-skill-20260806/review-candidates"
);
const DEFAULT_CANDIDATE_DIRECTORY = resolve(
  REVIEW_CANDIDATES_ROOT,
  "full-video-current-visual-upgrade-v004"
);
const ANALYZER_PATH = resolve(
  STUDIO_ROOT,
  "scripts/qa-agent-skill-long-review-wide-v004.py"
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
  schemaVersion: "agent-skill-long-review-wide-v004-qa-pipeline-v1",
  candidateVersion: 4,
  expectedMedia: Object.freeze({
    width: 1920,
    height: 1080,
    fps: 30,
    durationSeconds: 600,
    durationToleranceSeconds: 0.25,
    durationInFrames: 18_000
  }),
  scenes: SCENES,
  representativeFrameFraction: 0.5,
  boundaryOffsetsInFrames: Object.freeze([-8, -1, 0, 1, 8]),
  periodicIntervalSeconds: 2,
  periodicWidth: 480,
  fullFrameExtractionConcurrency: 4,
  periodicExtractionConcurrency: 4,
  finalQaDirectoryName: "qa",
  temporaryQaDirectoryName: "qa.rendering",
  sourceVideoNames: Object.freeze(["review-10m-wide.mp4", "review-10m.mp4"])
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

async function sha256(filePath) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
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
    const child = spawn(executable, args, {
      cwd: WORKSPACE_ROOT,
      env: options.env ?? process.env,
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    if (!options.inherit) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code !== 0) {
        reject(new Error(
          `${basename(executable)} 失败：code=${code} signal=${signal ?? "none"}` +
          (stderr ? `\n${stderr.trim()}` : "")
        ));
        return;
      }
      resolveRun({ stdout, stderr });
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

  const pnpmRoot = resolve(STUDIO_ROOT, "node_modules/.pnpm");
  if (await pathExists(pnpmRoot)) {
    const entries = (await readdir(pnpmRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("@remotion+compositor-"))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const entry of entries) {
      const versionSeparator = entry.lastIndexOf("@");
      if (versionSeparator <= 0) continue;
      const encodedPackageName = entry.slice(0, versionSeparator);
      const packageName = encodedPackageName.replace("@remotion+", "@remotion/");
      const candidate = resolve(pnpmRoot, entry, "node_modules", packageName, toolName);
      if (await pathExists(candidate)) {
        await assertPlainFile(candidate, `Remotion ${toolName}`);
        return { path: candidate, libraryDirectory: dirname(candidate), source: "remotion-compositor" };
      }
    }
  }

  await runProcess(toolName, ["-version"]);
  return { path: toolName, libraryDirectory: null, source: "PATH" };
}

function toolEnvironment(...tools) {
  const libraryDirectory = tools.find((tool) => tool.libraryDirectory)?.libraryDirectory;
  if (!libraryDirectory) return process.env;
  return { ...process.env, DYLD_LIBRARY_PATH: libraryDirectory };
}

async function findPython() {
  if (process.env.QA_PYTHON) {
    const override = resolve(process.env.QA_PYTHON);
    await assertPlainFile(override, "QA_PYTHON");
    await runProcess(override, ["--version"]);
    return override;
  }
  const bundled = resolve(
    homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
  );
  if (await pathExists(bundled)) {
    await assertPlainFile(bundled, "Codex bundled Python");
    await runProcess(bundled, ["--version"]);
    return bundled;
  }
  await runProcess("python3", ["--version"]);
  return "python3";
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

async function cleanRecognizedIncompleteDirectory(temporaryQaDirectory, expected) {
  if (!(await pathExists(temporaryQaDirectory))) return;
  const temporaryStat = await lstat(temporaryQaDirectory);
  if (!temporaryStat.isDirectory() || temporaryStat.isSymbolicLink()) {
    throw new Error(`临时 QA 路径不是安全的普通目录，拒绝清理：${workspaceRelative(temporaryQaDirectory)}`);
  }
  const sentinelPath = resolve(
    temporaryQaDirectory,
    ".qa-agent-skill-long-review-wide-v004.incomplete.json"
  );
  await assertPlainFile(sentinelPath, "不完整 QA 标记");
  let sentinel;
  try {
    sentinel = JSON.parse(await readFile(sentinelPath, "utf8"));
  } catch (error) {
    throw new Error(`不完整 QA 标记无法解析，拒绝清理：${error.message}`);
  }
  if (
    sentinel?.schemaVersion !== WIDE_V004_QA_CONTRACT.schemaVersion ||
    sentinel?.candidateDirectory !== expected.candidateDirectory ||
    sentinel?.videoPath !== expected.videoPath
  ) {
    throw new Error("临时 QA 标记与本次候选不一致，拒绝清理");
  }
  await rm(temporaryQaDirectory, { recursive: true, force: true });
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

async function extractSamples({ samples, videoPath, qaDirectory, ffmpeg, env, periodic }) {
  const concurrency = periodic
    ? WIDE_V004_QA_CONTRACT.periodicExtractionConcurrency
    : WIDE_V004_QA_CONTRACT.fullFrameExtractionConcurrency;
  const finalFrameSecond =
    (WIDE_V004_QA_CONTRACT.expectedMedia.durationInFrames - 1) /
    WIDE_V004_QA_CONTRACT.expectedMedia.fps;
  const seekCeilingSecond = Math.max(0, finalFrameSecond - 0.001);
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < samples.length) {
      const index = cursor;
      cursor += 1;
      const sample = samples[index];
      const outputPath = resolve(qaDirectory, sample.filename);
      // Seek just before the requested presentation timestamp. Seeking after it
      // makes ffmpeg return the following frame while retaining the requested
      // frame number in our filename.
      const targetSecond = Math.max(
        0,
        Math.min(seekCeilingSecond, sample.second - 0.001)
      );
      const args = [
        "-hide_banner",
        "-loglevel", "error",
        "-ss", targetSecond.toFixed(9),
        "-i", videoPath,
        "-map", "0:v:0",
        "-frames:v", "1"
      ];
      if (periodic) {
        args.push("-vf", `scale=${WIDE_V004_QA_CONTRACT.periodicWidth}:-2:flags=lanczos`);
      }
      args.push("-c:v", "png", "-n", outputPath);
      await runProcess(ffmpeg, args, { env });
      await assertPlainFile(outputPath, "提取帧");
      completed += 1;
      if (completed % 25 === 0 || completed === samples.length) {
        process.stdout.write(
          `${periodic ? "周期" : "代表/边界"}帧：${completed}/${samples.length}\n`
        );
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

async function probeMedia({ videoPath, manifestPath, ffprobe, env }) {
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
  const video = raw.streams?.find((stream) => stream.codec_type === "video") ?? null;
  const actualFps = rationalToNumber(video?.avg_frame_rate);
  const actualFrames = [video?.nb_frames, video?.nb_read_frames, video?.nb_read_packets]
    .map(Number)
    .find(Number.isFinite) ?? Number.NaN;
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
    yuv420p: video?.pix_fmt === "yuv420p"
  };
  return {
    schemaVersion: "agent-skill-long-review-wide-v004-media-metadata-v1",
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
    schemaVersion: "agent-skill-long-review-wide-v004-artifact-index-v1",
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

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.help) {
    printHelp();
    return;
  }

  const candidateDirectory = ensureInside(
    REVIEW_CANDIDATES_ROOT,
    arguments_.candidateDirectory,
    "候选目录"
  );
  if (!/(?:^|[-_])v004(?:$|[-_.])/u.test(basename(candidateDirectory))) {
    throw new Error(`本脚本只允许写入 v004 候选目录：${workspaceRelative(candidateDirectory)}`);
  }
  if (!(await pathExists(candidateDirectory))) {
    throw new Error(
      `源 MP4 不存在：候选目录尚未生成 ${workspaceRelative(candidateDirectory)}`
    );
  }
  await assertPlainDirectory(candidateDirectory, "候选目录");

  const videoPath = await resolveVideoPath(candidateDirectory, arguments_.videoPath);
  await assertPlainFile(videoPath, "源 MP4");
  if (videoPath.slice(-4).toLowerCase() !== ".mp4") {
    throw new Error(`源视频必须是 MP4：${workspaceRelative(videoPath)}`);
  }
  const manifestCandidate = resolve(candidateDirectory, "review-manifest.json");
  const manifestPath = await pathExists(manifestCandidate) ? manifestCandidate : null;
  if (manifestPath) await assertPlainFile(manifestPath, "候选 manifest");

  const finalQaDirectory = ensureInside(
    candidateDirectory,
    resolve(candidateDirectory, arguments_.qaDirectoryName),
    "最终 QA 目录"
  );
  const temporaryQaDirectory = ensureInside(
    candidateDirectory,
    resolve(candidateDirectory, `${arguments_.qaDirectoryName}.rendering`),
    "临时 QA 目录"
  );
  if (await pathExists(finalQaDirectory)) {
    throw new Error(`最终 QA 目录已存在；为保留旧产物，拒绝覆盖：${workspaceRelative(finalQaDirectory)}`);
  }

  const expectedSentinel = {
    candidateDirectory: workspaceRelative(candidateDirectory),
    videoPath: workspaceRelative(videoPath)
  };
  await cleanRecognizedIncompleteDirectory(temporaryQaDirectory, expectedSentinel);

  const [ffmpeg, ffprobe, python] = await Promise.all([
    findRemotionTool("ffmpeg"),
    findRemotionTool("ffprobe"),
    findPython()
  ]);
  const mediaToolEnv = toolEnvironment(ffmpeg, ffprobe);
  await assertPlainFile(ANALYZER_PATH, "QA 分析脚本");

  await mkdir(temporaryQaDirectory, { recursive: false });
  const sentinelPath = resolve(
    temporaryQaDirectory,
    ".qa-agent-skill-long-review-wide-v004.incomplete.json"
  );
  const sentinel = {
    schemaVersion: WIDE_V004_QA_CONTRACT.schemaVersion,
    candidateDirectory: expectedSentinel.candidateDirectory,
    videoPath: expectedSentinel.videoPath,
    startedAt: new Date().toISOString(),
    status: "running"
  };
  await writeFile(sentinelPath, `${JSON.stringify(sentinel, null, 2)}\n`, "utf8");

  try {
    const mediaMetadata = await probeMedia({
      videoPath,
      manifestPath,
      ffprobe: ffprobe.path,
      env: mediaToolEnv
    });
    await writeFile(
      resolve(temporaryQaDirectory, "media-metadata.json"),
      `${JSON.stringify(mediaMetadata, null, 2)}\n`,
      "utf8"
    );

    const framePlan = buildFramePlan();
    await mkdir(resolve(temporaryQaDirectory, "frames/full"), { recursive: true });
    await mkdir(resolve(temporaryQaDirectory, "frames/periodic"), { recursive: true });
    const frameIndex = {
      schemaVersion: "agent-skill-long-review-wide-v004-frame-index-v1",
      generatedAt: new Date().toISOString(),
      sourceVideo: workspaceRelative(videoPath),
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
    await writeFile(
      resolve(temporaryQaDirectory, "frame-index.json"),
      `${JSON.stringify(frameIndex, null, 2)}\n`,
      "utf8"
    );

    await extractSamples({
      samples: framePlan.fullSamples,
      videoPath,
      qaDirectory: temporaryQaDirectory,
      ffmpeg: ffmpeg.path,
      env: mediaToolEnv,
      periodic: false
    });
    await extractSamples({
      samples: framePlan.periodicSamples,
      videoPath,
      qaDirectory: temporaryQaDirectory,
      ffmpeg: ffmpeg.path,
      env: mediaToolEnv,
      periodic: true
    });

    const runManifest = {
      schemaVersion: WIDE_V004_QA_CONTRACT.schemaVersion,
      generatedAt: new Date().toISOString(),
      writeScope: `${workspaceRelative(candidateDirectory)}/${arguments_.qaDirectoryName} only`,
      qaDirectoryName: arguments_.qaDirectoryName,
      sourceVideo: await inspectFile(videoPath),
      sourceManifest: manifestPath ? await inspectFile(manifestPath) : null,
      contract: WIDE_V004_QA_CONTRACT,
      tools: {
        ffmpeg: { path: ffmpeg.path, source: ffmpeg.source },
        ffprobe: { path: ffprobe.path, source: ffprobe.source },
        python
      },
      guarantees: {
        sourceVideoRequiredBeforeAnyQaWrite: true,
        existingFinalQaRefusesOverwrite: true,
        recognizedIncompleteTemporaryQaMayBeCleaned: true,
        sourceMediaMutated: false,
        sourceCodeMutated: false,
        manualVisualJudgmentsRemainPending: true
      }
    };
    await writeFile(
      resolve(temporaryQaDirectory, "run-manifest.json"),
      `${JSON.stringify(runManifest, null, 2)}\n`,
      "utf8"
    );

    await runProcess(python, [ANALYZER_PATH, "--qa-dir", temporaryQaDirectory], { inherit: true });
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

    const sourceVideoAfter = await inspectFile(videoPath);
    if (JSON.stringify(mediaMetadata.source.video) !== JSON.stringify(sourceVideoAfter)) {
      throw new Error("源 MP4 在 QA 期间发生变化；拒绝发布可能不一致的 QA 产物");
    }
    if (manifestPath) {
      const sourceManifestAfter = await inspectFile(manifestPath);
      if (JSON.stringify(mediaMetadata.source.manifest) !== JSON.stringify(sourceManifestAfter)) {
        throw new Error("候选 manifest 在 QA 期间发生变化；拒绝发布可能不一致的 QA 产物");
      }
    }

    const artifactIndex = await writeArtifactIndex(temporaryQaDirectory, sentinelPath);
    await rm(sentinelPath, { force: false });
    await rename(temporaryQaDirectory, finalQaDirectory);
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
      await writeFile(sentinelPath, `${JSON.stringify(failureSentinel, null, 2)}\n`, "utf8");
    } catch {
      // Preserve the original failure; an unmarked temporary directory is never auto-deleted.
    }
    throw error;
  }
}

await main();
