import { runAgent } from "../src/server/orchestrator.mjs";
import { readTrendSelection } from "../src/server/research/store.mjs";

const selection = await readTrendSelection();
if (!selection?.episodeId) throw new Error("请先在热点概念雷达中选择一个正式候选");
const result = await runAgent(selection.episodeId, "research-agent");
console.log(
  JSON.stringify(
    {
      ok: true,
      episodeId: selection.episodeId,
      status: result.output.status,
      message: result.output.message,
      findings: result.output.findings
    },
    null,
    2
  )
);
