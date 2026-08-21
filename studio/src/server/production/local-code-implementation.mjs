import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { studioRoot, videoRoot, workspaceRelativePath } from "../../shared/paths.mjs";

export const LOCAL_CODE_IMPLEMENTATION_VERSION = "local-code-implementation-v4";

export const LOCAL_CODE_IMPLEMENTATION_FILES = Object.freeze([
  resolve(videoRoot, "index.jsx"),
  resolve(videoRoot, "root.jsx"),
  resolve(videoRoot, "episode-preview.jsx"),
  resolve(videoRoot, "agent-skill-short.jsx"),
  resolve(videoRoot, "agent-skill-short-plan.mjs"),
  resolve(videoRoot, "components", "chrome.jsx"),
  resolve(videoRoot, "text-layout.mjs"),
  resolve(studioRoot, "src", "shared", "technical-diagram-contract.mjs")
]);

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function inspectLocalCodeImplementation(options = {}) {
  const read = options.readFile ?? readFile;
  const files = [];
  for (const filePath of LOCAL_CODE_IMPLEMENTATION_FILES) {
    const data = await read(filePath);
    files.push({
      path: workspaceRelativePath(filePath),
      bytes: data.length,
      sha256: sha256(data)
    });
  }
  return {
    schemaVersion: LOCAL_CODE_IMPLEMENTATION_VERSION,
    componentId: "AgentSkillShortExplainer",
    files,
    sha256: sha256(stableJson(files))
  };
}
