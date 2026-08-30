import {
  createHmac,
  randomUUID,
  timingSafeEqual
} from "node:crypto";

const CAPABILITY_VERSION = "side-effect-capability-v1";
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,159}$/u;
const grantMetadata = new WeakMap();

export class SideEffectAuthorizationError extends Error {
  constructor(message, code, details = {}, statusCode = 403) {
    super(message);
    this.name = "SideEffectAuthorizationError";
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

function authorizationError(message, code, details = {}) {
  return new SideEffectAuthorizationError(message, code, details, 403);
}

function validSecret(secret) {
  return typeof secret === "string" && secret.length >= 32 && secret.length <= 512;
}

function normalizedIdentifier(value, field) {
  const normalized = String(value ?? "").trim();
  if (!identifierPattern.test(normalized)) {
    throw authorizationError(
      `Capability ${field} 无效`,
      "side_effect_capability_invalid"
    );
  }
  return normalized;
}

function normalizedScopes(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw authorizationError(
      "Capability 必须声明至少一个副作用范围",
      "side_effect_capability_invalid"
    );
  }
  const scopes = [...new Set(value.map((scope) => normalizedIdentifier(scope, "scope")))].sort();
  if (scopes.length > 32) {
    throw authorizationError(
      "Capability 副作用范围过多",
      "side_effect_capability_invalid"
    );
  }
  return scopes;
}

function normalizedCalls(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw authorizationError(
      "Capability 调用上限必须是非负整数",
      "side_effect_capability_invalid"
    );
  }
  return value;
}

function normalizedCost(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw authorizationError(
      "Capability 费用上限必须是已知非负数",
      "side_effect_capability_invalid"
    );
  }
  return Number(value.toFixed(6));
}

function normalizedUsage(usage = {}) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    throw authorizationError(
      "Capability 用量必须是对象",
      "side_effect_capability_invalid"
    );
  }
  return {
    calls: normalizedCalls(usage.calls),
    costUsd: normalizedCost(usage.costUsd)
  };
}

function normalizedSpec(spec = {}) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw authorizationError(
      "Capability 声明必须是对象",
      "side_effect_capability_invalid"
    );
  }
  return {
    episodeId: normalizedIdentifier(spec.episodeId, "episodeId"),
    operation: normalizedIdentifier(spec.operation, "operation"),
    scopes: normalizedScopes(spec.scopes),
    maxCalls: normalizedCalls(spec.maxCalls),
    maxCostUsd: normalizedCost(spec.maxCostUsd)
  };
}

function immutableSpec(spec) {
  return Object.freeze({
    ...spec,
    scopes: Object.freeze([...spec.scopes])
  });
}

function signatureFor(secret, claims) {
  return createHmac("sha256", secret)
    .update(JSON.stringify(claims), "utf8")
    .digest("base64url");
}

function signaturesMatch(expected, supplied) {
  if (typeof supplied !== "string" || supplied.length > 256) return false;
  const expectedDigest = Buffer.from(expected, "utf8");
  const suppliedDigest = Buffer.from(supplied, "utf8");
  return expectedDigest.length === suppliedDigest.length
    && timingSafeEqual(expectedDigest, suppliedDigest);
}

function assertExpectedClaims(claims, expected) {
  if (claims.episodeId !== expected.episodeId) {
    throw authorizationError(
      "Capability 不属于当前 Episode",
      "side_effect_capability_episode_mismatch"
    );
  }
  if (claims.operation !== expected.operation) {
    throw authorizationError(
      "Capability 不属于当前操作",
      "side_effect_capability_operation_mismatch"
    );
  }
  const grantedScopes = new Set(claims.scopes);
  if (expected.scopes.some((scope) => !grantedScopes.has(scope))) {
    throw authorizationError(
      "Capability 没有覆盖当前副作用范围",
      "side_effect_capability_scope_mismatch"
    );
  }
  if (expected.maxCalls > claims.maxCalls) {
    throw authorizationError(
      "Capability 调用次数不足",
      "side_effect_capability_calls_exceeded"
    );
  }
  if (expected.maxCostUsd > claims.maxCostUsd) {
    throw authorizationError(
      "Capability 费用上限不足",
      "side_effect_capability_cost_exceeded"
    );
  }
}

