import { access, cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import {
  cloudBackupConfigPath,
  cloudBackupStatusPath,
  publicRoot,
  studioOutputRoot,
  workspaceRoot
} from "./paths.mjs";

const githubRemotePattern = /(?:https?:\/\/(?:[^/@]+@)?github\.com\/|git@github\.com:)([^\s/]+\/[^\s]+?)(?:\.git)?$/iu;

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function extractOriginUrl(gitConfig = "") {
  const section = gitConfig.match(/\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/u)?.[1] ?? "";
  return section.match(/^\s*url\s*=\s*(.+)\s*$/mu)?.[1]?.trim() ?? null;
}

export function sanitizeGithubRemote(remoteUrl) {
  if (!remoteUrl) return null;
  const repository = remoteUrl.match(githubRemotePattern)?.[1]?.replace(/\.git$/iu, "");
  return repository ? `https://github.com/${repository}` : null;
}

async function readRef(gitRoot, refName) {
  try {
    return (await readFile(resolve(gitRoot, refName), "utf8")).trim();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    const packed = await readFile(resolve(gitRoot, "packed-refs"), "utf8");
    return packed
      .split(/\r?\n/u)
      .map((line) => line.trim().split(/\s+/u))
      .find(([, name]) => name === refName)?.[0] ?? null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function getGitHubStatus() {
  const gitRoot = resolve(workspaceRoot, ".git");
  let config = "";
  try {
    config = await readFile(resolve(gitRoot, "config"), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const repositoryUrl = sanitizeGithubRemote(extractOriginUrl(config));
  const headValue = await readFile(resolve(gitRoot, "HEAD"), "utf8").catch(() => "");
  const localRef = headValue.trim().startsWith("ref:")
    ? headValue.trim().slice(5).trim()
    : null;
  const localSha = localRef ? await readRef(gitRoot, localRef) : headValue.trim() || null;
  const remoteSha = await readRef(gitRoot, "refs/remotes/origin/main");

  return {
    provider: "github",
    configured: Boolean(repositoryUrl),
    repositoryUrl,
    synced: Boolean(repositoryUrl && localSha && remoteSha && localSha === remoteSha),
    pendingPush: Boolean(repositoryUrl && localSha !== remoteSha)
  };
}

function inferredOneDriveRoot() {
  const root =
    process.env.OneDriveConsumer || process.env.OneDriveCommercial || process.env.OneDrive;
  return root ? resolve(root, "AI Concept Studio") : null;
}

export function validateBackupDestination(destination) {
  if (!destination || !isAbsolute(destination)) {
    throw new Error("云端素材目录必须是绝对路径");
  }

  const target = resolve(destination);
  if (target === parse(target).root) {
    throw new Error("云端素材目录不能是磁盘根目录");
  }

  const relativeToWorkspace = relative(workspaceRoot, target);
  if (!relativeToWorkspace.startsWith("..") && !isAbsolute(relativeToWorkspace)) {
    throw new Error("云端素材目录不能位于项目仓库内部");
  }
  return target;
}

export async function resolveMediaBackupConfiguration() {
  const localConfig = await readJsonIfPresent(cloudBackupConfigPath);
  const mediaRoot = localConfig?.mediaRoot || inferredOneDriveRoot();
  if (!mediaRoot) return null;
  return {
    provider: localConfig?.provider || "onedrive",
    mediaRoot: validateBackupDestination(mediaRoot),
    source: localConfig ? "local-config" : "windows-onedrive"
  };
}

async function getMediaStatus() {
  const configuration = await resolveMediaBackupConfiguration();
  const backup = await readJsonIfPresent(cloudBackupStatusPath);
  return {
    provider: configuration?.provider || "onedrive",
    configured: Boolean(configuration),
    available: configuration ? await pathExists(dirname(configuration.mediaRoot)) : false,
    lastBackupAt: backup?.completedAt ?? null,
    lastBackupStatus: backup?.status ?? null,
    copiedFiles: backup?.copiedFiles ?? 0
  };
}

export async function getCloudBackupStatus() {
  const [code, media] = await Promise.all([getGitHubStatus(), getMediaStatus()]);
  let state = "local_only";
  let summary = "数据仅保存在本机";

  if (code.synced && media.lastBackupStatus === "complete") {
    state = "protected";
    summary = "代码与视频已云端备份";
  } else if (code.synced) {
    state = "code_only";
    summary = "代码已上云 · 视频仍在本机";
  } else if (code.configured || media.configured) {
    state = "partial";
    summary = "云端备份尚未完成";
  }

  return { state, summary, code, media };
}

async function listFiles(root) {
  if (!(await pathExists(root))) return [];
  const { readdir } = await import("node:fs/promises");
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files;
}

async function writeBackupStatus(value) {
  await mkdir(dirname(cloudBackupStatusPath), { recursive: true });
  const temporaryPath = `${cloudBackupStatusPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, cloudBackupStatusPath);
}

async function copyDirectoryIfPresent(source, destination) {
  if (!(await pathExists(source))) return 0;
  const files = await listFiles(source);
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: true, errorOnExist: false });
  return files.length;
}

export async function runFullMediaBackup() {
  const configuration = await resolveMediaBackupConfiguration();
  if (!configuration) {
    return { status: "not_configured", copiedFiles: 0 };
  }

  const startedAt = new Date().toISOString();
  await mkdir(configuration.mediaRoot, { recursive: true });
  const copiedFiles =
    (await copyDirectoryIfPresent(studioOutputRoot, join(configuration.mediaRoot, "videos"))) +
    (await copyDirectoryIfPresent(resolve(publicRoot, "episodes"), join(configuration.mediaRoot, "assets")));
  const result = {
    schemaVersion: 1,
    provider: configuration.provider,
    status: "complete",
    startedAt,
    completedAt: new Date().toISOString(),
    copiedFiles
  };
  await writeBackupStatus(result);
  await writeFile(
    join(configuration.mediaRoot, "backup-manifest.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );
  return result;
}

export async function backupRenderedFile(outputPath) {
  const configuration = await resolveMediaBackupConfiguration();
  if (!configuration) return { status: "not_configured" };

  const source = resolve(outputPath);
  const sourceRelativePath = relative(studioOutputRoot, source);
  if (sourceRelativePath.startsWith("..") || isAbsolute(sourceRelativePath)) {
    throw new Error("只允许备份系统生成的视频文件");
  }
  if (!(await pathExists(source)) || !(await stat(source)).isFile()) {
    throw new Error("待备份的视频文件不存在");
  }

  const destination = resolve(configuration.mediaRoot, "videos", sourceRelativePath);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { force: true });
  const result = {
    schemaVersion: 1,
    provider: configuration.provider,
    status: "complete",
    completedAt: new Date().toISOString(),
    copiedFiles: 1
  };
  await writeBackupStatus(result);
  return result;
}
