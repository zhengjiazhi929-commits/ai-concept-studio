import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
