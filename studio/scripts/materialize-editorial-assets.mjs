import {randomBytes} from "node:crypto";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {validateEditorialAssetsMaterializePreview, validateEditorialAssetsMaterializeRequest,
  editorialAssetsMaterializeCapabilitySpec} from "../src/shared/editorial-assets-materialize-request.mjs";
import {createCapabilityAuthority} from "../src/server/security/side-effect-capability.mjs";

const flags = new Map([["--episode", "episodeId"], ["--snapshot", "snapshotHash"], ["--candidate-hash", "candidateHash"],
  ["--machine-review", "machineReviewId"], ["--implementation-hash", "implementationHash"], ["--actor", "actor"], ["--reason", "reason"]]);
const invalid = () => Object.assign(new Error("本地素材物化参数无效"), {code: "editorial_materialization_arguments_invalid"});
export function parseEditorialAssetsMaterializeArguments(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== "string")) throw invalid();
  const args = [...argv]; if (args[0] === "--") args.shift();
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--confirm-editorial-assets-materialization") {
      if (Object.hasOwn(values, "confirmEditorialAssetsMaterialization")) throw invalid();
      values.confirmEditorialAssetsMaterialization = true; continue;
    }
    const key = flags.get(flag); const value = args[++index];
    if (!key || Object.hasOwn(values, key) || !value?.trim() || value.startsWith("-") || /\p{Cc}/u.test(value)) throw invalid();
    values[key] = value;
  }
  if (Object.keys(values).length === 1) return Object.freeze({mode: "preview", request: Object.freeze(validateEditorialAssetsMaterializePreview(values))});
  return Object.freeze({mode: "materialize", request: Object.freeze(validateEditorialAssetsMaterializeRequest(values))});
}
export async function runEditorialAssetsMaterializeCli(argv = process.argv.slice(2), dependencies = {}) {
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)
    || ![null, Object.prototype].includes(Object.getPrototypeOf(dependencies)) || Reflect.ownKeys(dependencies).some(key => {
      const d = Object.getOwnPropertyDescriptor(dependencies, key);
      return !["preview", "materialize"].includes(key) || !d.enumerable || !Object.hasOwn(d, "value") || typeof d.value !== "function";
    })) throw invalid();
  const parsed = parseEditorialAssetsMaterializeArguments(argv);
  if (parsed.mode === "preview") {
    const preview = dependencies.preview ?? (await import("../src/server/production/editorial-assets-materialize.mjs")).previewEditorialAssetsMaterialization;
    return {ok: true, mode: "preview", preview: await preview(parsed.request)};
  }
  const authority = createCapabilityAuthority({secret: randomBytes(32).toString("hex"),
    defaultTtlMs: 600000, maximumTtlMs: 600000, maximumCalls: 0, maximumCostUsd: 0});
  const sideEffectGrant = authority.authorize(editorialAssetsMaterializeCapabilitySpec(parsed.request));
  const materialize = dependencies.materialize ?? (await import("../src/server/production/editorial-assets-materialize.mjs")).materializeEditorialAssets;
  return {ok: true, mode: "materialized", result: await materialize(parsed.request, Object.freeze({sideEffectGrant}))};
}
export async function reportEditorialAssetsMaterializeCli(run = () => runEditorialAssetsMaterializeCli()) {
  try { console.log(JSON.stringify(await run(), null, 2)); }
  catch {
    console.error(JSON.stringify({ok: false, code: "editorial_materialization_cli_failed",
      message: "素材物化未确认完成；请核对当前批准、快照与资源完整性，勿盲目重试。"}));
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await reportEditorialAssetsMaterializeCli();
