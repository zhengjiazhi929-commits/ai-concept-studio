import { runCollectorAgent } from "../src/server/collector/agent.mjs";
import { loadPublicDiscoveryAuthorization } from "./lib/public-discovery-authority.mjs";
import { isDirectPublicDiscoveryCli, parsePublicDiscoveryArguments, reportPublicDiscoveryCli } from "./lib/public-discovery-cli.mjs";

export async function runCollectorCli(argv = process.argv.slice(2), { environment = process.env, runAgent = runCollectorAgent } = {}) {
  const parsed = parsePublicDiscoveryArguments(argv);
  const authorization = await loadPublicDiscoveryAuthorization({ environment, configPath: parsed.configPath });
  const result = await runAgent(authorization.forOperation("collector:run"));
  return {
    ok: true,
    actor: authorization.actor,
    runId: result.run.id,
    summary: result.run.summary,
    sourcesNeedingAssist: result.run.sourceResults
      .filter((source) => source.status === "assisted_required")
      .map((source) => source.creatorId)
  };
}

if (isDirectPublicDiscoveryCli(import.meta.url)) {
  await reportPublicDiscoveryCli(() => runCollectorCli());
}
