import { readFile } from "node:fs/promises";
import { providerHealthStatePath } from "../../shared/paths.mjs";
import { writeVersionedJson } from "../../shared/versioned-json-store.mjs";

const VALID_STATES = new Set(["healthy", "degraded", "unavailable", "half-open"]);
let persistentManager = null;

function timestamp(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

export function classifyProviderError(error = {}) {
  const code = String(error.code ?? "").toLowerCase();
  if (error.status === 401 || code.includes("api_key") || code.includes("auth")) return "authentication";
  if (error.status === 403 || code.includes("permission")) return "permission";
  if (error.status === 429 || code.includes("rate")) return "rate-limit";
  if (code.includes("quota")) return "quota";
  if (error.name === "AbortError" || code.includes("timeout")) return "timeout";
  if (error.status >= 500) return "provider-server";
  if (!error.status) return "network";
  return "request";
}

function normalizeRecord(record = {}) {
  return {
    state: VALID_STATES.has(record.state) ? record.state : "healthy",
    consecutiveFailures: Number.isInteger(record.consecutiveFailures)
      ? Math.max(0, record.consecutiveFailures)
      : 0,
    cooldownUntil: typeof record.cooldownUntil === "string" ? record.cooldownUntil : null,
    lastLatencyMs: Number.isFinite(record.lastLatencyMs) ? Math.max(0, record.lastLatencyMs) : null,
    lastError: typeof record.lastError === "string" ? record.lastError : null,
    lastErrorClass: typeof record.lastErrorClass === "string" ? record.lastErrorClass : null,
    lastUpdatedAt: typeof record.lastUpdatedAt === "string" ? record.lastUpdatedAt : null,
    samples: Array.isArray(record.samples) ? record.samples.slice(-20) : []
  };
}

export function createProviderHealthManager(options = {}) {
  const records = Object.fromEntries(
    Object.entries(options.initial ?? {}).map(([id, record]) => [id, normalizeRecord(record)])
  );
  const failureThreshold = options.failureThreshold ?? 2;
  const baseCooldownMs = options.baseCooldownMs ?? 30000;
  const maximumCooldownMs = options.maximumCooldownMs ?? 300000;
  const persist = options.persist ?? (async () => undefined);
  const currentTime = () => options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());

  function snapshot(now = currentTime()) {
    const nowMs = now.getTime();
    return Object.fromEntries(Object.entries(records).map(([id, source]) => {
      const record = normalizeRecord(source);
      if (
        record.state === "unavailable" &&
        record.cooldownUntil &&
        Date.parse(record.cooldownUntil) <= nowMs
      ) {
        record.state = "half-open";
      }
      return [id, record];
    }));
  }

  async function save() {
    await persist(snapshot()).catch(() => undefined);
  }

  return {
    snapshot,
    async recordSuccess(providerId, details = {}) {
      const at = timestamp(details.now ?? currentTime());
      records[providerId] = {
        ...normalizeRecord(records[providerId]),
        state: "healthy",
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastLatencyMs: Number.isFinite(details.latencyMs) ? Math.max(0, details.latencyMs) : null,
        lastError: null,
        lastErrorClass: null,
        lastUpdatedAt: at,
        samples: [...(records[providerId]?.samples ?? []), { at, ok: true }].slice(-20)
      };
      await save();
      return normalizeRecord(records[providerId]);
    },
    async recordFailure(providerId, error, details = {}) {
      const previous = normalizeRecord(records[providerId]);
      const errorClass = classifyProviderError(error);
      const consecutiveFailures = previous.consecutiveFailures + 1;
      const immediateOpen = new Set(["authentication", "permission", "quota"]).has(errorClass);
      const unavailable = immediateOpen || consecutiveFailures >= failureThreshold;
      const cooldownMs = Math.min(
        maximumCooldownMs,
        baseCooldownMs * (2 ** Math.max(0, consecutiveFailures - failureThreshold))
      );
      const atDate = details.now instanceof Date ? details.now : currentTime();
      const at = timestamp(atDate);
      records[providerId] = {
        ...previous,
        state: unavailable ? "unavailable" : "degraded",
        consecutiveFailures,
        cooldownUntil: unavailable ? new Date(atDate.getTime() + cooldownMs).toISOString() : null,
        lastLatencyMs: Number.isFinite(details.latencyMs) ? Math.max(0, details.latencyMs) : null,
        lastError: typeof details.errorCode === "string" ? details.errorCode : errorClass,
        lastErrorClass: errorClass,
        lastUpdatedAt: at,
        samples: [...previous.samples, { at, ok: false, errorClass }].slice(-20)
      };
      await save();
      return normalizeRecord(records[providerId]);
    }
  };
}

async function readPersistentState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { stateVersion: 0, providers: {} };
    throw error;
  }
}

export async function loadPersistentProviderHealthManager(options = {}) {
  if (persistentManager && !options.path) return persistentManager;
  const path = options.path ?? providerHealthStatePath;
  const state = await readPersistentState(path);
  let stateVersion = Number.isInteger(state.stateVersion) ? state.stateVersion : 0;
  const manager = createProviderHealthManager({
    ...options,
    initial: state.providers,
    persist: async (providers) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const written = await writeVersionedJson(path, { stateVersion, providers }, {
            expectedVersion: stateVersion,
            getVersion: (value) => value?.stateVersion ?? 0,
            setVersion: (value, version) => {
              value.stateVersion = version;
            }
          });
          stateVersion = written.version;
          return;
        } catch (error) {
          if (error?.code !== "state_version_conflict" || attempt === 2) throw error;
          const latest = await readPersistentState(path);
          stateVersion = latest.stateVersion ?? 0;
          providers = { ...(latest.providers ?? {}), ...providers };
        }
      }
    }
  });
  if (!options.path) persistentManager = manager;
  return manager;
}

export function getCachedProviderHealthSnapshot() {
  return persistentManager?.snapshot() ?? {};
}
