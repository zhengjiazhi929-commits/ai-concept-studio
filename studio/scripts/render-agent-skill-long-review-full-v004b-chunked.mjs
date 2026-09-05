import {lstat, readFile} from "node:fs/promises";
import {dirname, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {
  assertLongReviewRenderJobFilesystemSafety,
  validateLongReviewRenderJob,
} from "../src/server/production/long-render-job.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STUDIO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const RENDER_JOB_ENVIRONMENT_KEY = "AI_CONCEPT_STUDIO_LONG_REVIEW_RENDER_JOB";

export const FULL_V004B_RENDER_BASE_CONTRACT = Object.freeze({
  schemaVersion: "agent-skill-full-v004b-render-base-v1",
  jobConfigPath:
    "studio/config/render-jobs/full-video-current-visual-upgrade-render-base-v014.json",
  jobId: "agent-skill-20260806-current-visual-upgrade-render-base-v014",
  episodeId: "agent-skill-20260806",
  candidateVersion: 14,
  compositionId: "AgentSkillLongReview",
  entryPointPath: "studio/src/video/agent-skill-long-review-index.jsx",
  episodePath: "studio/data/render-inputs/full-v004b-attempt-001/episode.json",
  voicePath:
    "studio/public/episodes/agent-skill-20260806/voice-natural-technical-v004-full.wav",
  finalDirectoryPath:
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-render-base-v014",
  workDirectoryPath:
    "outputs/studio/agent-skill-20260806/review-candidates/.full-video-current-visual-upgrade-render-base-v014-work",
  artifactRole: "render-base",
  formalCandidate: false,
  visualSource: "v013@980c4f4be9c1f0bccdcd546873fa1a877c98aac8",
  voice: "v004-full",
  subtitleStyle: "v004b-no-box",
  subtitleDelivery: "external-overlay-required",
  burnInSubtitle: false,
  chunkFrames: 900,
  totalChunks: 20,
  interChunkPauseMs: 5_000,
  concurrency: 1,
  externalSchedulingPrefix: Object.freeze([
    "/usr/sbin/taskpolicy",
    "-b",
    "/usr/bin/nice",
    "-n",
    "20",
  ]),
});

const JOB_CONFIG_PATH = resolve(
  WORKSPACE_ROOT,
  FULL_V004B_RENDER_BASE_CONTRACT.jobConfigPath,
);

function integerOption(name, rawValue) {
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
  return value;
}

export function parseFullV004bRenderBaseCliArguments(argv) {
  const options = {
    help: false,
    chunkFrames: FULL_V004B_RENDER_BASE_CONTRACT.chunkFrames,
    interChunkPauseMs: FULL_V004B_RENDER_BASE_CONTRACT.interChunkPauseMs,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const takeValue = (name) => {
      if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
      index += 1;
      if (index >= argv.length) throw new Error(`${name} requires a value`);
      return argv[index];
    };
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (
      argument === "--chunk-frames" ||
      argument.startsWith("--chunk-frames=")
    ) {
      options.chunkFrames = integerOption(
        "--chunk-frames",
        takeValue("--chunk-frames"),
      );
    } else if (
      argument === "--inter-chunk-pause-ms" ||
      argument.startsWith("--inter-chunk-pause-ms=")
    ) {
      options.interChunkPauseMs = integerOption(
        "--inter-chunk-pause-ms",
        takeValue("--inter-chunk-pause-ms"),
      );
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (options.chunkFrames !== FULL_V004B_RENDER_BASE_CONTRACT.chunkFrames) {
    throw new Error("full v004b render-base requires --chunk-frames 900 exactly");
  }
  if (
    options.interChunkPauseMs !==
    FULL_V004B_RENDER_BASE_CONTRACT.interChunkPauseMs
  ) {
    throw new Error(
      "full v004b render-base requires --inter-chunk-pause-ms 5000 exactly",
    );
  }
  return Object.freeze(options);
}

export function fullV004bRenderBaseUsageText() {
  const command = [
    ...FULL_V004B_RENDER_BASE_CONTRACT.externalSchedulingPrefix,
    process.execPath,
    relative(WORKSPACE_ROOT, SCRIPT_PATH),
    "--chunk-frames",
    String(FULL_V004B_RENDER_BASE_CONTRACT.chunkFrames),
    "--inter-chunk-pause-ms",
    String(FULL_V004B_RENDER_BASE_CONTRACT.interChunkPauseMs),
  ].join(" ");
  return [
    "Non-overwriting, resumable render-base for the approved full v004b subtitle workflow.",
    "",
    "This stage renders v013 visuals with burnInSubtitle=false and temporary v004-full voice.",
    "It is not the formal subtitle candidate; an independently bound v004b no-box overlay follows.",
    "",
    "Required low-priority launch:",
    `  ${command}`,
    "",
    "The schedule is fixed at 20x900 frames, concurrency=1, with 5000ms pauses.",
    "This script never invokes taskpolicy or nice itself.",
  ].join("\n");
}

export function assertFullV004bRenderBaseJob(job) {
  const expected = FULL_V004B_RENDER_BASE_CONTRACT;
  const profile = job?.renderProfile;
  const checks = {
    jobId: job?.jobId === expected.jobId,
    episodeId: job?.episodeId === expected.episodeId,
    candidateVersion: job?.candidateVersion === expected.candidateVersion,
    compositionId: job?.compositionId === expected.compositionId,
    runner: job?.resolvedPaths?.runner === SCRIPT_PATH,
    entryPoint:
      job?.resolvedPaths?.entryPoint ===
      resolve(WORKSPACE_ROOT, expected.entryPointPath),
    episode:
      job?.resolvedPaths?.episode === resolve(WORKSPACE_ROOT, expected.episodePath),
    voice:
      job?.resolvedPaths?.voice === resolve(WORKSPACE_ROOT, expected.voicePath),
    finalDirectory:
      job?.resolvedPaths?.finalDirectory ===
      resolve(WORKSPACE_ROOT, expected.finalDirectoryPath),
    workDirectory:
      job?.resolvedPaths?.workDirectory ===
      resolve(WORKSPACE_ROOT, expected.workDirectoryPath),
    artifactRole: profile?.artifactRole === expected.artifactRole,
    formalCandidate: profile?.formalCandidate === expected.formalCandidate,
    visualSource: profile?.visualSource === expected.visualSource,
    voiceProfile: profile?.voice === expected.voice,
    subtitleStyle: profile?.subtitleStyle === expected.subtitleStyle,
    subtitleDelivery: profile?.subtitleDelivery === expected.subtitleDelivery,
    burnInSubtitle: profile?.burnInSubtitle === expected.burnInSubtitle,
    chunkFrames: profile?.chunkFrames === expected.chunkFrames,
    interChunkPauseMs:
      profile?.interChunkPauseMs === expected.interChunkPauseMs,
    concurrency: profile?.concurrency === expected.concurrency,
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`full v004b render-base job mismatch: ${failed.join(", ")}`);
  }
  return true;
}

async function assertReadOnlyRenderInput(filePath, label) {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular, non-symlink file`);
  }
  if ((stat.mode & 0o222) !== 0) {
    throw new Error(`${label} must be read-only before the full render starts`);
  }
}

async function main() {
  const options = parseFullV004bRenderBaseCliArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${fullV004bRenderBaseUsageText()}\n`);
    return;
  }
  const jobConfigStat = await lstat(JOB_CONFIG_PATH);
  if (!jobConfigStat.isFile() || jobConfigStat.isSymbolicLink()) {
    throw new Error("v004b render job must be a regular, non-symlink file");
  }
  const job = validateLongReviewRenderJob(
    JSON.parse(await readFile(JOB_CONFIG_PATH, "utf8")),
    {workspaceRoot: WORKSPACE_ROOT},
  );
  assertFullV004bRenderBaseJob(job);
  await assertLongReviewRenderJobFilesystemSafety(job, {
    workspaceRoot: WORKSPACE_ROOT,
    jobConfigPath: JOB_CONFIG_PATH,
  });
  await Promise.all([
    assertReadOnlyRenderInput(job.resolvedPaths.episode, "frozen episode"),
    assertReadOnlyRenderInput(job.resolvedPaths.voice, "frozen temporary voice"),
  ]);

  process.env[RENDER_JOB_ENVIRONMENT_KEY] = JOB_CONFIG_PATH;
  const core = await import(
    "./render-agent-skill-long-review-wide-v004-chunked.mjs"
  );
  const loadedContract = core.CHUNKED_V004_CONTRACT;
  const coreChecks = {
    artifactRole:
      loadedContract.artifactRole === FULL_V004B_RENDER_BASE_CONTRACT.artifactRole,
    formalCandidate:
      loadedContract.formalCandidate ===
      FULL_V004B_RENDER_BASE_CONTRACT.formalCandidate,
    visualSource:
      loadedContract.visualSource === FULL_V004B_RENDER_BASE_CONTRACT.visualSource,
    voice: loadedContract.voice === FULL_V004B_RENDER_BASE_CONTRACT.voice,
    subtitleStyle:
      loadedContract.subtitleStyle === FULL_V004B_RENDER_BASE_CONTRACT.subtitleStyle,
    subtitleDelivery:
      loadedContract.subtitleDelivery ===
      FULL_V004B_RENDER_BASE_CONTRACT.subtitleDelivery,
    burnInSubtitle:
      loadedContract.burnInSubtitle ===
      FULL_V004B_RENDER_BASE_CONTRACT.burnInSubtitle,
    chunkFrames:
      loadedContract.defaultChunkFrames ===
      FULL_V004B_RENDER_BASE_CONTRACT.chunkFrames,
    interChunkPauseMs:
      loadedContract.defaultInterChunkPauseMs ===
      FULL_V004B_RENDER_BASE_CONTRACT.interChunkPauseMs,
    concurrency:
      loadedContract.concurrency === FULL_V004B_RENDER_BASE_CONTRACT.concurrency,
  };
  const coreMismatches = Object.entries(coreChecks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (coreMismatches.length > 0) {
    throw new Error(
      `chunked core did not load the immutable render-base profile: ${coreMismatches.join(", ")}`,
    );
  }
  await core.renderAgentSkillLongReviewWideV004Chunked({
    chunkFrames: options.chunkFrames,
    interChunkPauseMs: options.interChunkPauseMs,
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