export function createCapabilityAuthority(options = {}) {
  const secret = options.secret;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const defaultTtlMs = Number.isInteger(options.defaultTtlMs)
    ? options.defaultTtlMs
    : 30_000;
  const maximumTtlMs = Number.isInteger(options.maximumTtlMs)
    ? options.maximumTtlMs
    : 5 * 60_000;
  const maximumCalls = Number.isInteger(options.maximumCalls)
    ? Math.max(0, options.maximumCalls)
    : 0;
  const maximumCostUsd = Number.isFinite(options.maximumCostUsd)
    ? Math.max(0, Number(options.maximumCostUsd.toFixed(6)))
    : 0;
  const consumedNonces = new Set();

  function assertEnabled() {
    if (!validSecret(secret)) {
      throw authorizationError(
        "服务端副作用 Capability authority 未启用",
        "side_effect_capability_disabled"
      );
    }
  }

  function issue(spec = {}) {
    assertEnabled();
    const normalized = normalizedSpec(spec);
    if (normalized.maxCalls > maximumCalls) {
      throw authorizationError(
        "服务端策略不允许签发这么多调用",
        "side_effect_capability_policy_calls_exceeded"
      );
    }
    if (normalized.maxCostUsd > maximumCostUsd) {
      throw authorizationError(
        "服务端策略不允许签发这么高的费用",
        "side_effect_capability_policy_cost_exceeded"
      );
    }
    const ttlMs = Number.isInteger(spec.ttlMs) ? spec.ttlMs : defaultTtlMs;
    if (ttlMs <= 0 || ttlMs > maximumTtlMs) {
      throw authorizationError(
        "Capability 有效期超出服务端策略",
        "side_effect_capability_ttl_invalid"
      );
    }
    const issuedAtMs = now();
    if (!Number.isFinite(issuedAtMs)) {
      throw authorizationError(
        "Capability 服务端时钟无效",
        "side_effect_capability_clock_invalid"
      );
    }
    const claims = Object.freeze({
      version: CAPABILITY_VERSION,
      nonce: randomUUID(),
      ...immutableSpec(normalized),
      scopes: Object.freeze([...normalized.scopes]),
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(issuedAtMs + ttlMs).toISOString()
    });
    return Object.freeze({
      version: CAPABILITY_VERSION,
      claims,
      signature: signatureFor(secret, claims)
    });
  }

  function consume(token, expectedSpec = {}) {
    assertEnabled();
    const expected = normalizedSpec(expectedSpec);
    if (
      !token ||
      typeof token !== "object" ||
      Array.isArray(token) ||
      token.version !== CAPABILITY_VERSION ||
      !token.claims ||
      typeof token.claims !== "object" ||
      token.claims.version !== CAPABILITY_VERSION
    ) {
      throw authorizationError(
        "Capability 格式或版本无效",
        "side_effect_capability_invalid"
      );
    }
    const expectedSignature = signatureFor(secret, token.claims);
    if (!signaturesMatch(expectedSignature, token.signature)) {
      throw authorizationError(
        "Capability 签名无效",
        "side_effect_capability_signature_invalid"
      );
    }
    const issuedAtMs = Date.parse(token.claims.issuedAt ?? "");
    const expiresAtMs = Date.parse(token.claims.expiresAt ?? "");
    const nowMs = now();
    if (
      !Number.isFinite(issuedAtMs) ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= issuedAtMs ||
      issuedAtMs > nowMs + 5_000
    ) {
      throw authorizationError(
        "Capability 时间绑定无效",
        "side_effect_capability_invalid"
      );
    }
    if (nowMs >= expiresAtMs) {
      throw authorizationError(
        "Capability 已过期",
        "side_effect_capability_expired"
      );
    }
    const nonce = normalizedIdentifier(token.claims.nonce, "nonce");
    if (consumedNonces.has(nonce)) {
      throw authorizationError(
        "Capability 已使用，禁止重放",
        "side_effect_capability_replayed"
      );
    }
    consumedNonces.add(nonce);
    const signedClaims = immutableSpec(normalizedSpec(token.claims));
    assertExpectedClaims(signedClaims, expected);
    const grant = Object.freeze({
      ...signedClaims,
      scopes: signedClaims.scopes,
      nonce,
      issuedAt: token.claims.issuedAt,
      expiresAt: token.claims.expiresAt
    });
    const canonicalClaims = Object.freeze({
      ...signedClaims,
      scopes: signedClaims.scopes,
      nonce,
      issuedAt: token.claims.issuedAt,
      expiresAt: token.claims.expiresAt
    });
    grantMetadata.set(grant, {
      now,
      claims: canonicalClaims,
      usage: {
        usedCalls: 0,
        usedCostUsd: 0
      }
    });
    return grant;
  }

  function authorize(spec = {}) {
    const token = issue(spec);
    return consume(token, spec);
  }

  return Object.freeze({ issue, consume, authorize });
}

