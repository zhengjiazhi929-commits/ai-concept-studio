import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  episodeProductionDirectory,
  workspaceRelativePath
} from "../../shared/paths.mjs";

export async function writeVersionedArtifact(episodeId, prefix, value) {
  const directory = episodeProductionDirectory(episodeId);
  await mkdir(directory, { recursive: true });
  const files = await readdir(directory);
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}-v(\\d{3})\\.json$`, "u");
  const highest = files.reduce((current, file) => {
    const match = pattern.exec(file);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  const version = highest + 1;
  const fileName = `${prefix}-v${String(version).padStart(3, "0")}.json`;
  const destination = resolve(directory, fileName);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
  return {
    version,
    path: destination,
    relativePath: workspaceRelativePath(destination)
  };
}
