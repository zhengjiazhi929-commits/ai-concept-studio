import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  updateCollectorSourceHealth,
  writeCollectorRun
} from "../../src/server/collector/store.mjs";
import { writeResearchPack } from "../../src/server/research/store.mjs";
import {
  publishImmutableJsonWithPointers,
  publishJsonDocumentSet
} from "../../src/shared/durable-json-store.mjs";

const [mode, root, barrierPath, rawIndex] = process.argv.slice(2);
const index = Number(rawIndex);

async function waitForBarrier() {
  if (barrierPath === "-") return;
  const deadline = Date.now() + 10000;
  while (true) {
    try {
      await access(barrierPath);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (Date.now() >= deadline) throw new Error("worker barrier timed out");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  }
}

function collectorRun(id) {
  return {
    schemaVersion: 1,
    id,
    startedAt: `2026-08-31T12:00:${String(index).padStart(2, "0")}.000Z`,
    status: "completed",
    observations: []
  };
}

function researchPack(id, episodeId = "episode-concurrent") {
  return {
    schemaVersion: 1,
    id,
    episodeId,
    updatedAt: `2026-08-31T12:00:${String(index).padStart(2, "0")}.000Z`,
    sources: [],
    claims: []
  };
}

await waitForBarrier();

if (mode === "collector-health") {
  await updateCollectorSourceHealth(
    [{ creatorId: `creator-${index}`, status: "healthy", sequence: index }],
    `2026-08-31T12:00:${String(index).padStart(2, "0")}.000Z`,
    { collectorRoot: root }
  );
} else if (mode === "collector-run") {
  await writeCollectorRun(collectorRun(`collector-run-${index}`), { collectorRoot: root });
} else if (mode === "research-pack") {
  await writeResearchPack(researchPack(`research-run-${index}`), { researchRoot: root });
} else if (mode === "collector-crash-window") {
  await mkdir(root, { recursive: true });
  const run = collectorRun("collector-crash-run");
  process.stdout.write("ready\n");
  await publishImmutableJsonWithPointers({
    root,
    journalName: ".collector-publication.json",
    runPath: resolve(root, "runs", "collector-crash-run.json"),
    value: run,
    pointerPaths: [
      resolve(root, "latest.json"),
      ...Array.from({ length: 256 }, (_, pointerIndex) =>
        resolve(root, "crash-pointers", `${pointerIndex}.json`)
      )
    ]
  });
} else if (mode === "research-crash-window") {
  await mkdir(root, { recursive: true });
  const pack = researchPack("research-crash-run", "episode-crash");
  process.stdout.write("ready\n");
  await publishImmutableJsonWithPointers({
    root,
    journalName: ".research-publication.json",
    runPath: resolve(root, "runs", "research-crash-run.json"),
    value: pack,
    pointerPaths: [
      resolve(root, "latest.json"),
      resolve(root, "episodes", "episode-crash", "latest.json"),
      ...Array.from({ length: 256 }, (_, pointerIndex) =>
        resolve(root, "crash-pointers", `${pointerIndex}.json`)
      )
    ]
  });
} else if (mode === "document-set-crash-window") {
  await mkdir(root, { recursive: true });
  process.stdout.write("ready\n");
  await publishJsonDocumentSet({
    root,
    journalName: ".document-set-publication.json",
    documents: Array.from({ length: 256 }, (_, documentIndex) => ({
      path: resolve(root, "document-set", `${documentIndex}.json`),
      value: {
        schemaVersion: 1,
        publication: "crash-window",
        documentIndex
      }
    }))
  });
} else {
  throw new Error(`unknown durable JSON worker mode: ${mode}`);
}
