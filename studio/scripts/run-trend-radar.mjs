import { runTrendRadarAgent } from "../src/server/trends/agent.mjs";

const result = await runTrendRadarAgent();
console.log(
  JSON.stringify(
    {
      ok: true,
      runId: result.run.id,
      summary: result.run.summary,
      candidates: result.run.candidates.slice(0, 8).map((candidate) => ({
        rank: candidate.rank,
        id: candidate.id,
        concept: candidate.concept,
        pool: candidate.recommendedPool,
        score: candidate.score.score,
        creators14: candidate.heatGate.creators14,
        confidence: candidate.confidence.level
      }))
    },
    null,
    2
  )
);
