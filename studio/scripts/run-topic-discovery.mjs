import {collectorAssistTaskPath, collectorInboxRoot} from "../src/shared/paths.mjs";
import {runCollectorAgent, importAssistedCollectorBatch} from "../src/server/collector/agent.mjs";
import {runTrendRadarAgent} from "../src/server/trends/agent.mjs";
import {loadPublicDiscoveryAuthorization, publicDiscoveryError} from "./lib/public-discovery-authority.mjs";
import {isDirectPublicDiscoveryCli, parsePublicDiscoveryArguments, readPublicDiscoveryBatch, reportPublicDiscoveryCli} from "./lib/public-discovery-cli.mjs";

function parseWorkflowArguments(argv) {
  const args = [...argv];
  const index = args.indexOf("--batch");
  if (index < 0) return parsePublicDiscoveryArguments(args);
  if (!args[index + 1] || args[index + 1].startsWith("-")) throw publicDiscoveryError("public_discovery_arguments_invalid", "--batch需要收件箱文件名");
  args.splice(index, 1);
  if (args.includes("--legacy-import")) throw publicDiscoveryError("public_discovery_batch_version", "选题workflow只接受v2近期发现批次");
  return parsePublicDiscoveryArguments(args, {batch: true});
}

// Collection and assisted continuation deliberately remain separate: this CLI
// does not invoke a paid model, browser account, human approval or Research gate.
export async function runTopicDiscoveryCli(argv = process.argv.slice(2), {
  environment = process.env, inboxRoot = collectorInboxRoot,
  collect = runCollectorAgent, importBatch = importAssistedCollectorBatch, radar = runTrendRadarAgent
} = {}) {
  const parsed = parseWorkflowArguments(argv);
  const authorization = await loadPublicDiscoveryAuthorization({environment, configPath: parsed.configPath});
  const batch = parsed.batchName ? await readPublicDiscoveryBatch(parsed.batchName, {inboxRoot}) : null;
  const collection = batch
    ? await importBatch(batch, {...authorization.forOperation("collector:import-assisted-batch"), refreshRadar: false})
    : await collect({...authorization.forOperation("collector:run"), refreshRadar: false});
  // Always recompute, including zero accepted observations: a previous ranking
  // must not survive as a misleading current result when the evidence is stale.
  const result = await radar(authorization.forOperation("trend:run"));
  return {
    ok: true, actor: authorization.actor,
    status: result.run.summary.formalCandidateCount > 0 ? "awaiting_topic_selection"
      : batch ? "needs_more_evidence" : "awaiting_public_discovery",
    authorizesCandidateSelection: false, paidModelCalls: 0,
    collectorRunId: collection.run.id, trendRunId: result.run.id,
    collection: collection.run.summary,
    discovery: collection.run.discoverySummary ?? null,
    summary: result.run.summary, candidates: result.run.candidates,
    continuation: batch ? null : {
      kind: "codex-public-page-review", taskId: collection.assistTask?.taskId ?? null,
      taskPath: collectorAssistTaskPath, sourceCount: collection.assistTask?.tasks.length ?? null,
      nextCommand: "pnpm topic:discover -- --batch <v2-batch.json>",
      rule: "按任务核对原作品作者与日期，记录未核验和受限来源；不能自动选题。"
    }
  };
}

if (isDirectPublicDiscoveryCli(import.meta.url)) await reportPublicDiscoveryCli(() => runTopicDiscoveryCli());
