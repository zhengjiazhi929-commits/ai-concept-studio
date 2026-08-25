import { resolve } from "node:path";

import {
  inspectFileIntegrity,
  isSha256,
  matchesFileIntegrity
} from "../../shared/integrity.mjs";
import {
  resolveExistingPathInside,
  workspaceRoot
} from "../../shared/paths.mjs";

function integrityError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

function registeredArtifact(episode, gate) {
  if (gate === "research") {
    const path = episode.research?.packPath ?? null;
    return path
      ? (episode.sourceDocs ?? []).find((item) => item.path === path) ?? { path }
      : null;
  }
  if (gate === "script") {
    const draft = episode.production?.scriptDraft;
    if (draft?.content !== null && draft?.content !== undefined) return null;
    const path = draft?.artifactPath ?? draft?.source ?? null;
    return path ? { ...draft, path } : null;
  }
  if (gate === "storyboard") {
    const draft = episode.production?.storyboardDraft;
    const path = draft?.artifactPath ?? null;
    return path ? { ...draft, path } : null;
  }
  return null;
}

export async function assertCurrentApprovalArtifactIntegrity(episode, gate, options = {}) {
  const expected = registeredArtifact(episode, gate);
  if (!expected) return null;
  if (
    typeof expected.path !== "string"
    || !expected.path.trim()
    || !Number.isSafeInteger(expected.bytes)
    || expected.bytes < 1
    || !isSha256(expected.sha256)
  ) {
    throw integrityError(
      `当前 ${gate} 待审批正文没有登记 bytes 与 SHA-256`,
      `${gate}_approval_artifact_integrity_unregistered`
    );
  }
  let realPath;
  try {
    realPath = await (options.resolveExistingPathInside ?? resolveExistingPathInside)(
      workspaceRoot,
      resolve(workspaceRoot, expected.path)
    );
  } catch (cause) {
    const error = integrityError(
      `当前 ${gate} 待审批正文路径不可安全读取`,
      `${gate}_approval_artifact_unreadable`
    );
    error.cause = cause;
    throw error;
  }
  let actual;
  try {
    actual = await (options.inspectFileIntegrity ?? inspectFileIntegrity)(realPath);
  } catch (cause) {
    const error = integrityError(
      `当前 ${gate} 待审批正文无法完成完整性检查`,
      `${gate}_approval_artifact_unreadable`
    );
    error.cause = cause;
    throw error;
  }
  if (!matchesFileIntegrity(expected, actual)) {
    throw integrityError(
      `当前 ${gate} 待审批正文已变化，必须重新生成机器报告与审批绑定`,
      `${gate}_approval_artifact_integrity_mismatch`
    );
  }
  return { path: expected.path, ...actual };
}
