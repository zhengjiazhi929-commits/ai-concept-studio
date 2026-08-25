import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { studioRoot } from "../src/shared/paths.mjs";

const TRANSFORM_LOADERS = Object.freeze({
  ".jsx": "jsx",
  ".ts": "ts",
  ".tsx": "tsx"
});

export const DEFAULT_SYNTAX_ROOTS = Object.freeze([
  resolve(studioRoot, "scripts"),
  resolve(studioRoot, "src", "server"),
  resolve(studioRoot, "src", "shared"),
  resolve(studioRoot, "src", "video"),
  resolve(studioRoot, "src", "web")
]);

async function collectSyntaxFiles(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectSyntaxFiles(path, files);
      continue;
    }
    if (entry.isFile() && /\.(?:mjs|js|jsx|ts|tsx)$/u.test(entry.name)) files.push(path);
  }
}

export async function discoverSyntaxFiles(roots = DEFAULT_SYNTAX_ROOTS) {
  const files = [];
  for (const root of roots) await collectSyntaxFiles(root, files);
  return files.sort((left, right) => left.localeCompare(right));
}

function checkOneFile(path, spawnProcess = spawnSync) {
  const result = spawnProcess(process.execPath, ["--check", path], {
    shell: false,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`Syntax check failed for ${path}\n${output}`);
  }
}

async function transformOneFile(path, transformImpl = transform, readFileImpl = readFile) {
  const extension = /\.(?:jsx|tsx|ts)$/u.exec(path)?.[0] ?? null;
  const loader = TRANSFORM_LOADERS[extension];
  if (!loader) return checkOneFile(path);
  try {
    await transformImpl(await readFileImpl(path, "utf8"), {
      loader,
      sourcefile: path,
      format: "esm",
      jsx: "automatic",
      target: "es2024",
      logLevel: "silent"
    });
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error);
    throw new Error(`Syntax check failed for ${path}\n${output}`);
  }
}

export async function checkSyntaxFiles(files, options = {}) {
  for (const path of files) {
    if (/\.(?:jsx|tsx|ts)$/u.test(path)) {
      await transformOneFile(path, options.transform ?? transform, options.readFile ?? readFile);
    } else {
      checkOneFile(path, options.spawn ?? spawnSync);
    }
  }
  return { checked: files.length };
}

export async function runSyntaxCheck(options = {}) {
  const files = await discoverSyntaxFiles(options.roots ?? DEFAULT_SYNTAX_ROOTS);
  if (files.length === 0) throw new Error("No JavaScript or TypeScript syntax targets found");
  return checkSyntaxFiles(files, options);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isDirectRun) {
  const result = await runSyntaxCheck();
  console.log(`JS/JSX/TS/TSX syntax OK: ${result.checked} files`);
}
