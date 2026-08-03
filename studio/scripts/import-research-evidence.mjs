import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureInside, researchInboxRoot } from "../src/shared/paths.mjs";
import { importResearchEvidenceBatch } from "../src/server/research/agent.mjs";

const batchName = process.argv.slice(2).find((argument) => argument !== "--");
if (!batchName) throw new Error("请提供 data/research/inbox 中的证据批次文件名");
const batchPath = ensureInside(researchInboxRoot, resolve(researchInboxRoot, batchName));
const batch = JSON.parse(await readFile(batchPath, "utf8"));
const result = await importResearchEvidenceBatch(batch);
console.log(
  JSON.stringify(
    {
      ok: true,
      episodeId: batch.episodeId,
      readyForFactApproval: result.pack.readiness.readyForFactApproval,
      readiness: result.pack.readiness
    },
    null,
    2
  )
);
