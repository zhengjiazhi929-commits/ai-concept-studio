import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  ensureInside,
  episodeResearchLatestPath,
  researchAssistTaskPath,
  researchConfigPath,
  researchDataRoot,
  researchInboxRoot,
  researchLatestRunPath,
  researchRunsRoot,
  trendSelectionPath
} from "../../shared/paths.mjs";
import { validateResearchConfig } from "./schema.mjs";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonOr(path, fallback) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
  return path;
}

export async function readResearchConfig() {
  const document = await readJson(researchConfigPath);
  const validation = validateResearchConfig(document);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return document;
}

export async function readTrendSelection() {
  return readJsonOr(trendSelectionPath, null);
}

export async function readLatestResearchPack(episodeId = null) {
  const path = episodeId ? episodeResearchLatestPath(episodeId) : researchLatestRunPath;
  return readJsonOr(path, null);
}

export async function writeResearchPack(pack) {
  await mkdir(researchDataRoot, { recursive: true });
  const runPath = ensureInside(researchRunsRoot, resolve(researchRunsRoot, `${pack.id}.json`));
  await Promise.all([
    writeJsonAtomic(runPath, pack),
    writeJsonAtomic(researchLatestRunPath, pack),
    writeJsonAtomic(episodeResearchLatestPath(pack.episodeId), pack)
  ]);
  return runPath;
}

export async function readResearchAssistTask() {
  return readJsonOr(researchAssistTaskPath, null);
}

export async function writeResearchAssistTask(task) {
  return writeJsonAtomic(researchAssistTaskPath, task);
}

export async function writeResearchEvidenceBatch(batch) {
  const path = ensureInside(researchInboxRoot, resolve(researchInboxRoot, `${batch.batchId}.json`));
  await writeJsonAtomic(path, batch);
  return path;
}
