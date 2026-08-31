import { lstat, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertLongReviewRenderJobFilesystemSafety,
  validateLongReviewRenderJob
} from "../src/server/production/long-render-job.mjs";
import {
  parseLongReviewQaCliArguments,
  resolveLongReviewQaJobConfigPath
} from "../src/server/production/long-review-qa.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STUDIO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const QA_JOB_ENVIRONMENT_KEY = "AI_CONCEPT_STUDIO_LONG_REVIEW_QA_JOB";

function usageText() {
  return [
    "Formal machine and frame QA for a versioned 10-minute review candidate.",
    "",
    `Usage: node ${relative(WORKSPACE_ROOT, SCRIPT_PATH)} --job-config <path> [options]`,
    "",
    "Required:",
    "  --job-config <path>       The exact render-job JSON used by the candidate.",
    "",
    "Options:",
    "  --qa-dir-name <name>      Immutable output directory: qa or qa-vNNN (default: qa).",
    "  --help                    Show this help.",
    "",
    "The job fixes the candidate version, directory, MP4 and manifest. Machine QA and",
    "contact sheets remain evidence for manual review, not human visual acceptance."
  ].join("\n");
}

export async function runVersionedLongReviewQa(
  argv = process.argv.slice(2)
) {
  if (arguments.length > 1) {
    throw new TypeError("production long-review QA does not accept dependency injection");
  }
  const options = parseLongReviewQaCliArguments(argv);
  if (options.help) {
    process.stdout.write(`${usageText()}\n`);
    return;
  }
  const jobConfigPath = resolveLongReviewQaJobConfigPath(
    WORKSPACE_ROOT,
    options.jobConfigPath
  );
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
  process.env[QA_JOB_ENVIRONMENT_KEY] = jobConfigPath;
  const qa = await import("./qa-agent-skill-long-review-wide-v004.mjs");
  await qa.runAgentSkillLongReviewQa([
    `--qa-dir-name=${options.qaDirectoryName}`
  ]);
}

const invokedAsCli = process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH;
if (invokedAsCli) {
  runVersionedLongReviewQa().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
