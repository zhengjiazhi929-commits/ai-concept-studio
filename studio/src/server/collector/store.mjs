import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  collectorAssistTaskPath,
  collectorConfigPath,
  collectorLatestRunPath,
  collectorRunsRoot,
  collectorSourceHealthPath
} from "../../shared/paths.mjs";
import { validateCollectorConfig } from "./schema.mjs";

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
}

export async function readCollectorConfig() {
  const document = await readJson(collectorConfigPath);
  const validation = validateCollectorConfig(document);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return document;
}

export async function readLatestCollectorRun() {
  return readJsonOr(collectorLatestRunPath, null);
}

export async function readCollectorSourceHealth() {
  return readJsonOr(collectorSourceHealthPath, {
    schemaVersion: 1,
    updatedAt: null,
    sources: []
  });
}

export async function readCollectorAssistTask() {
  return readJsonOr(collectorAssistTaskPath, null);
}

export async function writeCollectorRun(run) {
  const runPath = resolve(collectorRunsRoot, `${run.id}.json`);
  await writeJsonAtomic(runPath, run);
  await writeJsonAtomic(collectorLatestRunPath, run);
  return runPath;
}

export async function updateCollectorSourceHealth(entries, updatedAt) {
  const current = await readCollectorSourceHealth();
  const sourceMap = new Map(current.sources.map((source) => [source.creatorId, source]));
  for (const entry of entries) {
    sourceMap.set(entry.creatorId, {
      ...(sourceMap.get(entry.creatorId) ?? {}),
      ...entry
    });
  }
  const document = {
    schemaVersion: 1,
    updatedAt,
    sources: Array.from(sourceMap.values()).sort((a, b) =>
      a.creatorId.localeCompare(b.creatorId)
    )
  };
  await writeJsonAtomic(collectorSourceHealthPath, document);
  return document;
}

export async function writeCollectorAssistTask(task) {
  await writeJsonAtomic(collectorAssistTaskPath, task);
  return collectorAssistTaskPath;
}
