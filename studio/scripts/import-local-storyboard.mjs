import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localStoryboardCapabilitySpec, validateLocalStoryboardPreview, validateLocalStoryboardRequest }
  from "../src/shared/local-storyboard-import-request.mjs";
import { createCapabilityAuthority } from "../src/server/security/side-effect-capability.mjs";

const flags = new Map([["--episode", "episodeId"], ["--candidate", "candidatePath"],
  ["--candidate-sha256", "candidateSha256"], ["--snapshot", "snapshotHash"],
  ["--actor", "actor"], ["--reason", "reason"]]);
function invalid() {
  return Object.assign(new Error("本地分镜入库参数无效"), { code: "local_storyboard_arguments_invalid" });
}

export function parseLocalStoryboardArguments(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== "string")) throw invalid();
  const args = [...argv];
  if (args[0] === "--") args.shift();
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--confirm-local-storyboard-import") {
      if (Object.hasOwn(values, "confirmLocalStoryboardImport")) throw invalid();
      values.confirmLocalStoryboardImport = true;
      continue;
    }
    const key = flags.get(flag);
    const value = args[++index];
    if (!key || Object.hasOwn(values, key) || !value || !value.trim() || value.startsWith("-") || /\p{Cc}/u.test(value)) throw invalid();
    values[key] = value;
  }
  if (Object.keys(values).length === 2) {
    return Object.freeze({ mode: "preview", request: Object.freeze(validateLocalStoryboardPreview(values)) });
  }
  return Object.freeze({ mode: "import", request: Object.freeze(validateLocalStoryboardRequest(values)) });
}

export async function runLocalStoryboardCli(argv = process.argv.slice(2), dependencies = {}) {
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(dependencies)) ||
    Reflect.ownKeys(dependencies).some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
      return !["preview", "import"].includes(key) || !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "function";
    })) throw invalid();
  const parsed = parseLocalStoryboardArguments(argv);
  if (parsed.mode === "preview") {
    const preview = dependencies.preview ?? (await import("../src/server/production/local-storyboard-import.mjs")).previewLocalStoryboard;
    return { ok: true, mode: "preview", preview: await preview(parsed.request) };
  }
  const authority = createCapabilityAuthority({ secret: randomBytes(32).toString("hex"),
    defaultTtlMs: 300_000, maximumTtlMs: 300_000, maximumCalls: 0, maximumCostUsd: 0 });
  const sideEffectGrant = authority.authorize(localStoryboardCapabilitySpec(parsed.request));
  const importStoryboard = dependencies.import ?? (await import("../src/server/production/local-storyboard-import.mjs")).importLocalStoryboard;
  return { ok: true, mode: "imported", result: await importStoryboard(parsed.request, Object.freeze({ sideEffectGrant })) };
}

// A fixed error response intentionally excludes candidate paths/content and any
// nested filesystem/provider messages. Detailed local errors remain in-process.
export async function reportLocalStoryboardCli(run = () => runLocalStoryboardCli()) {
  try { console.log(JSON.stringify(await run(), null, 2)); }
  catch {
    console.error(JSON.stringify({ ok: false, code: "local_storyboard_cli_failed",
      message: "本地分镜入库未完成；请核对候选文件、当前脚本批准与显式确认快照。" }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await reportLocalStoryboardCli();
