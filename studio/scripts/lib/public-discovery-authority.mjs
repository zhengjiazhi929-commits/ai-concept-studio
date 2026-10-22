import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { studioRoot } from "../../src/shared/paths.mjs";
import {
  authenticateOperatorRequest,
  OPERATOR_TOKEN_HEADER,
  operatorSecurityOptionsFromEnvironment
} from "../../src/server/security/operator-auth.mjs";
import { createCapabilityAuthority } from "../../src/server/security/side-effect-capability.mjs";

export const publicDiscoveryIdentityPath = resolve(
  studioRoot, ".local-public-discovery", "identity.json"
);

const operationScopes = Object.freeze({
  "collector:run": Object.freeze(["state.write", "filesystem.write", "network.request"]),
  "collector:import-assisted-batch": Object.freeze(["state.write", "filesystem.write"]),
  "trend:run": Object.freeze(["state.write", "filesystem.write"])
});
const identityFields = [
  "schemaVersion", "purpose", "actor", "capabilitySecret", "maxCalls", "maxCostUsd", "createdAt"
];

export function publicDiscoveryError(code, message) {
  return Object.assign(new Error(message), { code });
}

function unsafeIdentity() {
  return publicDiscoveryError(
    "public_discovery_identity_unsafe",
    "本地选题身份必须是当前用户拥有的私有目录和普通文件，禁止符号链接"
  );
}

