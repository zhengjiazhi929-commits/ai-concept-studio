import { runAgent } from "../src/server/orchestrator.mjs";

const episodeId = process.argv[2] || "golden-001";
const result = await runAgent(episodeId, "qa-agent");
console.log(
  JSON.stringify(
    {
      ok: result.output.status === "complete",
      episodeId,
      message: result.output.message,
      findings: result.output.findings
    },
    null,
    2
  )
);
