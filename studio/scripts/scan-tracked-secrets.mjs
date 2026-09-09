import { execFile as execFileCallback } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);

export const HIGH_CONFIDENCE_SECRET_PATTERNS = Object.freeze([
  {
    id: "private-key",
    pattern:
      /-----BEGIN ((?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----[\s\S]{64,}?-----END \1-----/gu
  },
  {
    id: "aws-access-key",
    pattern: /(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}/gu
  },
  {
    id: "aws-secret-access-key",
    pattern:
      /(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key)\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/gu
  },
  { id: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{36,255}/gu },
  { id: "github-fine-grained-token", pattern: /github_pat_[A-Za-z0-9_]{50,255}/gu },
  {
    id: "openai-api-key",
    pattern: /sk-(?!ant-)(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{32,255}/gu
  },
  { id: "anthropic-api-key", pattern: /sk-ant-[A-Za-z0-9_-]{32,255}/gu },
  { id: "slack-token", pattern: /xox[baprs]-[A-Za-z0-9-]{20,255}/gu },
  { id: "slack-app-token", pattern: /xapp-[A-Za-z0-9-]{20,255}/gu },
  {
    id: "slack-webhook",
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]{8,}\/[A-Za-z0-9_-]{8,}\/[A-Za-z0-9_-]{20,}/gu
  },
  { id: "google-api-key", pattern: /AIza[0-9A-Za-z_-]{35}/gu },
  { id: "google-oauth-secret", pattern: /GOCSPX-[0-9A-Za-z_-]{28}/gu },
  { id: "stripe-live-secret", pattern: /sk_live_[0-9A-Za-z]{20,255}/gu }
]);

function lineNumberAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) {
      line += 1;
    }
  }
  return line;
}

export function findHighConfidenceSecrets(text) {
  const findings = [];
  for (const { id, pattern } of HIGH_CONFIDENCE_SECRET_PATTERNS) {
    const matcher = new RegExp(pattern.source, pattern.flags);
    for (const match of text.matchAll(matcher)) {
      findings.push({
        id,
        line: lineNumberAt(text, match.index ?? 0)
      });
    }
  }
  return findings.sort((left, right) => left.line - right.line || left.id.localeCompare(right.id));
}

export async function scanTrackedFiles({
  cwd = resolve(fileURLToPath(new URL("..", import.meta.url)), ".."),
  execFileImpl = execFile,
  lstatImpl = lstat,
  readFileImpl = readFile
} = {}) {
  const { stdout } = await execFileImpl("git", ["ls-files", "-z"], {
    cwd,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024
  });
  const trackedFiles = Buffer.from(stdout)
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const findings = [];

  for (const path of trackedFiles) {
    const absolutePath = resolve(cwd, path);
    const metadata = await lstatImpl(absolutePath);
    if (!metadata.isFile()) {
      continue;
    }
    const content = await readFileImpl(absolutePath);
    // High-confidence token formats are ASCII. Scan binary bytes as latin1
    // instead of skipping every file that contains NUL; this catches exposed
    // credentials in tracked media, archives, and Git bundles without trying
    // to decode arbitrary binary data as UTF-8.
    const encoding = content.includes(0) ? "latin1" : "utf8";
    for (const finding of findHighConfidenceSecrets(content.toString(encoding))) {
      findings.push({ path, ...finding });
    }
  }
  return findings;
}

export async function runTrackedSecretScan(options) {
  const findings = await scanTrackedFiles(options);
  if (findings.length === 0) {
    return { ok: true, scanned: "tracked-files", findings: [] };
  }
  return { ok: false, scanned: "tracked-files", findings };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await runTrackedSecretScan();
  if (!result.ok) {
    for (const finding of result.findings) {
      process.stderr.write(`${JSON.stringify(finding.path)}:${finding.line} [${finding.id}]\n`);
    }
    process.stderr.write("Potential credential material detected in tracked files; values redacted.\n");
    process.exitCode = 1;
  } else {
    process.stdout.write("No high-confidence secrets detected in tracked files.\n");
  }
}
