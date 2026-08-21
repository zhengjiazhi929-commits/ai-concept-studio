import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { studioRoot } from "./paths.mjs";

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(trimmed);
  if (!match) return null;
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [match[1], value];
}

export async function loadLocalEnvironment(options = {}) {
  const files = options.files ?? [".env.local", ".env"];
  const loaded = [];
  for (const file of files) {
    const path = resolve(studioRoot, file);
    let body;
    try {
      body = await readFile(path, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const line of body.split(/\r?\n/u)) {
      const entry = parseLine(line);
      if (!entry) continue;
      const [name, value] = entry;
      if (process.env[name] === undefined) process.env[name] = value;
    }
    loaded.push(file);
  }
  return { loadedFiles: loaded };
}
