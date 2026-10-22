import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manualTopicCapabilitySpec } from "../src/shared/manual-topic-decision.mjs";
import { createCapabilityAuthority } from "../src/server/security/side-effect-capability.mjs";
import { approveManualTopic, previewManualTopic } from "../src/server/trends/manual-selection.mjs";

const valueFlags = new Map([
  ["--candidate", "candidateId"],
  ["--run", "runId"],
  ["--snapshot", "snapshotHash"],
  ["--actor", "actor"],
  ["--reason", "reason"]
]);
const publicErrorCodes = new Set([
  "manual_topic_arguments_invalid",
  "manual_topic_dependencies_invalid",
  "manual_topic_request_invalid",
  "manual_topic_candidate_missing",
  "manual_topic_snapshot_changed",
  "manual_topic_already_in_production",
  "manual_topic_evidence_missing",
  "manual_topic_decision_conflict",
  "manual_topic_episode_conflict",
  "manual_topic_episode_invalid",
  "manual_topic_selection_changed",
  "side_effect_capability_expired",
  "side_effect_capability_missing"
]);

function cliError(code) {
  return Object.assign(new Error("本地人工选题参数或调用无效"), { code });
}

export function parseManualTopicArguments(argv) {
  const invalid = () => cliError("manual_topic_arguments_invalid");
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== "string")) throw invalid();
  const args = [...argv];
  if (args[0] === "--") args.shift();
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--confirm-manual-selection") {
      if (Object.hasOwn(values, "confirmManualSelection")) throw invalid();
      values.confirmManualSelection = true;
      continue;
    }
    const key = valueFlags.get(flag);
    if (!key || Object.hasOwn(values, key)) throw invalid();
    const value = args[++index];
    if (!value || !value.trim() || value.startsWith("-") || value.includes("\0")) throw invalid();
    values[key] = value;
  }
  if (!values.candidateId) throw invalid();
  if (Object.keys(values).length === 1) {
    return Object.freeze({ mode: "preview", candidateId: values.candidateId });
  }
  if (!values.confirmManualSelection || [...valueFlags.values()].some((key) => !Object.hasOwn(values, key))) {
    throw invalid();
  }
  return Object.freeze({ mode: "select", request: Object.freeze(values) });
}

export async function runManualTopicCli(argv = process.argv.slice(2), dependencies = {}) {
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)
    || Object.keys(dependencies).some((key) => !["preview", "approve"].includes(key) || typeof dependencies[key] !== "function")) {
    throw cliError("manual_topic_dependencies_invalid");
  }
  const parsed = parseManualTopicArguments(argv);
  if (parsed.mode === "preview") {
    const preview = await (dependencies.preview ?? previewManualTopic)(parsed.candidateId);
    return { ok: true, mode: "preview", preview };
  }

  // This is an OS-local user's explicit actor declaration, not account login.
  // Never load discovery credentials, persist a secret, or expose the authority.
  const spec = manualTopicCapabilitySpec(parsed.request);
  const authority = createCapabilityAuthority({
    secret: randomBytes(32).toString("hex"),
    defaultTtlMs: 5 * 60_000,
    maximumTtlMs: 5 * 60_000,
    maximumCalls: 0,
    maximumCostUsd: 0
  });
  const sideEffectGrant = authority.authorize(spec);
  const result = await (dependencies.approve ?? approveManualTopic)(parsed.request, Object.freeze({ sideEffectGrant }));
  return { ok: true, mode: "selected", result };
}

export async function reportManualTopicCli(run = () => runManualTopicCli()) {
  try {
    console.log(JSON.stringify(await run(), null, 2));
  } catch (error) {
    // Only fixed known codes escape; raw errors may contain user input or secrets.
    const code = publicErrorCodes.has(error?.code) ? error.code : "manual_topic_cli_failed";
    console.error(JSON.stringify({
      ok: false,
      code,
      message: "本地人工选题未完成；请检查全部确认参数，必要时重新预览当前候选与快照。"
    }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await reportManualTopicCli();
}
