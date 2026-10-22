function forbidden(code, message) {
  throw Object.assign(new Error(message), { code, statusCode: 403 });
}

function localAuthority(authority, port) {
  if (typeof authority !== "string") return false;
  // Do not let URL's IPv4 shorthand, credentials or trailing-dot normalization
  // enlarge the set of names that may reach this private loopback service.
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?$/iu.exec(authority);
  return Boolean(match && Number(match[2] ?? 80) === port && port > 0 && port <= 65535);
}

function boundPort(request, config) {
  return request.socket?.localPort ?? config.port;
}

export function assertLocalRequestOrigin(request, config, { required = false } = {}) {
  const origin = request.headers.origin;
  if (request.headers["sec-fetch-site"] === "cross-site") {
    forbidden("forbidden_origin", "跨站页面不能访问本地控制台");
  }
  if (origin === undefined) {
    if (!required) return;
    forbidden("forbidden_origin", "operator session 解锁必须来自本地控制台页面");
  }
  // An Origin is a serialized HTTP origin, not an arbitrary URL or "null".
  if (typeof origin !== "string" || !origin.startsWith("http://") ||
    !localAuthority(origin.slice("http://".length), boundPort(request, config))) {
    forbidden("forbidden_origin", "请求来源不属于本地控制台");
  }
}

export function assertLocalRequestBoundary(request, config) {
  if (!localAuthority(request.headers.host, boundPort(request, config))) {
    forbidden("forbidden_host", "请求地址不属于本地控制台");
  }
  // Apply to reads and media as well as mutations. Loopback binding alone does
  // not stop a foreign hostname that resolves/rebinds to the loopback address.
  assertLocalRequestOrigin(request, config);
}