export function assertSideEffectGrant(grant, expectedSpec = {}) {
  const metadata = grant && typeof grant === "object"
    ? grantMetadata.get(grant)
    : null;
  if (!metadata) {
    throw authorizationError(
      "缺少服务端签发的副作用 Capability",
      "side_effect_capability_missing"
    );
  }
  const canonicalClaims = metadata.claims;
  const expiresAtMs = Date.parse(canonicalClaims.expiresAt ?? "");
  if (!Number.isFinite(expiresAtMs) || metadata.now() >= expiresAtMs) {
    throw authorizationError(
      "副作用 Capability 已过期",
      "side_effect_capability_expired"
    );
  }
  const expected = normalizedSpec(expectedSpec);
  assertExpectedClaims(canonicalClaims, expected);
  return grant;
}

/**
 * Atomically consumes a bounded amount from an already verified in-process grant.
 *
 * This function is intentionally synchronous: callers must invoke it immediately
 * before the side effect is marked as dispatched. A failed check never mutates the
 * recorded usage, while a successful check updates calls and cost together.
 */
export function consumeSideEffectGrantUsage(
  grant,
  expectedSpec = {},
  requestedUsage = {}
) {
  assertSideEffectGrant(grant, expectedSpec);
  const metadata = grantMetadata.get(grant);
  const requested = normalizedUsage(requestedUsage);
  const current = metadata.usage;
  const nextCalls = current.usedCalls + requested.calls;
  const nextCostUsd = Number((current.usedCostUsd + requested.costUsd).toFixed(6));
  if (nextCalls > metadata.claims.maxCalls) {
    throw authorizationError(
      "Capability 调用次数额度不足",
      "side_effect_capability_calls_exceeded",
      {
        maxCalls: metadata.claims.maxCalls,
        usedCalls: current.usedCalls,
        requestedCalls: requested.calls,
        remainingCalls: Math.max(0, metadata.claims.maxCalls - current.usedCalls)
      }
    );
  }
  if (nextCostUsd > metadata.claims.maxCostUsd) {
    throw authorizationError(
      "Capability 费用额度不足",
      "side_effect_capability_cost_exceeded",
      {
        maxCostUsd: metadata.claims.maxCostUsd,
        usedCostUsd: current.usedCostUsd,
        requestedCostUsd: requested.costUsd,
        remainingCostUsd: Number(Math.max(
          0,
          metadata.claims.maxCostUsd - current.usedCostUsd
        ).toFixed(6))
      }
    );
  }
  metadata.usage = {
    usedCalls: nextCalls,
    usedCostUsd: nextCostUsd
  };
  return Object.freeze({
    usedCalls: nextCalls,
    usedCostUsd: nextCostUsd,
    remainingCalls: metadata.claims.maxCalls - nextCalls,
    remainingCostUsd: Number((metadata.claims.maxCostUsd - nextCostUsd).toFixed(6))
  });
}

export function requireSideEffectGrant(options = {}, spec = {}) {
  if (options.sideEffectGrant) {
    return assertSideEffectGrant(options.sideEffectGrant, spec);
  }
  if (typeof options.authorizeSideEffect === "function") {
    return assertSideEffectGrant(options.authorizeSideEffect(spec), spec);
  }
  throw authorizationError(
    "缺少服务端签发的副作用 Capability",
    "side_effect_capability_missing"
  );
}
