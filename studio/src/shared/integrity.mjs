import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const fields = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function integrityHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function sameFileSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

export async function inspectFileIntegrity(filePath) {
  const handle = await open(filePath, "r");
  try {
    const before = await handle.stat();
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat();
    const currentPath = await stat(filePath);
    if (!sameFileSnapshot(before, after) || !sameFileSnapshot(after, currentPath)) {
      const error = new Error("文件在完整性检查期间发生变化，请重新检查");
      error.code = "file_changed_during_integrity_check";
      throw error;
    }
    return { bytes: after.size, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

export function matchesFileIntegrity(recorded, actual) {
  return (
    Number.isSafeInteger(recorded?.bytes) &&
    recorded.bytes >= 0 &&
    isSha256(recorded?.sha256) &&
    recorded.bytes === actual?.bytes &&
    recorded.sha256 === actual?.sha256
  );
}
