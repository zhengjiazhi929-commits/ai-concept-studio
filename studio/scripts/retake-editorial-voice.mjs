import {randomBytes} from "node:crypto";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {previewEditorialVoiceRetake, retakeEditorialVoice} from "../src/server/production/editorial-voice-retake.mjs";
import {createCapabilityAuthority} from "../src/server/security/side-effect-capability.mjs";
import {validateEditorialVoiceRetakePreview, validateEditorialVoiceRetakeRequest,
  editorialVoiceRetakeCapabilitySpec} from "../src/shared/editorial-voice-retake-request.mjs";

export function parseEditorialVoiceRetakeArguments(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== "string")) throw new TypeError("Invalid arguments");
  const flags = new Map([["--episode", "episodeId"], ["--base-candidate", "baseCandidatePath"],
    ["--base-hash", "baseCandidateSha256"], ["--repair-plan", "repairPlanPath"], ["--repair-hash", "repairPlanSha256"],
    ["--snapshot", "snapshotHash"], ["--implementation-hash", "implementationHash"], ["--source-hash", "sourceHash"],
    ["--actor", "actor"], ["--reason", "reason"]]);
  const value = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--confirm-local-retake") {
      if (Object.hasOwn(value, "confirmEditorialVoiceRetake")) throw new TypeError("Duplicate confirmation");
      value.confirmEditorialVoiceRetake = true; continue;
    }
    const key = flags.get(flag); const argument = argv[++index];
    if (!key || Object.hasOwn(value, key) || !argument || argument.startsWith("-") || /\p{Cc}/u.test(argument)) {
      throw new TypeError("Invalid arguments");
    }
    value[key] = argument;
  }
  return value.confirmEditorialVoiceRetake
    ? {mode: "retake", request: Object.freeze(validateEditorialVoiceRetakeRequest(value))}
    : {mode: "preview", request: Object.freeze(validateEditorialVoiceRetakePreview(value))};
}

export async function runEditorialVoiceRetakeCli(argv = process.argv.slice(2), dependencies = {}) {
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)
    || ![null, Object.prototype].includes(Object.getPrototypeOf(dependencies))
    || Reflect.ownKeys(dependencies).some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
      return !["preview", "retake"].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")
        || typeof descriptor.value !== "function";
    })) throw new TypeError("Invalid CLI dependencies");
  const parsed = parseEditorialVoiceRetakeArguments(argv);
  if (parsed.mode === "preview") return {ok: true, mode: "preview",
    result: await (dependencies.preview ?? previewEditorialVoiceRetake)(parsed.request)};
  const authority = createCapabilityAuthority({secret: randomBytes(32).toString("hex"), defaultTtlMs: 2100000,
    maximumTtlMs: 2100000, maximumCalls: 0, maximumCostUsd: 0});
  const sideEffectGrant = authority.authorize(editorialVoiceRetakeCapabilitySpec(parsed.request));
  return {ok: true, mode: "retake", result: await (dependencies.retake ?? retakeEditorialVoice)(parsed.request,
    Object.freeze({sideEffectGrant}))};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await runEditorialVoiceRetakeCli(), null, 2));}
  catch (error) {
    console.error(JSON.stringify({ok: false, code: error.code ?? "editorial_voice_retake_failed",
      message: "局部旁白候选未确认完成；保留原候选和当前产物，核对来源与日志，勿覆盖重试。"}));
    process.exitCode = 1;
  }
}
