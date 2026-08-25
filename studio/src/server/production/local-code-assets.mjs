import { createHash } from "node:crypto";
import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  episodePublicDirectory,
  ensureInside,
  publicRoot
} from "../../shared/paths.mjs";
import {
  assetExecutionApprovalRequired,
  assetExecutionApprovalValid,
  assertAssetExecutionAuthorized
} from "../reviews/asset-execution-checkpoint.mjs";
import { integrityHash } from "../../shared/integrity.mjs";
import {
  LOCAL_CODE_IMPLEMENTATION_VERSION,
  inspectLocalCodeImplementation
} from "./local-code-implementation.mjs";

export { inspectLocalCodeImplementation } from "./local-code-implementation.mjs";

export const LOCAL_CODE_ASSET_MANIFEST_VERSION = "local-code-animation-manifest-v1";
export { LOCAL_CODE_IMPLEMENTATION_VERSION };

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function timestamp(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

export function localCodeAssetItems(episode) {
  return (episode.production?.assetPlan?.content?.items ?? []).filter(
    (item) =>
      item.required === true &&
      item.assetType !== "voice" &&
      item.productionMethod?.kind === "local-code-animation"
  );
}

function manifestPayload(episode, item, assetVersion, renderedAt, implementation) {
  const visualContract = item.visualContract
    ? structuredClone(item.visualContract)
    : null;
  const visualContractHash = visualContract ? integrityHash(visualContract) : null;
  return {
    schemaVersion: LOCAL_CODE_ASSET_MANIFEST_VERSION,
    episodeId: episode.id,
    planItemId: item.id,
    assetVersion,
    sourceAssetPlan: {
      version: episode.production.assetPlan.version,
      candidateHash:
        episode.reviewCheckpoints?.assetExecution?.currentCandidate?.candidateHash ?? null
    },
    sourceStoryboard: {
      version: episode.approvals.storyboard.currentVersion,
      artifactHash: episode.approvals.storyboard.artifactHash,
      reviewReportId: episode.approvals.storyboard.reviewReportId
    },
    renderer: {
      kind: "local-code-animation",
      executor: item.productionMethod.executor,
      componentId: "AgentSkillShortExplainer",
      implementation,
      externalApiCalls: 0,
      externalApiCostUsd: 0
    },
    sceneIds: [...item.sceneIds],
    purpose: item.purpose,
    sourceRequirement: item.sourceRequirement,
    rightsRequirement: item.rightsRequirement,
    visualContract,
    visualContractHash,
    visualRules: [...(episode.production.assetPlan.content.visualRules ?? [])],
    renderedAt
  };
}

export async function buildLocalCodeAssets(episode, options = {}) {
  if (!assetExecutionApprovalRequired(episode)) {
    throw new Error("当前素材方案没有声明可执行的生成前审批策略");
  }
  if (!assetExecutionApprovalValid(episode)) {
    const error = new Error("素材执行方案尚未通过有效人工批准，不能制作本地代码动画");
    error.code = "asset_execution_approval_required";
    throw error;
  }
  const items = localCodeAssetItems(episode);
  if (items.length === 0) throw new Error("当前方案没有本地代码动画条目");

  const renderedAt = timestamp(options.now);
  const implementation =
    options.implementation ?? (await inspectLocalCodeImplementation(options));
  const approvedImplementation = episode.reviewCheckpoints?.assetExecution
    ?.currentCandidate?.localCodeImplementation;
  if (
    !approvedImplementation ||
    approvedImplementation.schemaVersion !== implementation.schemaVersion ||
    approvedImplementation.componentId !== implementation.componentId ||
    approvedImplementation.sha256 !== implementation.sha256
  ) {
    const error = new Error("本地代码实现已偏离人工批准候选，必须重新机器审核和人工批准");
    error.code = "local_code_implementation_stale";
    throw error;
  }
  const publicDirectory = options.outputDirectory
    ? ensureInside(publicRoot, resolve(publicRoot, options.outputDirectory))
    : episodePublicDirectory(episode.id);
  const publicPrefix = options.publicPrefix
    ? String(options.publicPrefix).replace(/^\/+|\/+$/gu, "")
    : `episodes/${episode.id}`;
  const directory = resolve(publicDirectory, "local-code-assets");
  await mkdir(directory, { recursive: true });
  const assets = [];
  for (const item of items) {
    assertAssetExecutionAuthorized(episode, {
      itemId: item.id,
      executor: item.productionMethod.executor,
      external: false
    });
    const escapedId = item.id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const versionPattern = new RegExp(`^${escapedId}-v(\\d{3})\\.json$`, "u");
    const assetVersion = (await readdir(directory)).reduce((highest, fileName) => {
      const match = versionPattern.exec(fileName);
      return Math.max(highest, match ? Number(match[1]) : 0);
    }, 0) + 1;
    const payload = manifestPayload(
      episode,
      item,
      assetVersion,
      renderedAt,
      implementation
    );
    const data = Buffer.from(stableJson(payload), "utf8");
    const fileName = `${item.id}-v${String(assetVersion).padStart(3, "0")}.json`;
    const destination = ensureInside(directory, resolve(directory, fileName));
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, destination);
    const candidateHash =
      episode.reviewCheckpoints?.assetExecution?.currentCandidate?.candidateHash ?? null;
    const visualContractHash = item.visualContract
      ? integrityHash(item.visualContract)
      : null;
    assets.push({
      id: `local-code-${item.id}-v${assetVersion}`,
      planItemId: item.id,
      version: assetVersion,
      type: "code-animation",
      path: `${publicPrefix}/local-code-assets/${fileName}`,
      source: "local-code-animation",
      executor: item.productionMethod.executor,
      componentId: "AgentSkillShortExplainer",
      implementationSha256: implementation.sha256,
      assetPlanVersion: episode.production.assetPlan.version,
      candidateHash,
      visualContractHash,
      bytes: data.length,
      sha256: sha256(data),
      createdAt: renderedAt,
      privacy: "project-original",
      verified: true,
      rights: {
        schemaVersion: 1,
        authorOrSource: "AI Concept Studio local code renderer",
        sourceUrl: null,
        acquiredAt: renderedAt,
        license: "project-original-private-use",
        allowedUse: "private-internal-review",
        attributionRequirements: "none",
        privacyPortraitStatus: "project-original",
        verifiedBy:
          episode.reviewCheckpoints?.assetExecution?.humanApproval?.actor
          ?? "machine:local-code-assets-v1"
      },
      externalApiCalls: 0,
      maximumPaidCostUsd: 0
    });
  }
  return assets;
}

export async function localCodeAssetFilesExist(assets, options = {}) {
  const access = options.access;
  const missing = [];
  for (const asset of assets) {
    const target = ensureInside(publicRoot, resolve(publicRoot, asset.path));
    try {
      if (access) await access(target);
      else {
        const { access: fileAccess } = await import("node:fs/promises");
        await fileAccess(target);
      }
    } catch {
      missing.push(asset.path);
    }
  }
  return missing;
}
