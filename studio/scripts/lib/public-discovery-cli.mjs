import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectorInboxRoot, resolveExistingPathInside } from "../../src/shared/paths.mjs";
import { publicDiscoveryError } from "./public-discovery-authority.mjs";

function invalidArguments() {
  return publicDiscoveryError("public_discovery_arguments_invalid", "参数无效：拒绝未知、重复或缺值参数");
}

export function parsePublicDiscoveryArguments(argv, { setup = false, batch = false } = {}) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== "string")) throw invalidArguments();
  const args = [...argv];
  if (args[0] === "--") args.shift();
  if (setup && args.shift() !== "setup") throw invalidArguments();
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const valueKey = argument === "--identity" ? "configPath"
      : setup && argument === "--actor" ? "actor" : null;
    if (valueKey) {
      const value = args[++index];
      if (Object.hasOwn(parsed, valueKey) || !value || value.startsWith("-") || value.includes("\0")) throw invalidArguments();
      parsed[valueKey] = value;
    } else if (setup && argument === "--confirm-public-discovery") {
      if (parsed.confirmPublicDiscovery) throw invalidArguments();
      parsed.confirmPublicDiscovery = true;
    } else if (batch && argument === "--legacy-import") {
      if (parsed.legacyImport) throw invalidArguments();
      parsed.legacyImport = true;
    } else if (batch && !argument.startsWith("-") && !parsed.batchName) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/u.test(argument)) throw invalidArguments();
      parsed.batchName = argument;
    } else {
      throw invalidArguments();
    }
  }
  if (setup && (!parsed.actor || !parsed.confirmPublicDiscovery)) throw invalidArguments();
  if (batch && !parsed.batchName) throw invalidArguments();
  return parsed;
}

export async function readPublicDiscoveryBatch(batchName, { inboxRoot = collectorInboxRoot, legacyImport = false } = {}) {
  // Keep containment checks here too: the helper is also callable by another CLI.
  const parsed = parsePublicDiscoveryArguments([batchName], { batch: true });
  let handle;
  try {
    if (await realpath(inboxRoot) !== resolve(inboxRoot)) {
      throw publicDiscoveryError("public_discovery_batch_unsafe", "批次收件箱路径不能包含符号链接");
    }
    const path = await resolveExistingPathInside(inboxRoot, resolve(inboxRoot, parsed.batchName));
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) {
      throw publicDiscoveryError("public_discovery_batch_invalid", "批次必须是最多4MiB的普通JSON文件");
    }
    let document;
    try {
      document = JSON.parse(await handle.readFile("utf8"));
    } catch {
      throw publicDiscoveryError("public_discovery_batch_invalid", "批次JSON无效");
    }
    const expectedVersion = legacyImport ? 1 : 2;
    if (document?.schemaVersion !== expectedVersion) {
      throw publicDiscoveryError("public_discovery_batch_version", legacyImport
        ? "--legacy-import只接受v1历史批次，不视为近期发现证据"
        : "近期发现只接受v2批次；历史v1兼容导入须显式使用--legacy-import");
    }
    if (!legacyImport && !(
      (Array.isArray(document.observations) && document.observations.length > 0) ||
      (Array.isArray(document.sourceChecks) && document.sourceChecks.length > 0)
    )) {
      throw publicDiscoveryError("public_discovery_batch_empty", "v2批次必须包含观察或来源检查记录");
    }
    return document;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw publicDiscoveryError("public_discovery_batch_missing", "收件箱中不存在指定批次文件");
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export function isDirectPublicDiscoveryCli(moduleUrl) {
  return Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(moduleUrl));
}

export async function reportPublicDiscoveryCli(run) {
  try {
    console.log(JSON.stringify(await run(), null, 2));
  } catch (error) {
    // No stack, raw provider errors, input JSON, tokens, or credential file content.
    const code = typeof error?.code === "string" && /^[a-z_]{1,80}$/u.test(error.code)
      ? error.code : "public_discovery_failed";
    console.error(JSON.stringify({ ok: false, code, message: "本地选题未完成；请检查身份配置、参数和已记录的来源状态" }));
    process.exitCode = 1;
  }
}
