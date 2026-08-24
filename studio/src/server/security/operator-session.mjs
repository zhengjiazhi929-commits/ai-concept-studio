import {
  createHash,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import {
  authenticateOperatorRequest,
  OPERATOR_TOKEN_HEADER,
  OperatorAuthorizationError
} from "./operator-auth.mjs";

export const OPERATOR_SESSION_COOKIE = "acs_operator_session";
export const OPERATOR_CSRF_COOKIE = "acs_operator_csrf";
export const OPERATOR_CSRF_HEADER = "x-operator-csrf";

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest();
}

function secretMatches(expectedDigest, supplied, maximumLength = 1024) {
  if (
    !Buffer.isBuffer(expectedDigest) ||
    typeof supplied !== "string" ||
    supplied.length === 0 ||
    supplied.length > maximumLength
  ) return false;
  return timingSafeEqual(expectedDigest, digest(supplied));
}

function parseCookies(header) {
  if (typeof header !== "string" || header.length > 16_384) return new Map();
  const values = new Map();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && value && !values.has(name)) values.set(name, value);
  }
  return values;
}

function sessionError(message, code = "operator_auth_forbidden") {
  return new OperatorAuthorizationError(message, code, 403);
}

function boundedPositiveInteger(value, fallback, maximum) {
  if (!Number.isInteger(value)) return fallback;
  if (value <= 0 || value > maximum) {
    throw new OperatorAuthorizationError(
      "operator session 有效期配置无效",
      "operator_security_config_invalid",
      500
    );
  }
  return value;
}

export function createOperatorSessionAuthority(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const sessionTtlMs = boundedPositiveInteger(
    options.sessionTtlMs,
    8 * 60 * 60_000,
    24 * 60 * 60_000
  );
  const unlockTtlMs = boundedPositiveInteger(
    options.unlockTtlMs,
    10 * 60_000,
    60 * 60_000
  );
  let operator = null;
  try {
    operator = authenticateOperatorRequest({
      headers: { [OPERATOR_TOKEN_HEADER]: options.operatorToken }
    }, {
      actor: options.actor,
      operatorToken: options.operatorToken
    });
  } catch {
    operator = null;
  }
  const startupAt = now();
  const startupUnlockCode = operator
    ? randomBytes(12).toString("base64url")
    : null;
  const unlockDigest = startupUnlockCode ? digest(startupUnlockCode) : null;
  let unlockConsumed = false;
  const sessions = new Map();

  function assertEnabled() {
    if (!operator || !Number.isFinite(startupAt)) {
      throw sessionError(
        "本地 operator session 未启用",
        "operator_session_disabled"
      );
    }
  }

  function cleanupExpired(timestamp) {
    for (const [key, session] of sessions) {
      if (timestamp >= session.expiresAtMs) sessions.delete(key);
    }
  }

  function authenticateUnlock(request, unlockCode) {
    const suppliedOperatorToken = request?.headers?.[OPERATOR_TOKEN_HEADER];
    if (suppliedOperatorToken !== undefined) {
      return authenticateOperatorRequest(request, {
        actor: operator.actor,
        operatorToken: options.operatorToken
      });
    }
    const current = now();
    if (
      unlockConsumed ||
      !Number.isFinite(current) ||
      current >= startupAt + unlockTtlMs ||
      !secretMatches(unlockDigest, unlockCode, 256)
    ) {
      throw sessionError(
        "operator 一次性解锁码无效、已使用或已过期",
        "operator_session_unlock_forbidden"
      );
    }
    unlockConsumed = true;
    return operator;
  }

  function createSession(request, input = {}) {
    assertEnabled();
    const authenticated = authenticateUnlock(request, input.unlockCode);
    const current = now();
    cleanupExpired(current);
    const sessionId = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const expiresAtMs = current + sessionTtlMs;
    sessions.set(digest(sessionId).toString("hex"), Object.freeze({
      actor: authenticated.actor,
      csrfDigest: digest(csrfToken),
      expiresAtMs
    }));
    const maximumAge = Math.max(1, Math.floor(sessionTtlMs / 1000));
    return Object.freeze({
      actor: authenticated.actor,
      csrfToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
      cookies: Object.freeze([
        `${OPERATOR_SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maximumAge}`,
        `${OPERATOR_CSRF_COOKIE}=${csrfToken}; SameSite=Strict; Path=/; Max-Age=${maximumAge}`
      ])
    });
  }

  function authenticateRequest(request) {
    if (!operator) {
      throw sessionError("缺少有效的 operator 认证");
    }
    const cookies = parseCookies(request?.headers?.cookie);
    const sessionId = cookies.get(OPERATOR_SESSION_COOKIE);
    if (!sessionId || sessionId.length > 256) {
      throw sessionError("缺少有效的 operator session");
    }
    const sessionKey = digest(sessionId).toString("hex");
    const session = sessions.get(sessionKey);
    if (!session) throw sessionError("operator session 无效或已经注销");
    const current = now();
    if (!Number.isFinite(current) || current >= session.expiresAtMs) {
      sessions.delete(sessionKey);
      throw sessionError("operator session 已过期", "operator_session_expired");
    }
    const suppliedCsrf = request?.headers?.[OPERATOR_CSRF_HEADER];
    if (
      Array.isArray(suppliedCsrf) ||
      !secretMatches(session.csrfDigest, suppliedCsrf, 256)
    ) {
      throw sessionError(
        "operator session 缺少有效 CSRF 绑定",
        "operator_session_csrf_forbidden"
      );
    }
    return Object.freeze({ actor: session.actor });
  }

  return Object.freeze({
    startupUnlockCode,
    createSession,
    authenticateRequest
  });
}
