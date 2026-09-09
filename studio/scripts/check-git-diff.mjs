import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const GIT_SHA_PATTERN = /^[a-f0-9]{40,64}$/u;

export const CI_DIFF_ZERO_SHA = "0".repeat(40);

function validatedSha(value, label) {
  if (typeof value !== "string" || !GIT_SHA_PATTERN.test(value)) {
    throw new Error(`${label} 不是完整 Git SHA`);
  }
  return value;
}

function isZeroSha(value) {
  return typeof value === "string" && /^0+$/u.test(value);
}

export function resolveCiDiffRange(environment = {}) {
  const eventName = environment.GITHUB_EVENT_NAME;
  if (!["pull_request", "push"].includes(eventName)) return null;
  const head = validatedSha(environment.ACS_DIFF_HEAD_SHA, "ACS_DIFF_HEAD_SHA");
  const baseValue = environment.ACS_DIFF_BASE_SHA;
  if (eventName === "push" && isZeroSha(baseValue)) {
    const fallbackRef = environment.ACS_DIFF_FALLBACK_BASE_REF;
    if (typeof fallbackRef !== "string" || fallbackRef.trim().length === 0) {
      throw new Error("新分支 push 缺少 ACS_DIFF_FALLBACK_BASE_REF");
    }
    return {
      base: fallbackRef.trim(),
      head,
      notation: "...",
      source: "fallback-ref"
    };
  }
  return {
    base: validatedSha(baseValue, "ACS_DIFF_BASE_SHA"),
    head,
    notation: eventName === "pull_request" ? "..." : "..",
    source: "event"
  };
}

async function defaultRunGit(arguments_) {
  return execFileAsync("git", arguments_, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
}

async function requireCommit(runGit, revision, label) {
  try {
    await runGit(["cat-file", "-e", `${revision}^{commit}`]);
  } catch (error) {
    throw new Error(`${label} 未在本地完整检出中：${revision}`, { cause: error });
  }
}

async function checkUntrackedFiles(runGit) {
  const listed = await runGit(["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = listed.stdout.split("\0").filter(Boolean);
  if (paths.length === 0) return 0;
  const temporaryRoot = await mkdtemp(join(tmpdir(), "acs-diff-empty-"));
  const emptyFile = join(temporaryRoot, "empty");
  try {
    await writeFile(emptyFile, "", "utf8");
    for (const path of paths) {
      try {
        await runGit(["diff", "--no-index", "--check", "--", emptyFile, path]);
      } catch (error) {
        const diagnostic = `${error?.stdout ?? ""}${error?.stderr ?? ""}`.trim();
        if (error?.code === 1 && diagnostic.length === 0) continue;
        throw new Error(`未跟踪文件未通过 diff --check：${path}`, { cause: error });
      }
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return paths.length;
}

export async function runGitDiffCheck(options = {}) {
  const environment = options.environment ?? process.env;
  const runGit = options.runGit ?? defaultRunGit;
  const checks = [];

  await runGit(["diff", "--check"]);
  checks.push("working-tree");
  await runGit(["diff", "--cached", "--check"]);
  checks.push("index");
  const untrackedFileCount = await checkUntrackedFiles(runGit);
  checks.push("untracked-files");

  const requestedRange = resolveCiDiffRange(environment);
  if (!requestedRange) return { checks, commitRange: null, untrackedFileCount };

  let base = requestedRange.base;
  if (requestedRange.source === "fallback-ref") {
    let resolved;
    try {
      resolved = await runGit(["rev-parse", "--verify", `${base}^{commit}`]);
    } catch (error) {
      throw new Error(`CI 缺少新分支基线：${base}`, { cause: error });
    }
    base = validatedSha(resolved.stdout.trim(), `解析后的 ${requestedRange.base}`);
  }
  await requireCommit(runGit, base, "CI diff base");
  await requireCommit(runGit, requestedRange.head, "CI diff head");
  const commitRange = `${base}${requestedRange.notation}${requestedRange.head}`;
  await runGit(["diff", "--check", commitRange]);
  checks.push("commit-range");
  return { checks, commitRange, untrackedFileCount };
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isDirectRun) {
  const result = await runGitDiffCheck();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
