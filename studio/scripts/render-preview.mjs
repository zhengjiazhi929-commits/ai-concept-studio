import { runAgent } from "../src/server/orchestrator.mjs";

const episodeId = process.argv[2] || "golden-001";
const result = await runAgent(episodeId, "render-agent");
console.log(
  JSON.stringify(
    {
      ok: result.output.status === "complete",
      episodeId,
      message: result.output.message,
      artifacts: result.output.artifacts
    },
    null,
    2
  )
);
