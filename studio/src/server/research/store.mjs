import { mkdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  ensureInside,
  researchAssistTaskPath,
  researchConfigPath,
  researchDataRoot,
  researchInboxRoot,
  researchLatestRunPath,
  researchRunsRoot,
  trendSelectionPath,
  trendsDataRoot,
  workspaceRoot
} from "../../shared/paths.mjs";
import {
  assertNoDurableJsonStoreHooks,
  jsonDocumentContentSha256,
  publishImmutableJsonWithPointers,
  readJsonDocumentSetPointer,
  readJsonDocument,
  readJsonDocumentOr,
  readJsonPublicationPointer,
  recoverJsonPublication,
  withDurableJsonStoreLock,
  writeImmutableJsonDocument,
  writeJsonDocumentAtomic
} from "../../shared/durable-json-store.mjs";
import { validateResearchConfig } from "./schema.mjs";

const RESEARCH_PUBLICATION_JOURNAL = ".research-publication.json";
const TREND_PUBLICATION_JOURNAL = ".trend-publication.json";

function resolveResearchDataPaths(options = {}) {
  if (!options.researchRoot) {
    return {
      root: researchDataRoot,
      runs: researchRunsRoot,
      inbox: researchInboxRoot,
      latestRun: researchLatestRunPath,
      assistTask: researchAssistTaskPath,
      episodes: resolve(researchDataRoot, "episodes")
    };
  }
  const root = resolve(options.researchRoot);
  return {
    root,
    runs: resolve(root, "runs"),
    inbox: resolve(root, "inbox"),
    latestRun: resolve(root, "latest.json"),
    assistTask: resolve(root, "assist-task.json"),
    episodes: resolve(root, "episodes")
  };
}

function episodeLatestPath(paths, episodeId) {
  return ensureInside(paths.episodes, resolve(paths.episodes, episodeId, "latest.json"));
}

async function withResearchStoreLock(options, operation) {
  assertNoDurableJsonStoreHooks(options);
  const paths = resolveResearchDataPaths(options);
  return withDurableJsonStoreLock(paths.root, options, async () => {
    await recoverJsonPublication(paths.root, RESEARCH_PUBLICATION_JOURNAL);
    return operation(paths);
  });
}

export async function readResearchConfig() {
  const document = await readJsonDocument(researchConfigPath);
  const validation = validateResearchConfig(document);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return document;
}

export async function readTrendSelection() {
  return readJsonDocumentSetPointer(
    trendsDataRoot,
    TREND_PUBLICATION_JOURNAL,
    trendSelectionPath,
    null
  );
}

export async function readLatestResearchPack(episodeId = null, options = {}) {
  const paths = resolveResearchDataPaths(options);
  const path = episodeId ? episodeLatestPath(paths, episodeId) : paths.latestRun;
  return readJsonPublicationPointer(
    paths.root,
    RESEARCH_PUBLICATION_JOURNAL,
    path,
    null
  );
}

export async function writeResearchPack(pack, options = {}) {
  return withResearchStoreLock(options, async (paths) => {
    // A research pack keeps its logical ID while source inspections and
    // evidence imports create new revisions. Bind every immutable run file to
    // its content so those revisions cannot overwrite each other.
    const revision = jsonDocumentContentSha256(pack).slice(0, 16);
    const runPath = ensureInside(
      paths.runs,
      resolve(paths.runs, `${pack.id}-${revision}.json`)
    );
    return publishImmutableJsonWithPointers({
      root: paths.root,
      journalName: RESEARCH_PUBLICATION_JOURNAL,
      runPath,
      value: pack,
      pointerPaths: [paths.latestRun, episodeLatestPath(paths, pack.episodeId)]
    });
  });
}

function researchPackRevisionPath(pack, paths) {
  const revision = jsonDocumentContentSha256(pack).slice(0, 16);
  return ensureInside(
    paths.runs,
    resolve(paths.runs, `${pack.id}-${revision}.json`)
  );
}

export async function writeResearchPackRevision(pack, options = {}) {
  return withResearchStoreLock(options, async (paths) => {
    const runPath = researchPackRevisionPath(pack, paths);
    await writeImmutableJsonDocument(runPath, pack, { storeRoot: paths.root });
    return runPath;
  });
}

export async function publishResearchPackRevision(pack, runPath, options = {}) {
  return withResearchStoreLock(options, async (paths) => {
    const expectedRunPath = researchPackRevisionPath(pack, paths);
    if (resolve(runPath) !== expectedRunPath) {
      const error = new Error("Research pack path does not match its content revision");
      error.code = "research_pack_revision_mismatch";
      error.statusCode = 409;
      throw error;
    }
    return publishImmutableJsonWithPointers({
      root: paths.root,
      journalName: RESEARCH_PUBLICATION_JOURNAL,
      runPath: expectedRunPath,
      value: pack,
      pointerPaths: [paths.latestRun, episodeLatestPath(paths, pack.episodeId)]
    });
  });
}

export async function readResearchPackAtPath(path, options = {}) {
  const paths = resolveResearchDataPaths(options);
  const target = isAbsolute(path)
    ? resolve(path)
    : resolve(workspaceRoot, path);
  const safeTarget = ensureInside(paths.root, target);
  return readJsonDocument(safeTarget, { storeRoot: paths.root });
}

export async function readResearchAssistTask(options = {}) {
  const paths = resolveResearchDataPaths(options);
  return readJsonDocumentOr(paths.assistTask, null, { storeRoot: paths.root });
}

export async function writeResearchAssistTask(task, options = {}) {
  assertNoDurableJsonStoreHooks(options);
  const paths = resolveResearchDataPaths(options);
  await mkdir(paths.root, { recursive: true });
  return writeJsonDocumentAtomic(paths.assistTask, task, { storeRoot: paths.root });
}

export async function writeResearchEvidenceBatch(batch, options = {}) {
  assertNoDurableJsonStoreHooks(options);
  const paths = resolveResearchDataPaths(options);
  const path = ensureInside(paths.inbox, resolve(paths.inbox, `${batch.batchId}.json`));
  await mkdir(paths.root, { recursive: true });
  await writeImmutableJsonDocument(path, batch, { storeRoot: paths.root });
  return path;
}
