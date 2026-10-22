import { runTrendRadarAgent } from "../src/server/trends/agent.mjs";
import { loadPublicDiscoveryAuthorization } from "./lib/public-discovery-authority.mjs";
import { isDirectPublicDiscoveryCli, parsePublicDiscoveryArguments, reportPublicDiscoveryCli } from "./lib/public-discovery-cli.mjs";

export async function runTrendRadarCli(argv = process.argv.slice(2), { environment = process.env, runAgent = runTrendRadarAgent } = {}) {
  const parsed = parsePublicDiscoveryArguments(argv);
  const authorization = await loadPublicDiscoveryAuthorization({ environment, configPath: parsed.configPath });
  const result = await runAgent(authorization.forOperation("trend:run"));
  return {
    ok: true,
    actor: authorization.actor,
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
  };
}

if (isDirectPublicDiscoveryCli(import.meta.url)) {
  await reportPublicDiscoveryCli(() => runTrendRadarCli());
}