// Refuse symlinks in every component, not just the final credential file.
async function assertNoSymlinkPath(target) {
  let current = resolve(target);
  while (true) {
    if ((await lstat(current)).isSymbolicLink()) throw unsafeIdentity();
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (await realpath(target) !== resolve(target)) throw unsafeIdentity();
}

function assertPrivateOwner(stat, mode, directory = false) {
  if (
    typeof process.getuid !== "function" || stat.uid !== process.getuid() ||
    (stat.mode & 0o7777) !== mode ||
    (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
  ) throw unsafeIdentity();
}

async function assertIdentityDirectory(directory) {
  await assertNoSymlinkPath(directory);
  const stat = await lstat(directory);
  assertPrivateOwner(stat, 0o700, true);
  return stat;
}

function authenticatedActor(actor, token) {
  return authenticateOperatorRequest({
    headers: { [OPERATOR_TOKEN_HEADER]: token }
  }, { actor, operatorToken: token }).actor;
}

function assertZeroBudget(calls, cost) {
  if (calls !== 0 || cost !== 0) {
    throw publicDiscoveryError(
      "public_discovery_paid_budget_forbidden",
      "本地公开选题只允许 maxCalls=0、maxCostUsd=0"
    );
  }
}

function validateIdentity(document) {
  if (
    !document || typeof document !== "object" || Array.isArray(document) ||
    Object.keys(document).some((key) => !identityFields.includes(key)) ||
    document.schemaVersion !== 1 || document.purpose !== "public-topic-discovery" ||
    typeof document.capabilitySecret !== "string" ||
    !/^[a-f0-9]{64}$/u.test(document.capabilitySecret) ||
    !Number.isFinite(Date.parse(document.createdAt ?? ""))
  ) {
    throw publicDiscoveryError("public_discovery_identity_invalid", "本地选题身份格式无效");
  }
  assertZeroBudget(document.maxCalls, document.maxCostUsd);
  authenticatedActor(document.actor, document.capabilitySecret);
  return document;
}

async function readIdentity(configPath) {
  let handle;
  try {
    const parent = await assertIdentityDirectory(dirname(configPath));
    await assertNoSymlinkPath(configPath);
    handle = await open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    assertPrivateOwner(stat, 0o600);
    if (stat.size > 16_384) throw unsafeIdentity();
    const currentParent = await assertIdentityDirectory(dirname(configPath));
    if (parent.ino !== currentParent.ino || parent.dev !== currentParent.dev) throw unsafeIdentity();
    let document;
    try {
      document = JSON.parse(await handle.readFile("utf8"));
    } catch {
      throw publicDiscoveryError("public_discovery_identity_invalid", "本地选题身份格式无效");
    }
    return validateIdentity(document);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw publicDiscoveryError(
        "public_discovery_identity_missing",
        "缺少本地选题身份；请先显式运行 setup --actor human:Zhengjiazhi --confirm-public-discovery"
      );
    }
    if (["ELOOP", "EACCES", "ENOTDIR"].includes(error.code)) throw unsafeIdentity();
    throw error;
  } finally {
    await handle?.close();
  }
}

/** User-invoked local initialization. This never configures an HTTP operator. */
export async function setupPublicDiscoveryIdentity({ actor, confirmPublicDiscovery, configPath } = {}) {
  if (confirmPublicDiscovery !== true) {
    throw publicDiscoveryError(
      "public_discovery_confirmation_required", "必须显式确认仅免费公开采集和本地存储"
    );
  }
  const capabilitySecret = randomBytes(32).toString("hex");
  authenticatedActor(actor, capabilitySecret);
  const path = resolve(configPath ?? publicDiscoveryIdentityPath);
  const directory = dirname(path);
  await assertNoSymlinkPath(dirname(directory));
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const parent = await assertIdentityDirectory(directory);
  let handle;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    assertPrivateOwner(await handle.stat(), 0o600);
    const currentParent = await assertIdentityDirectory(directory);
    if (parent.ino !== currentParent.ino || parent.dev !== currentParent.dev) throw unsafeIdentity();
    await handle.writeFile(`${JSON.stringify({
      schemaVersion: 1,
      purpose: "public-topic-discovery",
      actor,
      capabilitySecret,
      maxCalls: 0,
      maxCostUsd: 0,
      createdAt: new Date().toISOString()
    }, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    if (error.code === "EEXIST") {
      throw publicDiscoveryError(
        "public_discovery_identity_exists", "本地选题身份已存在，拒绝覆盖或替换"
      );
    }
    if (error.code === "ELOOP") throw unsafeIdentity();
    throw error;
  } finally {
    await handle?.close();
  }
  return Object.freeze({ ok: true, actor, identityPath: path, maxCalls: 0, maxCostUsd: 0 });
}

export async function loadPublicDiscoveryAuthorization({ environment = process.env, configPath } = {}) {
  // Partial operator configuration fails closed; it must never fall back to a file.
  const security = operatorSecurityOptionsFromEnvironment(environment);
  assertZeroBudget(security.capabilityMaximumCalls ?? 0, security.capabilityMaximumCostUsd ?? 0);
  const configured = Boolean(security.operatorActor);
  const identity = configured ? {
    actor: authenticatedActor(security.operatorActor, security.operatorToken),
    capabilitySecret: security.capabilitySecret
  } : await readIdentity(resolve(configPath ?? publicDiscoveryIdentityPath));
  const actor = identity.actor;
  // The signed subject binds the authenticated actor without granting access to a production Episode.
  const episodeId = `public-discovery/${createHash("sha256").update(actor).digest("hex").slice(0, 32)}`;
  const authority = createCapabilityAuthority({
    secret: identity.capabilitySecret,
    maximumCalls: 0,
    maximumCostUsd: 0,
    defaultTtlMs: 5 * 60_000,
    maximumTtlMs: 5 * 60_000
  });
  return Object.freeze({
    actor,
    source: configured ? "operator-environment" : "local-public-discovery",
    forOperation(operation) {
      if (typeof operation !== "string" || !Object.hasOwn(operationScopes, operation) || arguments.length !== 1) {
        throw publicDiscoveryError("public_discovery_operation_forbidden", "本地选题授权不允许该操作或权限覆盖");
      }
      const spec = { episodeId, operation, scopes: operationScopes[operation], maxCalls: 0, maxCostUsd: 0 };
      const sideEffectGrant = authority.authorize(spec);
      return Object.freeze({ actor, episodeId, capabilityOperation: operation, requireSideEffectCapability: true, sideEffectGrant });
    }
  });
}
