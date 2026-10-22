import {randomBytes} from "node:crypto";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {validateEditorialVoiceRegisterPreview, validateEditorialVoiceRegisterRequest,
  editorialVoiceRegisterCapabilitySpec} from "../src/shared/editorial-voice-register-request.mjs";
import {createCapabilityAuthority} from "../src/server/security/side-effect-capability.mjs";

const flags = new Map([["--episode", "episodeId"], ["--candidate", "candidatePath"],
  ["--candidate-hash", "candidateSha256"], ["--snapshot", "snapshotHash"],
  ["--implementation-hash", "implementationHash"], ["--actor", "actor"], ["--reason", "reason"]]);
const invalid = () => Object.assign(new Error("本地旁白登记参数无效"), {code: "editorial_voice_registration_arguments_invalid"});

export function parseEditorialVoiceRegisterArguments(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== "string")) throw invalid();
  const args = [...argv];
  if (args[0] === "--") args.shift();
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--confirm-editorial-voice-registration") {
      if (Object.hasOwn(values, "confirmEditorialVoiceRegistration")) throw invalid();
      values.confirmEditorialVoiceRegistration = true;
      continue;
    }
    const key = flags.get(flag);
    const value = args[++index];
    if (!key || Object.hasOwn(values, key) || !value?.trim() || value.startsWith("-") || /\p{Cc}/u.test(value)) throw invalid();
    values[key] = value;
  }
  if (Object.keys(values).length === 2) {
    return Object.freeze({mode: "preview", request: Object.freeze(validateEditorialVoiceRegisterPreview(values))});
  }
  return Object.freeze({mode: "register", request: Object.freeze(validateEditorialVoiceRegisterRequest(values))});
}

export async function runEditorialVoiceRegisterCli(argv = process.argv.slice(2), dependencies = {}) {
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)
    || ![null, Object.prototype].includes(Object.getPrototypeOf(dependencies)) || Reflect.ownKeys(dependencies).some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
      return !["preview", "register"].includes(key) || !descriptor.enumerable
        || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "function";
    })) throw invalid();
  const parsed = parseEditorialVoiceRegisterArguments(argv);
  if (parsed.mode === "preview") {
    const preview = dependencies.preview
      ?? (await import("../src/server/production/editorial-voice.mjs")).previewEditorialVoiceRegistration;
    return {ok: true, mode: "preview", preview: await preview(parsed.request)};
  }
  const authority = createCapabilityAuthority({secret: randomBytes(32).toString("hex"),
    defaultTtlMs: 600000, maximumTtlMs: 600000, maximumCalls: 0, maximumCostUsd: 0});
  const sideEffectGrant = authority.authorize(editorialVoiceRegisterCapabilitySpec(parsed.request));
  const register = dependencies.register
    ?? (await import("../src/server/production/editorial-voice.mjs")).registerEditorialVoice;
  return {ok: true, mode: "registered", result: await register(parsed.request, Object.freeze({sideEffectGrant}))};
}

export async function reportEditorialVoiceRegisterCli(run = () => runEditorialVoiceRegisterCli()) {
  try { console.log(JSON.stringify(await run(), null, 2)); }
  catch {
    console.error(JSON.stringify({ok: false, code: "editorial_voice_registration_cli_failed",
      message: "旁白登记未确认完成；请核对候选、批准、快照与资源完整性，勿盲目重试。"}));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await reportEditorialVoiceRegisterCli();
