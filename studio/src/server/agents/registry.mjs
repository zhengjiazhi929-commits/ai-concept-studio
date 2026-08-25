import { access } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ensureInside,
  publicRoot,
  workspaceRelativePath,
  workspaceRoot
} from "../../shared/paths.mjs";
import { validateEpisode } from "../../shared/schema.mjs";
import { inspectFileIntegrity, integrityHash } from "../../shared/integrity.mjs";
import {
  nextAssetBundleRevision,
  resetApprovalForVersion
} from "../../shared/workflow.mjs";
import { renderPreview } from "../renderer.mjs";
import { runPreviewQa } from "../qa.mjs";
import { runTrendRadarAgent } from "../trends/agent.mjs";
import { researchPatch, runEpisodeResearchAgent } from "../research/agent.mjs";
import {
  createVoicePlan,
  generateAssetPlan,
  generateScriptDraft,
  generateStoryboardDraft
} from "../production/generator.mjs";
import { evaluateProductionQuality } from "../production/quality.mjs";
import {
  buildLocalCodeAssets,
  inspectLocalCodeImplementation,
  localCodeAssetItems
} from "../production/local-code-assets.mjs";
import {
  buildApprovedExternalAssets,
  externalAssetItems,
  requiredExternalAssetToolIds
} from "../production/external-assets.mjs";
import {
  assetExecutionApprovalValid,
  assetExecutionApprovalRequired,
  assetExecutionPreflightValid,
  buildAssetExecutionCheckpoint
} from "../reviews/asset-execution-checkpoint.mjs";

function outcome(status, message, extras = {}) {
  return { status, message, artifacts: [], findings: [], ...extras };
}

function externalAssetOptionsWithoutCapabilityAuthority(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const sanitized = { ...value };
  delete sanitized.authorizeSideEffect;
  delete sanitized.sideEffectGrant;
  return sanitized;
}

function aiState(episode, generated) {
  if (generated.generationKind?.startsWith("deterministic-")) {
    return {
      ...(episode.production?.ai ?? {}),
      requestCount: generated.requestCount,
      attempts: [...(episode.production?.ai?.attempts ?? []), ...(generated.attempts ?? [])]
    };
  }
  return {
    ...(episode.production?.ai ?? {}),
    requestCount: generated.requestCount,
    lastProvider: generated.provider,
    lastModel: generated.model,
    lastUsage: generated.usage,
    ...(generated.promptBinding
      ? { lastPromptBinding: structuredClone(generated.promptBinding) }
      : {}),
    lastRequestAt: new Date().toISOString(),
    attempts: [...(episode.production?.ai?.attempts ?? []), ...(generated.attempts ?? [])]
  };
}

function routingState(episode, generated) {
  if (!generated.routingDecision) return {};
  if (generated.routingDecision.outcome?.budgetAccounted === true) return {};
  const callCount = generated.attempts?.length ?? 0;
  const costUsd = generated.routingDecision.outcome?.actualCostUsd
    ?? generated.routingDecision.outcome?.accountedCostUsd
    ?? generated.routingDecision.outcome?.estimatedCostUsd
    ?? 0;
  return {
    routingHistory: [...(episode.routingHistory ?? []), generated.routingDecision],
    control: {
      budget: {
        ...(episode.control?.budget ?? {}),
        usedCalls: (episode.control?.budget?.usedCalls ?? 0) + callCount,
        usedCostUsd: Number(((episode.control?.budget?.usedCostUsd ?? 0) + (costUsd ?? 0)).toFixed(6)),
        overrun: Boolean(
          episode.control?.budget?.overrun ||
          generated.routingDecision.outcome?.budgetOverrun
        )
      }
    }
  };
}

