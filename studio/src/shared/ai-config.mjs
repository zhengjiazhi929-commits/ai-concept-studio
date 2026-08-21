import { readFile, rename, writeFile } from "node:fs/promises";
import { aiConfigPath, aiLocalConfigPath } from "./paths.mjs";
import { loadLocalEnvironment } from "./env.mjs";
import { assertVersionedConfig } from "./config-integrity.mjs";

async function readJsonOr(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function readAiConfig() {
  await loadLocalEnvironment();
  const base = JSON.parse(await readFile(aiConfigPath, "utf8"));
  assertVersionedConfig("ai-config", base);
  const local = await readJsonOr(aiLocalConfigPath, {});
  const requestedPrimary = process.env.AI_PRIMARY_PROVIDER || local.primaryProvider || base.primaryProvider;
  const providerOrder = [base.primaryProvider, ...(base.fallbackProviders ?? [])];
  const primaryProvider = base.providers?.[requestedPrimary] ? requestedPrimary : base.primaryProvider;
  const config = {
    ...base,
    primaryProvider,
    fallbackProviders: providerOrder.filter(
      (providerId, index) => providerId !== primaryProvider && providerOrder.indexOf(providerId) === index
    )
  };
  if (!config.providers?.[config.primaryProvider]) {
    throw new Error("AI 主通道配置不存在");
  }
  return config;
}

export async function setPrimaryProvider(providerId) {
  const base = JSON.parse(await readFile(aiConfigPath, "utf8"));
  assertVersionedConfig("ai-config", base);
  if (!base.providers?.[providerId] || base.providers[providerId].enabled === false) {
    throw new Error(`不能切换到未知或停用的 AI 通道：${providerId}`);
  }
  const temporary = `${aiLocalConfigPath}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ primaryProvider: providerId, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
  await rename(temporary, aiLocalConfigPath);
  return getAiStatus();
}

export function providerStatus(config, environment = process.env) {
  return Object.entries(config.providers).map(([id, provider]) => ({
    id,
    label: provider.label,
    enabled: provider.enabled !== false,
    configured: Boolean(environment[provider.apiKeyEnv]),
    baseUrl: provider.baseUrl,
    primary: id === config.primaryProvider
  }));
}

export async function getAiStatus() {
  await loadLocalEnvironment();
  const config = await readAiConfig();
  return {
    primaryProvider: config.primaryProvider,
    fallbacks: config.fallbackProviders,
    tasks: Object.fromEntries(
      Object.entries(config.tasks).map(([id, task]) => [id, {
        model: task.model,
        profile: task.profile ?? null
      }])
    ),
    providers: providerStatus(config)
  };
}
