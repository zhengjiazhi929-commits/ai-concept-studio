import { execFile } from "node:child_process";
import { lookup as dnsLookup } from "node:dns";
import { lookup as dnsLookupPromise } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { promisify } from "node:util";
import { Agent, fetch as undiciFetch } from "undici";

const execFileAsync = promisify(execFile);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const forbiddenAddresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
]) {
  forbiddenAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
]) {
  forbiddenAddresses.addSubnet(network, prefix, "ipv6");
}

let publicHttpsDispatcher = null;

function publicHttpsError(message, code, unsafeNetworkTarget = false) {
  const error = new Error(message);
  error.code = code;
  error.unsafeNetworkTarget = unsafeNetworkTarget;
  return error;
}

function normalizedHostname(value) {
  const unwrapped = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  return unwrapped.toLowerCase().replace(/\.+$/u, "");
}

function assertPublicIpAddress(address) {
  const family = isIP(address);
  if (
    family === 0 ||
    forbiddenAddresses.check(address, family === 4 ? "ipv4" : "ipv6")
  ) {
    throw publicHttpsError(
      "Network target resolves to a non-public address",
      "public_https_address_forbidden",
      true
    );
  }
  return { address, family };
}

function normalizeLookupRecords(value) {
  const records = (Array.isArray(value) ? value : [value])
    .map((item) => typeof item === "string" ? { address: item } : item)
    .filter((item) => item && typeof item.address === "string")
    .map((item) => assertPublicIpAddress(item.address));
  if (records.length === 0) {
    throw publicHttpsError(
      "Network target did not resolve to an address",
      "public_https_dns_failed"
    );
  }
  return records;
}

async function resolvePublicAddresses(hostname, lookupImpl) {
  try {
    return normalizeLookupRecords(await lookupImpl(hostname, { all: true, verbatim: true }));
  } catch (error) {
    if (error?.code?.startsWith?.("public_https_")) throw error;
    throw publicHttpsError("Network target DNS lookup failed", "public_https_dns_failed");
  }
}

function secureDispatcherLookup(hostname, options, callback) {
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (error, records) => {
    if (error) {
      callback(error);
      return;
    }
    try {
      const safeRecords = normalizeLookupRecords(records);
      if (options?.all) callback(null, safeRecords);
      else callback(null, safeRecords[0].address, safeRecords[0].family);
    } catch (lookupError) {
      callback(lookupError);
    }
  });
}

function getPublicHttpsDispatcher() {
  publicHttpsDispatcher ??= new Agent({
    connect: { lookup: secureDispatcherLookup }
  });
  return publicHttpsDispatcher;
}

async function discardResponseBody(response, reason) {
  try {
    await response?.body?.cancel?.(reason);
  } catch {
    // The request is already being abandoned; cancellation errors are non-actionable.
  }
}

export async function assertPublicHttpsTarget(value, options = {}) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw publicHttpsError("Network target URL is invalid", "public_https_url_invalid", true);
  }
  const hostname = normalizedHostname(url.hostname);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw publicHttpsError(
      "Network target must use credential-free HTTPS",
      "public_https_scheme_forbidden",
      true
    );
  }
  if (
    !hostname ||
    ["localhost", "local", "internal", "home.arpa"].includes(hostname) ||
    [".localhost", ".local", ".internal", ".home.arpa"].some((suffix) =>
      hostname.endsWith(suffix)
    )
  ) {
    throw publicHttpsError(
      "Network target hostname is not public",
      "public_https_hostname_forbidden",
      true
    );
  }
  const family = isIP(hostname);
  const addresses = family
    ? [assertPublicIpAddress(hostname)]
    : await resolvePublicAddresses(hostname, options.lookupImpl ?? dnsLookupPromise);
  return { url, addresses };
}

export async function fetchPublicHttps(value, options = {}) {
  const maximumRedirects = options.maximumRedirects ?? 5;
  const fetchImpl = options.fetchImpl ?? undiciFetch;
  let currentUrl = value;
  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const { url } = await assertPublicHttpsTarget(currentUrl, {
      lookupImpl: options.lookupImpl
    });
    const response = await fetchImpl(url.href, {
      ...options.init,
      redirect: "manual",
      dispatcher: getPublicHttpsDispatcher()
    });
    if (!redirectStatuses.has(response.status)) {
      return { response, finalUrl: url };
    }
    const location = response.headers?.get?.("location");
    await discardResponseBody(response, "manual-redirect");
    if (!location) {
      throw publicHttpsError(
        "Network redirect is missing a location",
        "public_https_redirect_invalid",
        true
      );
    }
    if (redirectCount === maximumRedirects) {
      throw publicHttpsError(
        "Network redirect limit exceeded",
        "public_https_redirect_limit",
        true
      );
    }
    try {
      currentUrl = new URL(location, url).href;
    } catch {
      throw publicHttpsError(
        "Network redirect location is invalid",
        "public_https_redirect_invalid",
        true
      );
    }
  }
  throw publicHttpsError(
    "Network redirect limit exceeded",
    "public_https_redirect_limit",
    true
  );
}

export function parseMacProxy(output) {
  const values = new Map();
  for (const line of String(output).split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/u.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  if (values.get("HTTPSEnable") !== "1") return null;
  const host = values.get("HTTPSProxy");
  const port = values.get("HTTPSPort");
  if (!host || !port || !/^\d+$/u.test(port)) return null;
  return `http://${host}:${port}`;
}

export async function resolveProxyUrl(options = {}) {
  const environment = options.environment ?? process.env;
  const configured =
    environment.HTTPS_PROXY ||
    environment.https_proxy ||
    environment.HTTP_PROXY ||
    environment.http_proxy;
  if (configured) return configured;
  if ((options.platform ?? process.platform) !== "darwin") return null;
  try {
    const run = options.execFileAsync ?? execFileAsync;
    const { stdout } = await run("scutil", ["--proxy"], { encoding: "utf8" });
    return parseMacProxy(stdout);
  } catch {
    return null;
  }
}