function versionEntry(generated, extras = {}) {
  return {
    version: generated.artifact.version,
    artifactPath: generated.artifact.relativePath,
    provider: generated.provider,
    model: generated.model,
    usage: generated.usage,
    generatedAt: new Date().toISOString(),
    ...(generated.generationKind ? { generationKind: generated.generationKind } : {}),
    ...(generated.promptBinding
      ? { promptBinding: structuredClone(generated.promptBinding) }
      : {}),
    ...(generated.sourceSnapshotHash
      ? { sourceSnapshotHash: generated.sourceSnapshotHash }
      : {}),
    ...(generated.sourceScriptVersion
      ? { sourceScriptVersion: generated.sourceScriptVersion }
      : {}),
    ...(generated.sourceScriptArtifactHash
      ? { sourceScriptArtifactHash: generated.sourceScriptArtifactHash }
      : {}),
    ...(generated.sourceScriptReviewReportId
      ? { sourceScriptReviewReportId: generated.sourceScriptReviewReportId }
      : {}),
    ...(generated.sourceStoryboardVersion
      ? { sourceStoryboardVersion: generated.sourceStoryboardVersion }
      : {}),
    ...(generated.sourceStoryboardArtifactHash
      ? { sourceStoryboardArtifactHash: generated.sourceStoryboardArtifactHash }
      : {}),
    ...(generated.sourceStoryboardReviewReportId
      ? { sourceStoryboardReviewReportId: generated.sourceStoryboardReviewReportId }
      : {}),
    ...extras
  };
}

function renderVersion(relativeOutputPath) {
  return Number(/preview-v(\d{3})\.mp4$/u.exec(relativeOutputPath)?.[1] ?? 1);
}

function bindPlannedAssetsToScenes(episode) {
  const assetsByPlanItem = new Map(
    (episode.assets ?? [])
      .filter((asset) => asset.planItemId && asset.path)
      .map((asset) => [asset.planItemId, asset])
  );
  const bindingByScene = new Map();
  const plannedItems = episode.production?.assetPlan?.content?.items ?? [];
  const sceneSpecificItems = plannedItems.filter(
    (item) => item.id !== "subtitle-and-progress-chrome"
  );
  const fallbackItems = plannedItems.filter(
    (item) => item.id === "subtitle-and-progress-chrome"
  );
  for (const item of [...fallbackItems, ...sceneSpecificItems]) {
    const asset = assetsByPlanItem.get(item.id);
    if (!asset) continue;
    for (const sceneId of item.sceneIds ?? []) {
      bindingByScene.set(sceneId, {
        field: asset.type === "audio" ? "audio" : "asset",
        path: asset.path
      });
    }
  }
  return (episode.scenes ?? []).map((scene) => {
    const binding = bindingByScene.get(scene.id);
    return binding ? { ...scene, [binding.field]: binding.path } : scene;
  });
}

