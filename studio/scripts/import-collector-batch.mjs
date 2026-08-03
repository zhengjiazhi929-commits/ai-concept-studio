import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectorInboxRoot, ensureInside } from "../src/shared/paths.mjs";
import { importAssistedCollectorBatch } from "../src/server/collector/agent.mjs";

const batchName = process.argv.slice(2).find((argument) => argument !== "--");
if (!batchName) throw new Error("请提供 data/collector/inbox 中的批次文件名");
const batchPath = ensureInside(collectorInboxRoot, resolve(collectorInboxRoot, batchName));
const batch = JSON.parse(await readFile(batchPath, "utf8"));
const result = await importAssistedCollectorBatch(batch);
console.log(JSON.stringify({ ok: true, runId: result.run.id, summary: result.run.summary }, null, 2));
