// Read-only installed-package identity. Lock declarations alone do not bind bytes.
import {createHash} from "node:crypto";
import {readFile, readdir, realpath, lstat} from "node:fs/promises";
import {dirname, join, relative, resolve, sep} from "node:path";

const VERSION = "installed-dependency-identity-v1";
// Normal Remotion webpack packs can exceed 128 MiB. Keep a bounded budget,
// including caches in the identity instead of treating their paths as trusted.
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const sha = value => createHash("sha256").update(value).digest("hex");
const digest = value => sha(JSON.stringify(value));
const inside = (root, value) => value === root || value.startsWith(`${root}${sep}`);
const safe = value => typeof value === "string" && value.length > 0 && !value.startsWith("/")
  && !value.includes("\\") && !value.split("/").some(x => !x || x === "." || x === "..");
const hex = value => /^[a-f0-9]{64}$/u.test(value ?? "");
function fail() {
  throw Object.assign(new Error("Installed dependency identity changed or cannot be verified"), {
    code: "installed_dependency_integrity_invalid", statusCode: 409
  });
}

export async function inspectInstalledDependencies(studioDirectory) {
  const studio = await realpath(resolve(studioDirectory));
  const modules = await realpath(join(studio, "node_modules"));
  const manifestBytes = await readFile(join(studio, "package.json"));
  const manifest = JSON.parse(manifestBytes);
  const packages = new Map(), resolutions = [], observed = new Map();
  const directoryMembers = new Map(), nestedInstallations = new Set();
  let totalBytes = 0, totalFiles = 0;
  const local = target => relative(modules, target).split(sep).join("/");
  const memberSignature = entries => digest(entries.map(entry => [entry.name,
    entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "link" : "unsupported"]));
  const list = async directory => {
    const actual = await realpath(directory);
    if (!inside(modules, actual)) fail();
    const entries = (await readdir(actual, {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name, "en"));
    const signature = memberSignature(entries), previous = directoryMembers.get(actual);
    if (previous !== undefined && previous !== signature) fail();
    if (directoryMembers.size >= 100000 && previous === undefined) fail();
    directoryMembers.set(actual, signature);
    return entries;
  };
  const read = async target => {
    const actual = await realpath(target);
    if (!inside(modules, actual)) fail();
    const info = await lstat(actual);
    if (!info.isFile() || info.size > MAX_FILE_BYTES
      || totalBytes + info.size > MAX_TOTAL_BYTES || totalFiles >= 100000) fail();
    const bytes = await readFile(actual);
    totalBytes += bytes.length; totalFiles += 1;
    if (bytes.length !== info.size || totalBytes > MAX_TOTAL_BYTES || totalFiles > 100000) fail();
    const record = {actual, bytes: bytes.length, sha256: sha(bytes)};
    const previous = observed.get(target);
    if (previous && (previous.actual !== actual || previous.sha256 !== record.sha256)) fail();
    observed.set(target, record);
    return bytes;
  };
  async function locate(name, from, optional) {
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(name)) fail();
    let cursor = from;
    while (inside(studio, cursor)) {
      const target = join(cursor, "node_modules", name);
      try {
        const actual = await realpath(target);
        if (!inside(modules, actual)) fail();
        resolutions.push({target, actual});
        return actual;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (cursor === studio) break;
      cursor = dirname(cursor);
    }
    if (!optional) fail();
    return null;
  }
  async function visit(target) {
    if (packages.has(target)) return;
    if (packages.size >= 2000) fail();
    const data = JSON.parse(await read(join(target, "package.json")));
    if (typeof data.name !== "string" || typeof data.version !== "string") fail();
    const record = {path: local(target), name: data.name, version: data.version, dependencies: []};
    packages.set(target, record);
    const files = [], directories = new Set();
    async function walk(directory) {
      const actual = await realpath(directory);
      if (!inside(target, actual) || directories.has(actual)) fail();
      directories.add(actual);
      for (const entry of await list(directory)) {
        const full = join(directory, entry.name);
        // Bind nested installations independently, including undeclared modules
        // behind a contained alias. A regular file with this name is still data.
        if (entry.name === "node_modules" && (entry.isDirectory() || entry.isSymbolicLink())) {
          nestedInstallations.add(full);
          continue;
        }
        if (entry.isDirectory()) await walk(full);
        else {
          if (entry.isSymbolicLink()) fail();
          const bytes = await read(full);
          files.push({path: relative(target, full).split(sep).join("/"), bytes: bytes.length, sha256: sha(bytes)});
        }
      }
    }
    await walk(target);
    record.contentSha256 = digest(files);
    record.fileCount = files.length;
    record.byteCount = files.reduce((sum, file) => sum + file.bytes, 0);
    const dependencies = {...data.dependencies, ...data.optionalDependencies};
    for (const name of Object.keys(dependencies).sort()) {
      const optional = Object.hasOwn(data.optionalDependencies ?? {}, name);
      const dependency = await locate(name, target, optional);
      record.dependencies.push({name, path: dependency ? local(dependency) : null, optional});
      if (dependency) await visit(dependency);
    }
    // Installed peers influence execution too; missing optional peers remain explicit.
    for (const name of Object.keys(data.peerDependencies ?? {}).sort()) {
      if (Object.hasOwn(dependencies, name)) continue;
      const optional = data.peerDependenciesMeta?.[name]?.optional === true;
      const dependency = await locate(name, target, optional);
      record.dependencies.push({name, path: dependency ? local(dependency) : null, optional});
      if (dependency) await visit(dependency);
    }
  }
  const direct = {...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies};
  const roots = [];
  for (const name of Object.keys(direct).sort()) {
    const optional = Object.hasOwn(manifest.optionalDependencies ?? {}, name);
    const target = await locate(name, studio, optional);
    if (target) {
      await visit(target);
      if (/^\d+\.\d+\.\d+$/u.test(direct[name]) && packages.get(target).version !== direct[name]) fail();
    }
    roots.push({name, path: target ? local(target) : null, optional});
  }
  // Node/Webpack may resolve an undeclared hoisted package. Inventory the
  // physical installation too, rather than treating declarations as a boundary.
  const scanned = new Set(), looseFiles = [], links = [];
  async function inventory(directory) {
    const logical = await lstat(directory), actual = await realpath(directory);
    if (!inside(modules, actual)) fail();
    if (logical.isSymbolicLink()) {
      links.push({path: local(directory), target: local(actual) || "."});
      resolutions.push({target: directory, actual});
    }
    if (!(await lstat(actual)).isDirectory()) {
      const bytes = await read(directory);
      looseFiles.push({path: local(directory), target: local(actual), bytes: bytes.length, sha256: sha(bytes)});
      return;
    }
    if (scanned.has(actual)) return;
    scanned.add(actual);
    const entries = await list(actual);
    if (actual !== modules && entries.some(entry => entry.name === "package.json" && entry.isFile())) {
      await visit(actual);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink() && !entry.isFile()) fail();
      await inventory(join(actual, entry.name));
    }
  }
  await inventory(modules);
  // Set iteration also visits nested installations discovered during this pass.
  for (const path of nestedInstallations) await inventory(path);
  for (const item of resolutions) if (await realpath(item.target) !== item.actual) fail();
  for (const [target, before] of observed) {
    if (await realpath(target) !== before.actual) fail();
    const info = await lstat(before.actual);
    if (!info.isFile() || info.size > MAX_FILE_BYTES || info.size !== before.bytes) fail();
    const bytes = await readFile(before.actual);
    if (bytes.length !== before.bytes || sha(bytes) !== before.sha256) fail();
  }
  for (const [directory, before] of directoryMembers) {
    if (await realpath(directory) !== directory) fail();
    const entries = (await readdir(directory, {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name, "en"));
    if (memberSignature(entries) !== before) fail();
  }
  if (!(await readFile(join(studio, "package.json"))).equals(manifestBytes)) fail();
  const content = {schemaVersion: VERSION, runtime: {node: process.version, platform: process.platform, arch: process.arch},
    rootManifestSha256: sha(manifestBytes), roots, looseFiles: looseFiles.sort((a,b) => a.path.localeCompare(b.path, "en")),
    links: links.sort((a,b) => a.path.localeCompare(b.path, "en")),
    packages: [...packages.values()].sort((a,b) => a.path.localeCompare(b.path, "en"))};
  return {...content, sha256: digest(content)};
}

export function installedDependencyIdentityValid(value) {
  try {
    const {sha256, ...content} = value;
    const keys = ["schemaVersion", "runtime", "rootManifestSha256", "roots", "packages", "looseFiles", "links", "sha256"];
    if (Object.keys(value).sort().join() !== keys.sort().join() || value.schemaVersion !== VERSION
      || !hex(sha256) || digest(content) !== sha256 || !hex(value.rootManifestSha256)
      || typeof value.runtime?.node !== "string" || typeof value.runtime.platform !== "string"
      || typeof value.runtime.arch !== "string" || !Array.isArray(value.roots) || !Array.isArray(value.packages)
      || value.packages.length > 2000 || !Array.isArray(value.looseFiles)
      || !Array.isArray(value.links) || !value.links.every(link => safe(link.path) && (link.target === "." || safe(link.target)))
      || !value.looseFiles.every(f => safe(f.path) && safe(f.target) && hex(f.sha256)
        && Number.isSafeInteger(f.bytes) && f.bytes >= 0)) return false;
    const paths = new Set(value.packages.map(p => p.path));
    if (paths.size !== value.packages.length) return false;
    const edgeValid = edge => typeof edge.name === "string" && typeof edge.optional === "boolean"
      && (edge.path === null ? edge.optional : safe(edge.path) && paths.has(edge.path));
    return value.roots.every(edgeValid) && value.packages.every(p => safe(p.path)
      && typeof p.name === "string" && typeof p.version === "string" && hex(p.contentSha256)
      && Number.isSafeInteger(p.fileCount) && p.fileCount > 0
      && Number.isSafeInteger(p.byteCount) && p.byteCount > 0
      && Array.isArray(p.dependencies) && p.dependencies.every(edgeValid));
  } catch { return false; }
}

export async function assertInstalledDependencies(studioDirectory, expected) {
  if (!installedDependencyIdentityValid(expected)) fail();
  const current = await inspectInstalledDependencies(studioDirectory);
  if (current.sha256 !== expected.sha256) fail();
  return current;
}