export const agents = {
  "trend-agent": {
    id: "trend-agent",
    label: "热点发现 Agent",
    async run(episode, context = {}) {
      if (!episode.trendSelection && episode.id !== "golden-001") {
        const { run, runPath } = await runTrendRadarAgent({
          sideEffectGrant: context.sideEffectGrant ?? undefined,
          requireSideEffectCapability: Boolean(context.sideEffectGrant),
          capabilityOperation: "worker:trend-agent",
          episodeId: episode.id,
          dependencies: context.sideEffectDependencies ?? undefined,
          now: context.now ?? undefined
        });
        return outcome(
          "blocked",
          `发现 ${run.summary.formalCandidateCount} 个正式候选，请先在概念雷达中人工选择`,
          { artifacts: [workspaceRelativePath(runPath)] }
        );
      }
      return outcome("complete", "选题已由人工选定，可以进入研究与事实核验");
    }
  },
  "research-agent": {
    id: "research-agent",
    label: "研究 Agent",
    async run(episode, context = {}) {
      if (episode.approvals.research.status === "approved") {
        const importedLegacy = !episode.research && episode.sourceDocs.length >= 3;
        if (!importedLegacy && !episode.research?.readiness?.readyForFactApproval) {
          return outcome("failed", "研究审批与证据状态不一致，请重新核验");
        }
        return outcome("complete", `研究证据已批准，共登记 ${episode.sourceDocs.length} 份产物`);
      }
      const result = await runEpisodeResearchAgent(episode, {
        reviewFeedback: context.reviewFeedback,
        sideEffectGrant: context.sideEffectGrant ?? undefined,
        requireSideEffectCapability: Boolean(context.sideEffectGrant),
        capabilityOperation: "worker:research-agent",
        episodeId: episode.id,
        dependencies: context.sideEffectDependencies ?? undefined,
        now: context.now ?? undefined
      });
      const ready = result.pack.readiness.readyForFactApproval;
      return outcome(
        ready ? "waiting_approval" : "blocked",
        ready
          ? "证据包达到门槛，请人工批准研究结论"
          : `研究仍需补证：${result.pack.readiness.reasons.join("；")}`,
        {
          requiresApproval: ready ? "research" : null,
          artifacts: [
            workspaceRelativePath(result.runPath),
            workspaceRelativePath(result.assistTaskPath)
          ],
          findings: result.pack.readiness.reasons,
          patch: researchPatch(episode, result)
        }
      );
    }
  },
  "script-agent": {
    id: "script-agent",
    label: "脚本 Agent",
    async run(episode, context = {}) {
      if (episode.approvals.research.status !== "approved") {
        return outcome("failed", "必须先人工批准研究证据");
      }
      const importedScript = episode.sourceDocs.some((source) => source.path.endsWith("07-script.md"));
      const existingDraft = episode.production?.scriptDraft;
      if (episode.approvals.script.status === "approved") {
        const quality = evaluateProductionQuality(episode, { stage: "script" });
        if (!quality.passed) {
          return outcome("failed", `脚本质量未达标：${quality.errors.join("；")}`, {
            findings: quality.checks
          });
        }
        return outcome("complete", `脚本已审批，内容质量 ${quality.score} 分（${quality.grade}）`, {
          artifacts: existingDraft?.artifactPath ? [existingDraft.artifactPath] : [],
          findings: quality.checks,
          patch: { production: { quality: { script: quality } } }
        });
      }
      if ((importedScript || existingDraft?.artifactPath) && !existingDraft?.needsRevision) {
        return outcome("waiting_approval", "脚本草稿已就绪，请人工审批", {
          requiresApproval: "script",
          artifacts: existingDraft?.artifactPath ? [existingDraft.artifactPath] : []
        });
      }

      const generated = await generateScriptDraft(episode, {
        client: context.aiClient ?? undefined,
        taskProfile: context.taskProfile ?? undefined,
        reviewFeedback: context.reviewFeedback,
        writeArtifact: context.writeArtifact ?? undefined,
        sideEffectGrant: context.sideEffectGrant ?? undefined,
        requireSideEffectCapability: Boolean(context.sideEffectGrant),
        capabilityOperation: "worker:script-agent"
      });
      const entry = versionEntry(generated);
      const generationLabel = generated.generationKind === "deterministic-approved-source-adapter"
        ? "Script Agent 已从批准源脚本生成"
        : "AI 已生成";
      return outcome("waiting_approval", `${generationLabel}脚本 v${entry.version}，请核对事实与表达`, {
        requiresApproval: "script",
        artifacts: [entry.artifactPath],
        patch: {
          ...routingState(episode, generated),
          approvals: {
            script: resetApprovalForVersion(episode.approvals.script, entry.version)
          },
          production: {
            ai: aiState(episode, generated),
            scriptDraft: {
              ...entry,
              needsRevision: false,
              content: generated.value,
              versions: [...(existingDraft?.versions ?? []), entry]
            }
          }
        }
      });
    }
  },
  "storyboard-agent": {
    id: "storyboard-agent",
    label: "分镜 Agent",
    async run(episode, context = {}) {
      if (episode.approvals.script.status !== "approved") {
        return outcome("failed", "必须先人工批准脚本");
      }
      const existingDraft = episode.production?.storyboardDraft;
      if (episode.approvals.storyboard.status === "approved") {
        const validation = validateEpisode(episode);
        if (!validation.valid) return outcome("failed", validation.errors.join("；"));
        const quality = evaluateProductionQuality(episode, { stage: "storyboard" });
        if (!quality.passed) {
          return outcome("failed", `分镜质量未达标：${quality.errors.join("；")}`, {
            findings: quality.checks
          });
        }
        return outcome("complete", `${episode.scenes.length} 个场景连续，内容质量 ${quality.score} 分`, {
          artifacts: existingDraft?.artifactPath ? [existingDraft.artifactPath] : [],
          findings: quality.checks,
          patch: { production: { quality: { storyboard: quality } } }
        });
      }
      if (
        (episode.scenes.length > 0 || existingDraft?.artifactPath) &&
        !existingDraft?.needsRevision &&
        episode.reviews?.storyboard?.status === "passed" &&
        episode.reviews.storyboard.artifactVersion === existingDraft?.version
      ) {
        return outcome("waiting_approval", "分镜草稿已就绪，请人工审批", {
          requiresApproval: "storyboard",
          artifacts: existingDraft?.artifactPath ? [existingDraft.artifactPath] : []
        });
      }

      const generated = await generateStoryboardDraft(episode, {
        client: context.aiClient ?? undefined,
        taskProfile: context.taskProfile ?? undefined,
        reviewFeedback: context.reviewFeedback,
        writeArtifact: context.writeArtifact ?? undefined,
        sideEffectGrant: context.sideEffectGrant ?? undefined,
        requireSideEffectCapability: Boolean(context.sideEffectGrant),
        capabilityOperation: "worker:storyboard-agent"
      });
      const entry = versionEntry(generated, {
        assetChecklist: generated.value.assetChecklist,
        ...(generated.value.visualRules
          ? { visualRules: generated.value.visualRules }
          : {})
      });
      const nextEpisode = {
        ...episode,
        scenes: generated.timeline.scenes,
        subtitles: generated.timeline.subtitles,
        render: { ...episode.render, durationSeconds: generated.timeline.durationSeconds },
        production: {
          ...episode.production,
          storyboardDraft: {
            ...entry,
            needsRevision: false,
            versions: [...(existingDraft?.versions ?? []), entry]
          }
        }
      };
      const quality = evaluateProductionQuality(nextEpisode, { stage: "storyboard" });
      const generationLabel =
        generated.generationKind === "deterministic-approved-script-storyboard-adapter"
          ? "Storyboard Agent 已从批准脚本生成"
          : "AI 已生成";
      return outcome(
        quality.passed ? "waiting_approval" : "failed",
        quality.passed
          ? `${generationLabel}分镜 v${entry.version}（${generated.timeline.scenes.length} 个场景），请人工审批`
          : `生成分镜未通过结构检查：${quality.errors.join("；")}`,
        {
          requiresApproval: quality.passed ? "storyboard" : null,
          artifacts: [entry.artifactPath],
          findings: quality.checks,
          patch: {
            ...routingState(episode, generated),
            approvals: {
              storyboard: resetApprovalForVersion(episode.approvals.storyboard, entry.version)
            },
            scenes: generated.timeline.scenes,
            subtitles: generated.timeline.subtitles,
            render: {
              durationSeconds: generated.timeline.durationSeconds,
              status: "pending",
              outputPath: null,
              progress: 0
            },
            production: {
              ai: aiState(episode, generated),
              storyboardDraft: {
                ...entry,
                needsRevision: !quality.passed,
                versions: [...(existingDraft?.versions ?? []), entry]
              },
              quality: { storyboard: quality }
            }
          }
        }
      );
    }
  },
  "asset-agent": {
    id: "asset-agent",
    label: "素材 Agent",
    async run(episode, context = {}) {
      if (episode.approvals.storyboard.status !== "approved") {
        return outcome("failed", "必须先人工批准分镜");
      }
      const existingPlan = episode.production?.assetPlan;
      if (!existingPlan?.artifactPath || existingPlan.needsRevision) {
        const generated = await generateAssetPlan(episode, {
          client: context.aiClient ?? undefined,
          taskProfile: context.taskProfile ?? undefined,
          reviewFeedback: context.reviewFeedback,
          writeArtifact: context.writeArtifact ?? undefined,
          sideEffectGrant: context.sideEffectGrant ?? undefined,
          requireSideEffectCapability: Boolean(context.sideEffectGrant),
          capabilityOperation: "worker:asset-agent"
        });
        const entry = versionEntry(generated);
        const assetBundleRevision = nextAssetBundleRevision(episode);
        const candidateEpisode = structuredClone(episode);
        candidateEpisode.production = {
          ...(candidateEpisode.production ?? {}),
          assetPlan: {
            ...entry,
            needsRevision: false,
            content: generated.value,
            versions: [...(existingPlan?.versions ?? []), entry]
          }
        };
        const executionReview = await buildAssetExecutionCheckpoint(candidateEpisode, {
          artifactPath: entry.artifactPath,
          version: entry.version
        }, {
          readFile: context.readFile ?? undefined,
          inspectFileIntegrity: context.inspectFileIntegrity ?? undefined,
          now: context.now ?? undefined
        });
        const reviewPassed = executionReview.inspected.passed;
        const failedChecks = executionReview.inspected.checks.filter((check) => !check.passed);
        return outcome("blocked", reviewPassed
          ? `素材执行方案 v${entry.version} 已通过机器审核，等待 Zhengjiazhi 人工批准后才能制作或调用 API`
          : `素材执行方案 v${entry.version} 机器审核未通过，已退回 Asset Agent 修订`, {
          artifacts: [entry.artifactPath],
          findings: reviewPassed
            ? generated.value.risks
            : failedChecks.map((check) => `${check.label}：${check.suggestedFix || check.expected}`),
          requiresHuman: reviewPassed,
          patch: {
            ...routingState(episode, generated),
            approvals: {
              assets: resetApprovalForVersion(episode.approvals.assets, assetBundleRevision)
            },
            production: {
              ai: aiState(episode, generated),
              assetBundleRevision,
              ...(episode.production?.assetPlanDirection
                ? { assetPlanDirection: episode.production.assetPlanDirection }
                : {}),
              assetPlan: {
                ...entry,
                needsRevision: !reviewPassed,
                content: generated.value,
                versions: [...(existingPlan?.versions ?? []), entry]
              }
            },
            reviewCheckpoints: {
              assetExecution: executionReview.checkpoint
            }
          }
        });
      }

      if (assetExecutionApprovalRequired(episode) && !assetExecutionApprovalValid(episode)) {
        const checkpoint = episode.reviewCheckpoints?.assetExecution;
        return outcome("blocked", checkpoint?.status === "waiting_approval"
          ? `素材执行方案 v${existingPlan.version} 已通过机器审核，等待 Zhengjiazhi 人工批准`
          : `素材执行方案 v${existingPlan.version} 尚未获得有效人工批准，不能制作或调用 API`, {
          artifacts: [existingPlan.artifactPath],
          findings: checkpoint?.machineReview?.checks
            ?.filter((check) => !check.passed)
            .map((check) => `${check.label}：${check.suggestedFix || check.expected}`) ?? [],
          requiresHuman: checkpoint?.status === "waiting_approval"
        });
      }

      const requiredItems = existingPlan.content.items.filter(
        (item) => item.required && item.assetType !== "voice"
      );
      let availableAssets = [...(episode.assets ?? [])];
      const resolvedIds = new Set(availableAssets.map((asset) => asset.planItemId).filter(Boolean));
      const missingItems = requiredItems.filter((item) => !resolvedIds.has(item.id));
      const localItemById = new Map(
        localCodeAssetItems(episode).map((item) => [item.id, item])
      );
      const localItems = new Set(localItemById.keys());
      const localCodeAssetOptions = context.localCodeAssetOptions ?? {};
      const localImplementation = localItems.size > 0
        ? await inspectLocalCodeImplementation(localCodeAssetOptions)
        : null;
      const buildableItems = missingItems.filter((item) => localItems.has(item.id));
      const staleLocalItemIds = new Set();
      for (const asset of availableAssets.filter((item) => localItems.has(item.planItemId))) {
        try {
          const absolutePath = ensureInside(publicRoot, resolve(publicRoot, asset.path));
          const actual = await inspectFileIntegrity(absolutePath);
          const planItem = localItemById.get(asset.planItemId);
          const expectedVisualContractHash = planItem?.visualContract
            ? integrityHash(planItem.visualContract)
            : null;
          if (
            actual.bytes !== asset.bytes ||
            actual.sha256 !== asset.sha256 ||
            asset.implementationSha256 !== localImplementation?.sha256 ||
            asset.assetPlanVersion !== episode.production.assetPlan.version ||
            asset.candidateHash !== episode.reviewCheckpoints?.assetExecution
              ?.currentCandidate?.candidateHash ||
            asset.visualContractHash !== expectedVisualContractHash
          ) {
            staleLocalItemIds.add(asset.planItemId);
          }
        } catch {
          staleLocalItemIds.add(asset.planItemId);
        }
      }
      if (buildableItems.length > 0 || staleLocalItemIds.size > 0) {
        const localAssets = await buildLocalCodeAssets(episode, {
          now: context.now,
          ...localCodeAssetOptions,
          implementation: localImplementation
        });
        const producedIds = new Set(localAssets.map((asset) => asset.planItemId));
        availableAssets = [
          ...availableAssets.filter((asset) => !producedIds.has(asset.planItemId)),
          ...localAssets
        ];
      }
      const externalItemIds = new Set(externalAssetItems(episode).map((item) => item.id));
      const resolvedBeforeExternal = new Set(
        availableAssets.map((asset) => asset.planItemId).filter(Boolean)
      );
      const missingExternalItems = requiredItems.filter((item) =>
        externalItemIds.has(item.id) && !resolvedBeforeExternal.has(item.id)
      );
      let externalExecution = null;
      if (missingExternalItems.length > 0) {
        if (!assetExecutionPreflightValid(episode)) {
          const preflight = episode.production?.assetExecutionPreflight;
          return outcome("blocked", "外部素材尚未通过与当前批准候选绑定的零生成预检", {
            artifacts: [existingPlan.artifactPath],
            findings: preflight?.failureSummary ?? [],
            requiresHuman: preflight?.blockerDisposition === "input_required"
          });
        }
        const requiredTools = requiredExternalAssetToolIds(episode);
        const missingTools = requiredTools.filter((toolId) =>
          !episode.control.allowedTools.includes(toolId) ||
          !context.toolIds.includes(toolId)
        );
        if (missingTools.length > 0) {
          return outcome("blocked", "外部素材工具尚未获得 Episode 与本次 Worker 双重授权", {
            artifacts: [existingPlan.artifactPath],
            findings: missingTools,
            requiresHuman: true
          });
        }
        try {
          externalExecution = await buildApprovedExternalAssets(episode, {
            ...externalAssetOptionsWithoutCapabilityAuthority(
              context.externalAssetOptions
            ),
            allowedToolIds: context.toolIds,
            sideEffectGrant: context.sideEffectGrant ?? undefined,
            capabilityOperation: "worker:asset-agent",
            requireSideEffectCapability: Boolean(context.sideEffectGrant),
            now: context.now
          });
        } catch (error) {
          return outcome(error?.requiresHuman ? "blocked" : "failed", error.message, {
            artifacts: [existingPlan.artifactPath],
            findings: [error?.code ?? "external_asset_execution_failed"],
            requiresHuman: Boolean(error?.requiresHuman)
          });
        }
        const producedIds = new Set(
          externalExecution.assets.map((asset) => asset.planItemId)
        );
        availableAssets = [
          ...availableAssets.filter((asset) => !producedIds.has(asset.planItemId)),
          ...externalExecution.assets
        ];
      }
      const resolvedAfterBuild = new Set(
        availableAssets.map((asset) => asset.planItemId).filter(Boolean)
      );
      const unresolvedItems = requiredItems.filter((item) => !resolvedAfterBuild.has(item.id));
      if (unresolvedItems.length > 0) {
        return outcome("blocked", `仍有 ${unresolvedItems.length} 项必需素材没有登记`, {
          artifacts: [existingPlan.artifactPath],
          findings: unresolvedItems.map((item) => `${item.id}：${item.purpose}`)
        });
      }

      const missingFiles = [];
      const changedFiles = [];
      for (const asset of availableAssets) {
        try {
          const absolutePath = ensureInside(publicRoot, resolve(publicRoot, asset.path));
          await access(absolutePath);
          const actual = await inspectFileIntegrity(absolutePath);
          if (actual.bytes !== asset.bytes || actual.sha256 !== asset.sha256) {
            changedFiles.push(asset.path);
          }
        } catch {
          missingFiles.push(asset.path);
        }
      }
      if (missingFiles.length > 0) return outcome("failed", `缺少素材文件：${missingFiles.join(", ")}`);
      if (changedFiles.length > 0) {
        return outcome("failed", `素材文件完整性已变化：${changedFiles.join(", ")}`);
      }
      const candidateEpisode = { ...episode, assets: availableAssets };
      const executedCalls = externalExecution?.executedCalls ?? 0;
      const accountedCalls = externalExecution?.accountedCalls ?? executedCalls;
      const accountedCallIds = new Set(externalExecution?.accountedCallIds ?? []);
      const accountedCostUsd = externalExecution?.accountedCostUsd ?? 0;
      return outcome("complete", `${availableAssets.length} 项素材已定位，进入旁白与素材总审`, {
        artifacts: [
          ...availableAssets.map((asset) => asset.path),
          ...(externalExecution?.receipts ?? [])
        ],
        patch: {
          assets: availableAssets,
          scenes: bindPlannedAssetsToScenes(candidateEpisode),
          ...(externalExecution
            ? {
                production: {
                  ai: {
                    ...(episode.production?.ai ?? {}),
                    requestCount: (episode.production?.ai?.requestCount ?? 0) + accountedCalls,
                    attempts: [
                      ...(episode.production?.ai?.attempts ?? []),
                      ...externalExecution.assets
                        .filter((asset) => accountedCallIds.has(asset.externalCallId))
                        .map((asset) => ({
                        providerId: asset.providerId,
                        model: asset.model,
                        callId: asset.externalCallId,
                        candidateHash: asset.candidateHash,
                        status: "completed",
                        receiptPath: asset.receiptPath
                        }))
                    ]
                  }
                },
                control: {
                  budget: {
                    ...(episode.control?.budget ?? {}),
                    usedCalls: (episode.control?.budget?.usedCalls ?? 0) + accountedCalls,
                    usedCostUsd: Number((
                      (episode.control?.budget?.usedCostUsd ?? 0) + accountedCostUsd
                    ).toFixed(6)),
                    overrun: Boolean(episode.control?.budget?.overrun)
                  }
                }
              }
            : {})
        }
      });
    }
  },
  "voice-agent": {
    id: "voice-agent",
    label: "旁白与素材确认 Agent",
    async run(episode, context = {}) {
      const allowsMutedProof = episode.previewMode === "visual-proof";
      const mutedProofApproved =
        allowsMutedProof && episode.approvals.assets.status === "approved";
      if (
        (episode.voice.status !== "ready" || !episode.voice.audioPath) &&
        !allowsMutedProof
      ) {
        const existingPlan = episode.production?.voicePlan;
        const plan =
          existingPlan?.artifactPath && !episode.voice?.needsRevision
            ? existingPlan
            : await createVoicePlan(episode, {
                writeArtifact: context.writeArtifact ?? undefined,
                sideEffectGrant: context.sideEffectGrant ?? undefined,
                requireSideEffectCapability: Boolean(context.sideEffectGrant),
                capabilityOperation: "worker:voice-agent"
              });
        const planState = existingPlan?.artifactPath && !episode.voice?.needsRevision
          ? existingPlan
          : {
              artifactPath: plan.relativePath,
              version: plan.version,
              generatedAt: new Date().toISOString(),
              versions: [
                ...(existingPlan?.versions ?? []),
                { version: plan.version, artifactPath: plan.relativePath, generatedAt: new Date().toISOString() }
              ]
            };
        return outcome("blocked", "请上传本人录音或已获授权的旁白文件，再进行素材总审", {
          artifacts: [planState.artifactPath],
          requiresHuman: true,
          patch: { production: { voicePlan: planState } }
        });
      }
      if (episode.approvals.assets.status !== "approved") {
        return outcome(
          "waiting_approval",
          allowsMutedProof && episode.voice.status !== "ready"
            ? "真实素材已就绪；本期为无旁白视觉验证版，请人工进行素材总审"
            : "素材和旁白已就绪，请人工进行素材总审",
          {
          requiresApproval: "assets",
          artifacts: [episode.voice.audioPath].filter(Boolean)
          }
        );
      }
      if (!mutedProofApproved) {
        try {
          await access(ensureInside(workspaceRoot, resolve(workspaceRoot, episode.voice.audioPath)));
        } catch {
          return outcome("failed", "旁白文件不存在");
        }
      }
      const quality = evaluateProductionQuality(episode, { stage: "voice" });
      if (!quality.passed) {
        return outcome("failed", `素材与旁白对齐未通过：${quality.errors.join("；")}`, {
          findings: quality.checks
        });
      }
      return outcome("complete", `素材与旁白已批准，对齐质量 ${quality.score} 分`, {
        findings: quality.checks,
        patch: { production: { quality: { assets: quality } } }
      });
    }
  },
  "render-agent": {
    id: "render-agent",
    label: "渲染 Agent",
    async run(episode, context) {
      if (episode.approvals.assets.status !== "approved") {
        return outcome("failed", "必须先人工批准素材与声音");
      }
      const result = await renderPreview(episode, context);
      const version = renderVersion(result.relativeOutputPath);
      const renderedAt = new Date().toISOString();
      return outcome("complete", `成片 v${version} 已生成`, {
        artifacts: [result.relativeOutputPath],
        patch: {
          render: {
            ...episode.render,
            version,
            versions: [
              ...(episode.render?.versions ?? []),
              {
                version,
                outputPath: result.relativeOutputPath,
                renderedAt,
                bytes: result.bytes,
                sha256: result.sha256
              }
            ],
            status: "complete",
            progress: 1,
            outputPath: result.relativeOutputPath,
            renderedAt,
            bytes: result.bytes,
            sha256: result.sha256,
            muted: episode.voice.status !== "ready",
            needsRevision: false
          },
          qa: { status: "pending", reportPath: null, checkedAt: null, checks: [] },
          approvals: {
            final: resetApprovalForVersion(episode.approvals.final, version)
          }
        }
      });
    }
  },
  "qa-agent": {
    id: "qa-agent",
    label: "QA Agent",
    async run(episode) {
      if (episode.approvals.final.status === "approved" && episode.qa.status === "passed") {
        return outcome("complete", "最终成片已通过 QA 和人工终审", {
          artifacts: [episode.qa.reportPath].filter(Boolean),
          findings: episode.qa.checks ?? []
        });
      }
      const report = await runPreviewQa(episode);
      const checkedAt = new Date().toISOString();
      return outcome("waiting_approval", report.summary, {
        requiresApproval: "final",
        artifacts: [report.relativeReportPath],
        findings: report.checks,
        patch: {
          qa: {
            status: report.passed ? "passed" : "failed",
            reportPath: report.relativeReportPath,
            checkedAt,
            checks: report.checks,
            quality: report.quality,
            history: [
              ...(episode.qa?.history ?? []),
              {
                renderVersion: episode.render?.version ?? null,
                reportPath: report.relativeReportPath,
                checkedAt,
                status: report.passed ? "passed" : "failed",
                bytes: report.video?.bytes ?? null,
                sha256: report.video?.sha256 ?? null
              }
            ]
          }
        }
      });
    }
  }
};

export function getAgent(agentId) {
  const agent = agents[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  return agent;
}
