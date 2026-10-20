import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  localScriptCapabilitySpec,
  validateLocalScriptPreview,
  validateLocalScriptRequest
} from "../src/shared/local-script-import-request.mjs";
import { createCapabilityAuthority } from "../src/server/security/side-effect-capability.mjs";

const valueFlags = new Map([
  ["--episode", "episodeId"],
  ["--candidate", "candidatePath"],
  ["--candidate-sha256", "candidateSha256"],
  ["--snapshot", "snapshotHash"],
  ["--actor", "actor"],
  ["--reason", "reason"]
]);
const publicErrorCodes = new Set([
  "local_script_arguments_invalid",
  "local_script_dependencies_invalid",
  "local_script_request_invalid",
  "local_script_candidate_invalid",
  "local_script_candidate_missing",
  "local_script_candidate_changed",
  "local_script_artifact_changed",
  "local_script_episode_missing",
  "local_script_episode_invalid",
  "local_script_episode_busy",
  "local_script_evidence_invalid",
  "local_script_file_changed",
  "local_script_file_invalid",
  "local_script_json_invalid",
  "local_script_options_invalid",
  "local_script_snapshot_changed",
  "local_script_research_changed",
  "local_script_research_binding_changed",
  "local_script_research_not_approved",
  "local_script_source_invalid",
  "local_script_source_changed",
  "local_script_source_incomplete",
  "local_script_source_unregistered",
  "local_script_path_invalid",
  "local_script_import_conflict",
  "local_script_import_superseded",
  "local_script_sink_forbidden",
  "local_script_superseded",
  "side_effect_capability_expired",
  "side_effect_capability_missing"
]);

function cliError(code) {
  return Object.assign(new Error("本地讲稿导入参数或调用无效"), { code });
}

export function parseLocalScriptArguments(argv) {
  const invalid = () => cliError("local_script_arguments_invalid");
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== "string")) throw invalid();
  const args = [...argv];
  if (args[0] === "--") args.shift();
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--confirm-local-script-import") {
      if (Object.hasOwn(values, "confirmLocalScriptImport")) throw invalid();
      values.confirmLocalScriptImport = true;
      continue;
    }
    const key = valueFlags.get(flag);
    if (!key || Object.hasOwn(values, key)) throw invalid();
    const value = args[++index];
    if (!value || !value.trim() || value.startsWith("-") || /\p{Cc}/u.test(value)) throw invalid();
    values[key] = value;
  }
  if (!values.episodeId || !values.candidatePath) throw invalid();
  if (Object.keys(values).length === 2) {
    return Object.freeze({ mode: "preview", request: Object.freeze(validateLocalScriptPreview(values)) });
  }
  if (!values.confirmLocalScriptImport || [...valueFlags.values()].some((key) => !Object.hasOwn(values, key))) throw invalid();
  return Object.freeze({ mode: "import", request: Object.freeze(validateLocalScriptRequest(values)) });
}

export async function runLocalScriptCli(argv = process.argv.slice(2), dependencies = {}) {
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(dependencies)) ||
    Reflect.ownKeys(dependencies).some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
      return !["preview", "import"].includes(key) || !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "function";
    })) {
    throw cliError("local_script_dependencies_invalid");
  }
  const parsed = parseLocalScriptArguments(argv);
  if (parsed.mode === "preview") {
    const preview = dependencies.preview ?? (await import("../src/server/production/local-script-import.mjs")).previewLocalScript;
    return { ok: true, mode: "preview", preview: await preview(parsed.request) };
  }

  // This is an explicit OS-local user declaration, not an authenticated login.
  // Its fresh process-only authority cannot load credentials or grant paid work.
  const spec = localScriptCapabilitySpec(parsed.request);
  const authority = createCapabilityAuthority({
    secret: randomBytes(32).toString("hex"),
    defaultTtlMs: 5 * 60_000,
    maximumTtlMs: 5 * 60_000,
    maximumCalls: 0,
    maximumCostUsd: 0
  });
  const sideEffectGrant = authority.authorize(spec);
  const importScript = dependencies.import ?? (await import("../src/server/production/local-script-import.mjs")).importLocalScript;
  const result = await importScript(parsed.request, Object.freeze({ sideEffectGrant }));
  return { ok: true, mode: "imported", result };
}

export async function reportLocalScriptCli(run = () => runLocalScriptCli()) {
  try {
    console.log(JSON.stringify(await run(), null, 2));
  } catch (error) {
    // Fixed codes only: raw provider or filesystem details may contain secrets.
    const code = publicErrorCodes.has(error?.code) ? error.code : "local_script_cli_failed";
    console.error(JSON.stringify({
      ok: false,
      code,
      message: "本地讲稿导入未完成；请检查显式确认参数，必要时重新预览候选文件与当前研究快照。"
    }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await reportLocalScriptCli();
}
