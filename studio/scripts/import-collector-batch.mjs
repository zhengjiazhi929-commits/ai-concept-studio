import { collectorInboxRoot } from "../src/shared/paths.mjs";
import { importAssistedCollectorBatch } from "../src/server/collector/agent.mjs";
import { loadPublicDiscoveryAuthorization } from "./lib/public-discovery-authority.mjs";
import { isDirectPublicDiscoveryCli, parsePublicDiscoveryArguments, readPublicDiscoveryBatch, reportPublicDiscoveryCli } from "./lib/public-discovery-cli.mjs";

export async function runImportCollectorBatchCli(argv = process.argv.slice(2), {
  environment = process.env,
  inboxRoot = collectorInboxRoot,
  importBatch = importAssistedCollectorBatch
} = {}) {
  const parsed = parsePublicDiscoveryArguments(argv, { batch: true });
  const authorization = await loadPublicDiscoveryAuthorization({ environment, configPath: parsed.configPath });
  const batch = await readPublicDiscoveryBatch(parsed.batchName, { inboxRoot, legacyImport: parsed.legacyImport });
  const result = await importBatch(batch, {
    ...authorization.forOperation("collector:import-assisted-batch"),
    legacyImport: Boolean(parsed.legacyImport)
  });
  return {
    ok: true,
    actor: authorization.actor,
    legacy: Boolean(parsed.legacyImport),
    runId: result.run.id,
    summary: result.run.summary
  };
}

if (isDirectPublicDiscoveryCli(import.meta.url)) {
  await reportPublicDiscoveryCli(() => runImportCollectorBatchCli());
}
