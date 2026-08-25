import { normalize, resolve } from "node:path";

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

const GOLDEN_RESEARCH_DOCUMENTS = Object.freeze([
  "episodes/golden-001/02-source-register.md",
  "episodes/golden-001/03-claim-ledger.md"
]);
const GOLDEN_RESEARCH_SOURCE_IDS = Object.freeze([
  "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S12", "S13", "S14", "S15"
]);
const GOLDEN_RESEARCH_CLAIM_IDS = Object.freeze(["C01", "C03", "C05", "C06", "C09", "C10"]);

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validResearchUrl(value) {
  if (!nonEmptyText(value)) return false;
  try {
    return new Set(["http:", "https:"]).has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function sameIdSet(actual, expected) {
  return actual.size === expected.length && expected.every((id) => actual.has(id));
}

export function inspectInlineResearchEvidence(episode) {
  const research = episode.research ?? {};
  const content = research.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return {
      applicable: false,
      passed: true,
      documentCount: Array.isArray(episode.sourceDocs) ? episode.sourceDocs.length : 0,
      sourceCount: 0,
      claimCount: 0,
      issues: []
    };
  }

  const issues = [];
  const sourceDocs = Array.isArray(episode.sourceDocs) ? episode.sourceDocs : [];
  const sources = Array.isArray(content.sources) ? content.sources : [];
  const claims = Array.isArray(content.claims) ? content.claims : [];
  const documentPaths = new Set();
  const sourceIds = new Set();
  const claimIds = new Set();
  const add = (code, message) => issues.push({ code, message });

  if (sourceDocs.length < 2) {
    add("research-source-documents-insufficient", "内嵌研究正文至少需要两份已登记本地证据文件");
  }
  for (const [index, source] of sourceDocs.entries()) {
    const path = typeof source?.path === "string" ? source.path.trim() : "";
    if (!path || !Number.isSafeInteger(source?.bytes) || source.bytes < 1 || !isSha256(source?.sha256)) {
      add("research-source-document-unregistered", `第 ${index + 1} 份本地证据缺少 path、bytes 或 SHA-256`);
      continue;
    }
    const canonicalPath = normalize(path).replaceAll("\\", "/");
    if (documentPaths.has(canonicalPath)) {
      add("research-source-document-duplicate", `本地证据路径重复：${path}`);
    }
    documentPaths.add(canonicalPath);
  }

  if (
    episode.id === "golden-001"
    || research.generationKind === "deterministic-golden-m1-fixed-evidence"
  ) {
    for (const path of GOLDEN_RESEARCH_DOCUMENTS) {
      if (!documentPaths.has(path)) {
        add("golden-research-document-missing", `Golden 固定研究证据缺少：${path}`);
      }
    }
  }

  if (sources.length < 2) {
    add("research-source-register-insufficient", "研究正文至少需要两个已登记来源");
  }
  for (const [index, source] of sources.entries()) {
    const id = typeof source?.id === "string" ? source.id.trim() : "";
    if (!id) {
      add("research-source-id-missing", `第 ${index + 1} 个研究来源缺少稳定 ID`);
      continue;
    }
    if (sourceIds.has(id)) add("research-source-id-duplicate", `研究来源 ID 重复：${id}`);
    sourceIds.add(id);
    if (!nonEmptyText(source?.label)) {
      add("research-source-label-missing", `研究来源 ${id || index + 1} 缺少名称`);
    }
    if (!validResearchUrl(source?.url)) {
      add("research-source-url-invalid", `研究来源 ${id || index + 1} 缺少合法 HTTP(S) 链接`);
    }
    if (!nonEmptyText(source?.publisher)) {
      add("research-source-publisher-missing", `研究来源 ${id || index + 1} 缺少发布方`);
    }
    if (!nonEmptyText(source?.sourceType)) {
      add("research-source-type-missing", `研究来源 ${id || index + 1} 缺少来源类型`);
    }
  }

  if (claims.length < 1) add("research-claims-empty", "研究正文没有可审批主张");
  for (const [index, claim] of claims.entries()) {
    const id = typeof claim?.id === "string" ? claim.id.trim() : "";
    if (!id) add("research-claim-id-missing", `第 ${index + 1} 项研究主张缺少稳定 ID`);
    else if (claimIds.has(id)) add("research-claim-id-duplicate", `研究主张 ID 重复：${id}`);
    else claimIds.add(id);
    for (const [field, label] of [
      ["text", "正文"],
      ["category", "类别"],
      ["support", "支持度"],
      ["boundary", "使用边界"]
    ]) {
      if (!nonEmptyText(claim?.[field])) {
        add(`research-claim-${field}-missing`, `研究主张 ${id || index + 1} 缺少${label}`);
      }
    }
    const refs = Array.isArray(claim?.sourceIds) ? claim.sourceIds : [];
    if (refs.length < 1) {
      add("research-claim-source-empty", `研究主张 ${id || index + 1} 没有来源引用`);
      continue;
    }
    const normalizedRefs = refs.map((ref) => typeof ref === "string" ? ref.trim() : "");
    if (normalizedRefs.some((ref) => !ref)) {
      add("research-claim-source-invalid", `研究主张 ${id || index + 1} 含空来源引用`);
    }
    if (new Set(normalizedRefs).size !== normalizedRefs.length) {
      add("research-claim-source-duplicate", `研究主张 ${id || index + 1} 含重复来源引用`);
    }
    for (const ref of normalizedRefs) {
      if (!sourceIds.has(ref)) {
        add("research-claim-source-unknown", `研究主张 ${id || index + 1} 引用了未登记来源：${String(ref)}`);
      }
    }
  }

  if (
    episode.id === "golden-001"
    || research.generationKind === "deterministic-golden-m1-fixed-evidence"
  ) {
    if (!sameIdSet(sourceIds, GOLDEN_RESEARCH_SOURCE_IDS)) {
      add("golden-research-source-set-mismatch", "Golden 研究来源 ID 集与固定证据不一致");
    }
    if (!sameIdSet(claimIds, GOLDEN_RESEARCH_CLAIM_IDS)) {
      add("golden-research-claim-set-mismatch", "Golden 研究主张 ID 集与固定成片结论不一致");
    }
  }

  if (research.readiness?.verifiedSourceCount !== sourceDocs.length) {
    add("research-source-count-stale", "readiness 的本地来源数量与当前登记不一致");
  }
  if (research.readiness?.supportedClaimCount !== claims.length) {
    add("research-claim-count-stale", "readiness 的支持主张数量与当前正文不一致");
  }

  return {
    applicable: true,
    passed: issues.length === 0,
    documentCount: sourceDocs.length,
    sourceCount: sources.length,
    claimCount: claims.length,
    issues
  };
}

function registeredArtifacts(episode, gate) {
  if (gate === "research") {
    const path = episode.research?.packPath ?? null;
    if (path) {
      return [(episode.sourceDocs ?? []).find((item) => item.path === path) ?? { path }];
    }
    return episode.research?.content ? [...(episode.sourceDocs ?? [])] : [];
  }
  if (gate === "script") {
    const draft = episode.production?.scriptDraft;
    if (draft?.content !== null && draft?.content !== undefined) return [];
    const path = draft?.artifactPath ?? draft?.source ?? null;
    return path ? [{ ...draft, path }] : [];
  }
  if (gate === "storyboard") {
    const draft = episode.production?.storyboardDraft;
    const path = draft?.artifactPath ?? null;
    return path ? [{ ...draft, path }] : [];
  }
  return [];
}

export async function assertCurrentApprovalArtifactIntegrity(episode, gate, options = {}) {
  if (gate === "research" && episode.research?.content) {
    const inspection = inspectInlineResearchEvidence(episode);
    if (!inspection.passed) {
      const error = integrityError(
        "当前研究正文与来源登记不闭合，必须修复并重新机器审核",
        "research_approval_evidence_registry_invalid"
      );
      error.issues = inspection.issues;
      throw error;
    }
  }
  const expectedArtifacts = registeredArtifacts(episode, gate);
  if (expectedArtifacts.length === 0) return null;
  const verified = [];
  const resolvedPaths = new Set();
  for (const expected of expectedArtifacts) {
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
    if (resolvedPaths.has(realPath)) {
      throw integrityError(
        `当前 ${gate} 待审批正文重复指向同一真实文件`,
        `${gate}_approval_artifact_duplicate`
      );
    }
    resolvedPaths.add(realPath);
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
    verified.push({ path: expected.path, ...actual });
  }
  return verified.length === 1 ? verified[0] : { documents: verified };
}
