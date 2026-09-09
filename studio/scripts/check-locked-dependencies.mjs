import { createHash, randomUUID } from "node:crypto";
import { access, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEPENDENCY_MARKER_SCHEMA_VERSION =
  "ai-concept-studio-dependencies-v1";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultStudioRoot = resolve(scriptDirectory, "..");

function stableEntries(value) {
  return Object.fromEntries(
    Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right))
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function dependencyFingerprint({
  lockfile,
  nodeVersion,
  packageDocument,
  workspace
}) {
  const dependencyContract = {
    schemaVersion: DEPENDENCY_MARKER_SCHEMA_VERSION,
    nodeVersion,
    packageManager: packageDocument.packageManager,
    engines: stableEntries(packageDocument.engines),
    dependencies: stableEntries(packageDocument.dependencies),
    devDependencies: stableEntries(packageDocument.devDependencies),
    optionalDependencies: stableEntries(packageDocument.optionalDependencies),
    peerDependencies: stableEntries(packageDocument.peerDependencies)
  };
  return sha256(Buffer.concat([
    Buffer.from(`${JSON.stringify(dependencyContract)}\n`, "utf8"),
    Buffer.from(lockfile),
    Buffer.from("\n--pnpm-workspace--\n", "utf8"),
    Buffer.from(workspace)
  ]));
}

export function evaluateDependencyState({
  expectedFingerprint,
  installedLockSha256,
  marker,
  modulesManifestPresent,
  rootLockSha256,
  unresolvedPackages
}) {
  const reasons = [];
  if (!marker || typeof marker !== "object") {
    reasons.push("dependency-marker-missing");
  } else if (
    marker.schemaVersion !== DEPENDENCY_MARKER_SCHEMA_VERSION ||
    marker.fingerprint !== expectedFingerprint
  ) {
    reasons.push("dependency-marker-stale");
  }
  if (
    typeof installedLockSha256 !== "string" ||
    installedLockSha256 !== rootLockSha256
  ) {
    reasons.push("installed-lockfile-mismatch");
  }
  if (modulesManifestPresent !== true) {
    reasons.push("pnpm-modules-manifest-missing");
  }
  for (const packageName of [...(unresolvedPackages ?? [])].sort()) {
    reasons.push(`direct-dependency-unresolved:${packageName}`);
  }
  return { ready: reasons.length === 0, reasons };
}

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function readBytesOrNull(path) {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function directPackageNames(packageDocument) {
  return Object.keys({
    ...(packageDocument.dependencies ?? {}),
    ...(packageDocument.devDependencies ?? {})
  }).sort();
}

function unresolvedDirectPackages(studioDirectory, packageDocument) {
  const requireFromStudio = createRequire(resolve(studioDirectory, "package.json"));
  return directPackageNames(packageDocument).filter((packageName) => {
    try {
      requireFromStudio.resolve(packageName);
      return false;
    } catch {
      return true;
    }
  });
}

export async function inspectLockedDependencies(options = {}) {
  const studioDirectory = options.studioDirectory ?? defaultStudioRoot;
  const markerPath = resolve(
    studioDirectory,
    "node_modules",
    ".ai-concept-studio-dependencies.json"
  );
  const rootLockPath = resolve(studioDirectory, "pnpm-lock.yaml");
  const installedLockPath = resolve(studioDirectory, "node_modules", ".pnpm", "lock.yaml");
  const [
    packageDocument,
    lockfile,
    workspace,
    nodeVersion,
    marker,
    installedLock,
    modulesManifestPresent
  ] = await Promise.all([
    readJsonOrNull(resolve(studioDirectory, "package.json")),
    readFile(rootLockPath),
    readFile(resolve(studioDirectory, "pnpm-workspace.yaml")),
    readFile(resolve(studioDirectory, "..", ".node-version"), "utf8"),
    readJsonOrNull(markerPath),
    readBytesOrNull(installedLockPath),
    pathExists(resolve(studioDirectory, "node_modules", ".modules.yaml"))
  ]);
  if (!packageDocument) throw new Error("package.json 无法解析");
  const expectedFingerprint = dependencyFingerprint({
    packageDocument,
    lockfile,
    workspace,
    nodeVersion: nodeVersion.trim()
  });
  const unresolvedPackages = unresolvedDirectPackages(studioDirectory, packageDocument);
  const state = evaluateDependencyState({
    expectedFingerprint,
    marker,
    rootLockSha256: sha256(lockfile),
    installedLockSha256: installedLock ? sha256(installedLock) : null,
    modulesManifestPresent,
    unresolvedPackages
  });
  return {
    ...state,
    expectedFingerprint,
    markerPath,
    packageCount: directPackageNames(packageDocument).length
  };
}

async function recordDependencyMarker(state) {
  const verificationState = {
    ...state,
    ready: state.reasons.every((reason) => [
      "dependency-marker-missing",
      "dependency-marker-stale"
    ].includes(reason)),
    reasons: state.reasons.filter((reason) => ![
      "dependency-marker-missing",
      "dependency-marker-stale"
    ].includes(reason))
  };
  if (!verificationState.ready || verificationState.reasons.length > 0) {
    throw new Error(
      `pnpm install 后依赖仍不完整：${verificationState.reasons.join(", ")}`
    );
  }
  const temporaryPath = `${state.markerPath}.${process.pid}.${randomUUID()}.tmp`;
  const marker = {
    schemaVersion: DEPENDENCY_MARKER_SCHEMA_VERSION,
    fingerprint: state.expectedFingerprint
  };
  await writeFile(temporaryPath, `${JSON.stringify(marker)}\n`, "utf8");
  await rename(temporaryPath, state.markerPath);
  return marker;
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isDirectRun) {
  const state = await inspectLockedDependencies();
  if (process.argv.includes("--record")) {
    const marker = await recordDependencyMarker(state);
    process.stdout.write(`${JSON.stringify({ ready: true, marker })}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(state)}\n`);
    if (!state.ready) process.exitCode = 1;
  }
}
