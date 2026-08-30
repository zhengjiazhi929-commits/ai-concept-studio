import { createHash, timingSafeEqual } from "node:crypto";

export const OPERATOR_TOKEN_HEADER = "x-operator-token";

export class OperatorAuthorizationError extends Error {
  constructor(message, code = "operator_auth_forbidden", statusCode = 403) {
    super(message);
    this.name = "OperatorAuthorizationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function validActor(actor) {
  return Boolean(
    typeof actor === "string" &&
    actor.startsWith("human:") &&
    actor.length >= 7 &&
    actor.length <= 128 &&
    !/[\u0000-\u001f\u007f]/u.test(actor)
  );
}

function optionalEnvironmentValue(environment, name) {
  const value = environment?.[name];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function optionalNonNegativeNumber(environment, name, { integer = false } = {}) {
  const raw = optionalEnvironmentValue(environment, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isInteger(value))
  ) {
    throw new OperatorAuthorizationError(
      `服务端安全配置 ${name} 必须是非负${integer ? "整数" : "数值"}`,
      "operator_security_config_invalid",
      500
    );
  }
  return value;
}

export function operatorSecurityOptionsFromEnvironment(environment = process.env) {
  const operatorActor = optionalEnvironmentValue(
    environment,
    "AI_CONCEPT_STUDIO_OPERATOR_ACTOR"
  );
  const operatorToken = optionalEnvironmentValue(
    environment,
    "AI_CONCEPT_STUDIO_OPERATOR_TOKEN"
  );
  const capabilitySecret = optionalEnvironmentValue(
    environment,
    "AI_CONCEPT_STUDIO_CAPABILITY_SECRET"
  );
  const configured = [operatorActor, operatorToken, capabilitySecret]
    .filter(Boolean).length;
  if (configured > 0 && configured < 3) {
    throw new OperatorAuthorizationError(
      "服务端 operator 身份、token 与 Capability 密钥必须同时配置",
      "operator_security_config_incomplete",
      500
    );
  }
  if (
    configured === 3 &&
    (
      !validActor(operatorActor) ||
      operatorToken.length < 32 ||
      operatorToken.length > 512 ||
      capabilitySecret.length < 32 ||
      capabilitySecret.length > 512
    )
  ) {
    throw new OperatorAuthorizationError(
      "服务端 operator 安全配置格式无效",
      "operator_security_config_invalid",
      500
    );
  }

  const options = {};
  if (configured === 3) {
    options.operatorActor = operatorActor;
    options.operatorToken = operatorToken;
    options.capabilitySecret = capabilitySecret;
  }
  const capabilityMaximumCalls = optionalNonNegativeNumber(
    environment,
    "AI_CONCEPT_STUDIO_CAPABILITY_MAX_CALLS",
    { integer: true }
  );
  const capabilityMaximumCostUsd = optionalNonNegativeNumber(
    environment,
    "AI_CONCEPT_STUDIO_CAPABILITY_MAX_COST_USD"
  );
  const capabilityTtlMs = optionalNonNegativeNumber(
    environment,
    "AI_CONCEPT_STUDIO_CAPABILITY_TTL_MS",
    { integer: true }
  );
  const capabilityMaximumTtlMs = optionalNonNegativeNumber(
    environment,
    "AI_CONCEPT_STUDIO_CAPABILITY_MAXIMUM_TTL_MS",
    { integer: true }
  );
  const budgetReconciliationToken = optionalEnvironmentValue(
    environment,
    "AI_CONCEPT_STUDIO_BUDGET_RECONCILIATION_TOKEN"
  );
  if (capabilityMaximumCalls !== undefined) {
    options.capabilityMaximumCalls = capabilityMaximumCalls;
  }
  if (capabilityMaximumCostUsd !== undefined) {
    options.capabilityMaximumCostUsd = capabilityMaximumCostUsd;
  }
  if (capabilityTtlMs !== undefined) options.capabilityTtlMs = capabilityTtlMs;
  if (capabilityMaximumTtlMs !== undefined) {
    options.capabilityMaximumTtlMs = capabilityMaximumTtlMs;
  }
  if (budgetReconciliationToken !== undefined) {
    options.budgetReconciliationToken = budgetReconciliationToken;
  }
  return Object.freeze(options);
}

function secureTokenMatches(expected, supplied) {
  if (
    typeof expected !== "string" ||
    expected.length < 32 ||
    expected.length > 512 ||
    typeof supplied !== "string" ||
    supplied.length === 0 ||
    supplied.length > 1024
  ) return false;
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const suppliedDigest = createHash("sha256").update(supplied, "utf8").digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

export function authenticateOperatorRequest(request, options = {}) {
  const supplied = request?.headers?.[OPERATOR_TOKEN_HEADER];
  if (
    !validActor(options.actor) ||
    Array.isArray(supplied) ||
    !secureTokenMatches(options.operatorToken, supplied)
  ) {
    throw new OperatorAuthorizationError(
      "本地操作者入口未启用或授权无效",
      "operator_auth_forbidden",
      403
    );
  }
  return Object.freeze({ actor: options.actor });
}

export function assertClientDidNotSupplyActor(body) {
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.hasOwn(body, "actor")
  ) {
    throw new OperatorAuthorizationError(
      "客户端不能自报人工操作者身份",
      "operator_actor_client_forbidden",
      400
    );
  }
}
