import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { integrityHash, isSha256 } from "../../shared/integrity.mjs";
import { studioRoot } from "../../shared/paths.mjs";

export const WORKER_PROMPT_SET_VERSION = "worker-prompts-v1";

const promptFiles = Object.freeze({
  "script-agent": "script-agent.v1.json",
  "storyboard-agent": "storyboard-agent.v1.json",
  "asset-agent": "asset-agent.v1.json"
});

function promptPayload(document) {
  return {
    schemaVersion: document.schemaVersion,
    id: document.id,
    version: document.version,
    variables: document.variables,
    template: document.template
  };
}

function requirePromptDocument(workerId, document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`Worker prompt ${workerId} must be an object`);
  }
  if (
    document.schemaVersion !== 1 ||
    typeof document.id !== "string" ||
    !document.id.trim() ||
    typeof document.version !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(document.version) ||
    !Array.isArray(document.variables) ||
    document.variables.some((name) => typeof name !== "string" || !/^[a-zA-Z][a-zA-Z0-9]*$/u.test(name)) ||
    new Set(document.variables).size !== document.variables.length ||
    typeof document.template !== "string" ||
    !document.template.trim() ||
    !isSha256(document.hash)
  ) {
    throw new Error(`Worker prompt ${workerId} metadata is invalid`);
  }
  const actualHash = integrityHash(promptPayload(document));
  if (actualHash !== document.hash) {
    throw new Error(`Worker prompt ${workerId} hash mismatch`);
  }
  return Object.freeze({
    id: document.id,
    version: document.version,
    variables: Object.freeze([...document.variables]),
    hash: document.hash,
    template: document.template
  });
}

export async function readWorkerPrompt(workerId) {
  const fileName = promptFiles[workerId];
  if (!fileName) throw new Error(`Unknown Worker prompt: ${workerId}`);
  const path = resolve(studioRoot, "prompts", "workers", fileName);
  const document = JSON.parse(await readFile(path, "utf8"));
  return requirePromptDocument(workerId, document);
}

export async function buildWorkerPrompt(workerId, variables = {}) {
  const prompt = await readWorkerPrompt(workerId);
  const suppliedNames = Object.keys(variables).sort();
  const expectedNames = [...prompt.variables].sort();
  if (JSON.stringify(suppliedNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Worker prompt ${workerId} variables mismatch: expected ${expectedNames.join(", ") || "none"}`
    );
  }
  let instructions = prompt.template;
  for (const name of prompt.variables) {
    const value = variables[name];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Worker prompt ${workerId} variable ${name} must be non-empty`);
    }
    instructions = instructions.replaceAll(`{{${name}}}`, value.trim());
  }
  if (/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/u.test(instructions)) {
    throw new Error(`Worker prompt ${workerId} contains unresolved variables`);
  }
  return {
    instructions,
    binding: Object.freeze({
      id: prompt.id,
      version: prompt.version,
      hash: prompt.hash,
      renderedHash: integrityHash(instructions)
    })
  };
}

export async function readWorkerPromptSetBinding() {
  const prompts = await Promise.all(
    Object.keys(promptFiles).sort().map(async (workerId) => {
      const prompt = await readWorkerPrompt(workerId);
      return {
        workerId,
        id: prompt.id,
        version: prompt.version,
        hash: prompt.hash
      };
    })
  );
  return {
    version: WORKER_PROMPT_SET_VERSION,
    hash: integrityHash({ version: WORKER_PROMPT_SET_VERSION, prompts }),
    prompts
  };
}
