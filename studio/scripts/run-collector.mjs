import { runCollectorAgent } from "../src/server/collector/agent.mjs";

const result = await runCollectorAgent();
console.log(
  JSON.stringify(
    {
      ok: true,
      runId: result.run.id,
      summary: result.run.summary,
      sourcesNeedingAssist: result.run.sourceResults
        .filter((source) => source.status === "assisted_required")
        .map((source) => source.creatorId)
    },
    null,
    2
  )
);
