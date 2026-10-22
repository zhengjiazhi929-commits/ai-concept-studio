import {randomBytes} from "node:crypto";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {validateEditorialAssetsPreparePreview, validateEditorialAssetsPrepareRequest,
  editorialAssetsPrepareCapabilitySpec} from "../src/shared/editorial-assets-prepare-request.mjs";
import {createCapabilityAuthority} from "../src/server/security/side-effect-capability.mjs";

const flags = new Map([["--episode", "episodeId"], ["--snapshot", "snapshotHash"], ["--plan-hash", "planHash"],
  ["--implementation-hash", "implementationHash"], ["--actor", "actor"], ["--reason", "reason"]]);
const invalid = () => Object.assign(new Error("编辑素材准备参数无效"), {code: "editorial_assets_arguments_invalid"});
export function parseEditorialAssetsArguments(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== "string")) throw invalid();
  const args = [...argv]; if (args[0] === "--") args.shift();
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--confirm-editorial-assets-preparation") {
      if (Object.hasOwn(values, "confirmEditorialAssetsPreparation")) throw invalid();
      values.confirmEditorialAssetsPreparation = true; continue;
    }
    const key = flags.get(flag); const value = args[++index];
    if (!key || Object.hasOwn(values, key) || !value?.trim() || value.startsWith("-") || /\p{Cc}/u.test(value)) throw invalid();
    values[key] = value;
  }
  if (Object.keys(values).length === 1) return Object.freeze({mode: "preview", request: Object.freeze(validateEditorialAssetsPreparePreview(values))});
  return Object.freeze({mode: "prepare", request: Object.freeze(validateEditorialAssetsPrepareRequest(values))});
}
export async function runEditorialAssetsCli(argv = process.argv.slice(2), dependencies = {}) {
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)
    || ![null, Object.prototype].includes(Object.getPrototypeOf(dependencies)) || Reflect.ownKeys(dependencies).some(key => {
      const d = Object.getOwnPropertyDescriptor(dependencies, key);
      return !["preview", "prepare"].includes(key) || !d.enumerable || !Object.hasOwn(d, "value") || typeof d.value !== "function";
    })) throw invalid();
  const parsed = parseEditorialAssetsArguments(argv);
  if (parsed.mode === "preview") {
    const preview = dependencies.preview ?? (await import("../src/server/production/editorial-assets-prepare.mjs")).previewEditorialAssetsPreparation;
    return {ok: true, mode: "preview", preview: await preview(parsed.request)};
  }
  const authority = createCapabilityAuthority({secret: randomBytes(32).toString("hex"),
    defaultTtlMs: 300000, maximumTtlMs: 300000, maximumCalls: 0, maximumCostUsd: 0});
  const sideEffectGrant = authority.authorize(editorialAssetsPrepareCapabilitySpec(parsed.request));
  const prepare = dependencies.prepare ?? (await import("../src/server/production/editorial-assets-prepare.mjs")).prepareEditorialAssets;
  return {ok: true, mode: "prepared", result: await prepare(parsed.request, Object.freeze({sideEffectGrant}))};
}
export async function reportEditorialAssetsCli(run = () => runEditorialAssetsCli()) {
  try { console.log(JSON.stringify(await run(), null, 2)); }
  catch {
    console.error(JSON.stringify({ok: false, code: "editorial_assets_cli_failed",
      message: "素材准备未确认完成；请核对当前分镜批准、快照、实现文件及显式确认。"}));
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await reportEditorialAssetsCli();
