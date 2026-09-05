import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertLongReviewRenderJobFilesystemSafety,
  parseLongReviewRenderCliArguments,
  validateLongReviewRenderJob
} from "../src/server/production/long-render-job.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STUDIO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const RENDER_JOB_ENVIRONMENT_KEY = "AI_CONCEPT_STUDIO_LONG_REVIEW_RENDER_JOB";

function usageText() {
  return [
    "Versioned, resumable renderer for a 10-minute Agent Skill review candidate.",
    "",
    `Usage: node ${relative(WORKSPACE_ROOT, SCRIPT_PATH)} --job-config <path> [options]`,
    "",
    "Required:",
    "  --job-config <path>             Versioned render-job JSON inside the workspace.",
    "",
    "Options:",
    "  --chunk-frames <frames>          Exact frames per process (default: 900).",
    "  --inter-chunk-pause-ms <ms>      Scheduling pause only (default: 5000).",
    "  --help                            Show this help.",
    "",
    "Launch externally at low priority:",
    `  taskpolicy -b nice -n 20 node ${relative(WORKSPACE_ROOT, SCRIPT_PATH)} --job-config <path>`,
    "The renderer keeps concurrency=1 and never invokes taskpolicy or nice itself."
  ].join("\n");
}

function resolveJobConfigPath(value) {
  if (typeof value !== "string" || !value.trim() || isAbsolute(value)) {
    throw new TypeError("--job-config must be a relative workspace path");
  }
  const candidate = resolve(WORKSPACE_ROOT, value);
  if (
    candidate !== WORKSPACE_ROOT &&
    !candidate.startsWith(`${WORKSPACE_ROOT}${sep}`)
  ) {
    throw new Error("--job-config escapes the workspace");
  }
  return candidate;
}

async function main() {
  const options = parseLongReviewRenderCliArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usageText()}\n`);
    return;
  }
  const jobConfigPath = resolveJobConfigPath(options.jobConfigPath);
  const stat = await lstat(jobConfigPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("--job-config must reference a regular, non-symlink file");
  }
  const job = validateLongReviewRenderJob(
    JSON.parse(await readFile(jobConfigPath, "utf8")),
    { workspaceRoot: WORKSPACE_ROOT }
  );
  await assertLongReviewRenderJobFilesystemSafety(job, {
    workspaceRoot: WORKSPACE_ROOT,
    jobConfigPath
  });
  process.env[RENDER_JOB_ENVIRONMENT_KEY] = jobConfigPath;
  const legacyCore = await import("./render-agent-skill-long-review-wide-v004-chunked.mjs");
  await legacyCore.renderAgentSkillLongReviewWideV004Chunked({
    chunkFrames: options.chunkFrames,
    interChunkPauseMs: options.interChunkPauseMs
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
