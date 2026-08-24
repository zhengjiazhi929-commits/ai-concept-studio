import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { appendEvent, listEpisodes, readEpisode, writeEpisode } from "../shared/store.mjs";
import { ensureInside, workspaceRoot } from "../shared/paths.mjs";
import { APPROVAL_GATES } from "../shared/schema.mjs";
import { workerManifest } from "../shared/worker-manifests.mjs";
import {
  inspectFileIntegrity,
  isSha256,
  matchesFileIntegrity
} from "../shared/integrity.mjs";
import {
  ensureAgentArchitecture,
  validateRoutingDecision,
  validateWorkerMutation,
  validateWorkerResult
} from "../shared/agent-contracts.mjs";
import {
  redactSensitiveValue,
  safeErrorMessage,
  sanitizeAttemptRecords
} from "../shared/redaction.mjs";
import {
  applyApprovalDecision,
  currentGateArtifactHash,
  currentGateVersion,
  invalidateReviewForGate,
  resetApprovalForVersion
} from "../shared/workflow.mjs";
import { getAgent } from "./agents/registry.mjs";
import { reviewPassedForGate } from "./control/policy-engine.mjs";
import {
  assertWorkerRunAllowed,
  kernelSnapshot,
  recordRoutingOutcome
} from "./control/workflow-kernel.mjs";
import { readReviewConfig, reviewAgentOutput } from "./reviews/coordinator.mjs";
import { approvedAssetExecutionToolIds } from "./reviews/asset-execution-checkpoint.mjs";
import { recoverInterruptedPlan } from "./control/plan-store.mjs";
import { recoverInterruptedDispatch } from "./control/controlled-dispatch.mjs";
import {
  getAmbiguousBudgetReservationIds,
  markInterruptedBudgetReservationsAmbiguous
} from "./control/budget-ledger.mjs";
import {
  acquireEpisodeOperation,
  claimPersistedEpisodeOperation,
  isEpisodeOperationActive,
  releasePersistedEpisodeOperation
} from "./control/episode-operation-lock.mjs";
import {
  requireSideEffectGrant,
  SideEffectAuthorizationError
} from "./security/side-effect-capability.mjs";

function mergePatch(target, patch) {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch ?? {})) {
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? mergePatch(target?.[key] ?? {}, value)
        : value;
  }
  return result;
}

function assertValidWorkerOutput(output) {
  const validation = validateWorkerResult(output);
  if (!validation.valid) {
    throw new Error(`Worker 输出不符合合同：${validation.errors.join("；")}`);
  }
  return output;
}

function assertValidWorkerMutation(sourceEpisode, agentId, output) {
  const validation = validateWorkerMutation(sourceEpisode, agentId, output);
  if (!validation.valid) {
    throw new Error(`Worker 状态或补丁越权：${validation.errors.join("；")}`);
  }
  return output;
}

function workerExternalAssetOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sanitized = { ...value };
  delete sanitized.authorizeSideEffect;
  delete sanitized.sideEffectGrant;
  return sanitized;
}

function assertWorkerToolIdsAllowed(episode, agentId, toolIds = []) {
  if (!Array.isArray(toolIds)) {
    const error = new Error("Worker 工具授权必须是数组");
    error.code = "worker_tool_authorization_invalid";
    throw error;
  }
  const manifest = workerManifest(agentId);
  if (!manifest) {
    const error = new Error(`Worker Manifest 不存在：${agentId}`);
    error.code = "worker_manifest_missing";
    throw error;
  }
  const episodeTools = new Set(episode.control?.allowedTools ?? []);
  const approvedAssetTools = new Set(
    agentId === "asset-agent" ? approvedAssetExecutionToolIds(episode) : []
  );
  const normalized = [];
  for (const toolId of toolIds) {
    if (typeof toolId !== "string" || !toolId.trim()) {
      const error = new Error("Worker 工具授权包含无效工具 ID");
      error.code = "worker_tool_authorization_invalid";
      throw error;
    }
    if (!manifest.allowedTools.includes(toolId)) {
      const error = new Error(`Worker Manifest 未授权工具：${toolId}`);
      error.code = "worker_tool_not_in_manifest";
      throw error;
    }
    if (!episodeTools.has(toolId)) {
      const error = new Error(`Episode 未授权本次 Worker 工具：${toolId}`);
      error.code = "worker_tool_not_allowed_for_episode";
      throw error;
    }
    if (
      agentId === "asset-agent" &&
      toolId.endsWith(".generate") &&
      !approvedAssetTools.has(toolId)
    ) {
      const error = new Error(`素材执行候选未授权生成工具：${toolId}`);
      error.code = "worker_tool_not_approved_for_asset_candidate";
      throw error;
    }
    if (!normalized.includes(toolId)) normalized.push(toolId);
  }
  return normalized;
}

function workerSideEffectCapabilitySpec(episode, agentId, options = {}) {
  const manifest = workerManifest(agentId);
  if (!manifest) {
    throw new SideEffectAuthorizationError(
      `Worker Manifest 不存在：${agentId}`,
      "worker_manifest_missing",
      {},
      403
    );
  }
  const scopes = [...(manifest.sideEffectScopes ?? ["state.write"])];
  const paid = scopes.includes("paid.invoke") || scopes.includes("model.invoke");
  if (!paid) {
    return {
      episodeId: episode.id,
      operation: options.capabilityOperation ?? `worker:${agentId}`,
      scopes,
      maxCalls: 0,
      maxCostUsd: 0
    };
  }
  const budget = episode.control?.budget;
  if (!Number.isInteger(budget?.maxCalls) || !Number.isFinite(budget?.maxCostUsd)) {
    throw new SideEffectAuthorizationError(
      "真实模型 Worker 必须先配置有限的调用次数和费用预算",
      "side_effect_capability_budget_unbounded",
      {},
      403
    );
  }
  const remainingCalls = budget.maxCalls
    - (budget.usedCalls ?? 0)
    - (budget.reservedCalls ?? 0);
  const remainingCostUsd = Number((
    budget.maxCostUsd
    - (budget.usedCostUsd ?? 0)
    - (budget.reservedCostUsd ?? 0)
  ).toFixed(6));
  if (remainingCalls <= 0 || remainingCostUsd <= 0) {
    throw new SideEffectAuthorizationError(
      "真实模型 Worker 的调用次数或费用预算已经耗尽",
      "side_effect_capability_budget_exhausted",
      {},
      403
    );
  }
  const approvedExternalCalls = agentId === "asset-agent" &&
    Number.isInteger(
      episode.reviewCheckpoints?.assetExecution?.currentCandidate?.summary
        ?.externalApiCallCount
    )
    ? episode.reviewCheckpoints.assetExecution.currentCandidate.summary
        .externalApiCallCount
    : 0;
  const operationCallLimit = Math.max(1, approvedExternalCalls);
  return {
    episodeId: episode.id,
    operation: options.capabilityOperation ?? `worker:${agentId}`,
    scopes,
    maxCalls: Math.min(remainingCalls, operationCallLimit),
    maxCostUsd: remainingCostUsd
  };
}

function successfulProviderSettlementsAfter(episode, since) {
  const sinceMs = Date.parse(since ?? "");
  if (!Number.isFinite(sinceMs)) return [];
  return (episode.history ?? []).filter((entry) => (
    entry?.type === "budget-reservation-settled" &&
    entry?.status === "settled" &&
    entry?.settlementStatus === "completed_success" &&
    Number.isFinite(Date.parse(entry.at ?? "")) &&
    Date.parse(entry.at) >= sinceMs
  ));
}

function markReviewChecking(sourceEpisode, output) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  if (
    !episode.control.reviewEnabled ||
    output.status !== "waiting_approval" ||
    !output.requiresApproval
  ) {
    return episode;
  }
  const stage = output.requiresApproval;
  episode.reviews[stage] = {
    ...episode.reviews[stage],
    status: "checking",
    artifactVersion: currentGateVersion(episode, stage)
  };
  return episode;
}

function recoverCheckingReviews(sourceEpisode) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  const recoveredStages = [];
  for (const [stage, review] of Object.entries(episode.reviews)) {
    if (review.status !== "checking") continue;
    recoveredStages.push(stage);
    episode.reviews[stage] = {
      ...review,
      status: "not_started"
    };
  }
  return { episode, recoveredStages };
}

export async function reviewCandidateOutput(input, options = {}) {
  const output = assertValidWorkerOutput(input.output);
  const sourceEpisode = ensureAgentArchitecture(input.sourceEpisode);
  assertValidWorkerMutation(sourceEpisode, input.agentId, output);
  const candidateEpisode = ensureAgentArchitecture(
    input.candidateEpisode ?? mergePatch(sourceEpisode, output.patch)
  );
  const review = sourceEpisode.control.reviewEnabled
    ? await reviewAgentOutput(
        {
          sourceEpisode,
          candidateEpisode,
          agentId: input.agentId,
          output
        },
        options
      )
    : null;
  const adjustedOutput = assertValidWorkerOutput(review?.output ?? output);
  return {
    episode: ensureAgentArchitecture(mergePatch(candidateEpisode, adjustedOutput.patch)),
    output: adjustedOutput,
    review
  };
}

export function routeReviewRevision(sourceEpisode, currentAgentId, review) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  const targets = [...new Set(review?.revisionTargets ?? [])]
    .filter((agentId) => agentId !== currentAgentId);
  if (review?.report?.decision !== "revise" || targets.length === 0) return episode;
  const targetIndexes = targets
    .map((agentId) => episode.pipeline.findIndex((step) => step.agent === agentId))
    .filter((index) => index >= 0);
  if (targetIndexes.length !== targets.length) {
    throw new Error("机器审核指定了不存在的修改 Agent");
  }
  const restartIndex = Math.min(...targetIndexes);
  const summary = review.report.blockingIssues.map((issue) => issue.evidence).join("；");
  const routedAt = new Date().toISOString();
  episode.production = episode.production ?? {};
  episode.production.feedback = { ...(episode.production.feedback ?? {}) };
  for (const target of targets) {
    const manifest = workerManifest(target);
    const targetGate = manifest?.approvalResetGate ?? manifest?.gate ?? null;
    if (!targetGate) continue;
    const issues = review.report.blockingIssues.filter(
      (issue) => !issue.ownerAgentId || issue.ownerAgentId === target
    );
    episode.production.feedback[targetGate] = {
      text: structuredClone(issues),
      at: routedAt,
      version: currentGateVersion(episode, targetGate),
      sourceReviewReportId: review.report.id
    };
  }
  for (const definition of APPROVAL_GATES) {
    const gateStepIndex = episode.pipeline.findIndex((step) => step.id === definition.stepId);
    if (gateStepIndex < restartIndex) continue;
    episode.approvals[definition.id] = resetApprovalForVersion(
      episode.approvals[definition.id],
      currentGateVersion(episode, definition.id)
    );
    invalidateReviewForGate(episode, definition.id);
  }
  for (let index = restartIndex; index < episode.pipeline.length; index += 1) {
    const step = episode.pipeline[index];
    const isTarget = targets.includes(step.agent);
    episode.pipeline[index] = {
      ...step,
      status: isTarget ? "ready" : "pending",
      message: isTarget
        ? `机器审核已将问题退回本 Agent：${summary}`
        : "等待上游 Agent 完成机器审核修改",
      progress: 0,
      requiresApproval: null,
      requiresHuman: false,
      finishedAt: null,
      lastError: null
    };
  }
  return episode;
}

export async function recheckGateReview(episodeId, gate, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const releaseOperation = acquireEpisodeOperation(episodeId, `review-recheck:${gate}`, {
    conflictMessage: "这一期已有 Agent 正在运行，暂时不能重新审核"
  });
  const operationId = `operation:review-recheck:${episodeId}:${gate}:${randomUUID()}`;
  let operationClaimed = false;

  try {
    const sourceEpisode = ensureAgentArchitecture(await readState(episodeId));
    const stepIndex = sourceEpisode.pipeline.findIndex((step) => step.gate === gate);
    const step = sourceEpisode.pipeline[stepIndex];
    if (!step) throw new Error(`Episode 没有 ${gate} 审批阶段`);
    if (step.status !== "waiting_approval") {
      throw new Error("只有等待人工审批的候选产物可以重新审核");
    }
    if (sourceEpisode.approvals?.[gate]?.status === "approved") {
      throw new Error("已批准版本不能原地重新审核，请先显式驳回并生成新版本");
    }
    if (!sourceEpisode.control.reviewEnabled) {
      throw new Error("当前 Episode 未启用机器审核");
    }

    claimPersistedEpisodeOperation(sourceEpisode, {
      id: operationId,
      kind: `review-recheck:${gate}`
    });
    operationClaimed = true;
    const output = assertValidWorkerOutput({
      status: "waiting_approval",
      message: step.message || `${gate} 候选产物等待审批`,
      artifacts: [...(step.artifacts ?? [])],
      findings: [...(step.findings ?? [])],
      requiresApproval: gate,
      requiresHuman: false,
      patch: {}
    });
    const candidateEpisode = markReviewChecking(sourceEpisode, output);
    candidateEpisode.updatedAt = new Date().toISOString();
    await writeState(candidateEpisode);
    await recordEvent({
      type: "review.recheck_started",
      episodeId,
      agentId: step.agent,
      gate,
      message: `${gate} 候选产物按当前审核规则重新检查`
    });

    const evaluated = await reviewCandidateOutput(
      {
        sourceEpisode,
        candidateEpisode,
        agentId: step.agent,
        output
      },
      {
        ...(options.review ?? {}),
        expectedReviewProfile: options.reviewProfile ?? null
      }
    );
    let episode = evaluated.episode;
    const reviewedStepIndex = episode.pipeline.findIndex((item) => item.gate === gate);
    const reviewedStep = episode.pipeline[reviewedStepIndex];
    episode.pipeline[reviewedStepIndex] = {
      ...reviewedStep,
      status: evaluated.output.status,
      message: evaluated.output.message,
      artifacts: evaluated.output.artifacts ?? [],
      findings: evaluated.output.findings ?? [],
      requiresApproval: evaluated.output.requiresApproval ?? null,
      requiresHuman: evaluated.output.requiresHuman ?? false,
      lastRunAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      lastError: null
    };
    episode = routeReviewRevision(episode, step.agent, evaluated.review);
    episode.history.push({
      at: new Date().toISOString(),
      type: "review-recheck",
      agentId: step.agent,
      gate,
      status: evaluated.review?.report.decision ?? "skipped",
      message: evaluated.output.message,
      reviewReportId: evaluated.review?.report.id ?? null
    });
    releasePersistedEpisodeOperation(episode, operationId);
    episode.updatedAt = new Date().toISOString();
    await writeState(episode);
    operationClaimed = false;
    await recordEvent({
      type: "review.recheck_completed",
      episodeId,
      agentId: step.agent,
      gate,
      status: evaluated.review?.report.decision ?? "skipped",
      message: `重新审核结果：${evaluated.review?.report.decision ?? "skipped"}`
    });
    return { episode, output: evaluated.output, review: evaluated.review };
  } catch (error) {
    if (operationClaimed) {
      const current = await readState(episodeId).catch(() => null);
      if (current) {
        const recovered = recoverCheckingReviews(current).episode;
        releasePersistedEpisodeOperation(recovered, operationId);
        recovered.updatedAt = new Date().toISOString();
        await writeState(recovered);
      }
    }
    throw error;
  } finally {
    releaseOperation();
  }
}

export async function runAgent(episodeId, agentId, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const releaseOperation = acquireEpisodeOperation(episodeId, `worker:${agentId}`, {
    conflictMessage: "这一期已有 Agent 正在运行，请等待它完成"
  });
  const operationId = `operation:worker:${episodeId}:${agentId}:${randomUUID()}`;
  let operationClaimed = false;

  try {
    const initialEpisode = ensureAgentArchitecture(await readState(episodeId));
    const initialStep = initialEpisode.pipeline.find((step) => step.agent === agentId);
    if (!initialStep) throw new Error(`Episode has no step for ${agentId}`);
    assertWorkerRunAllowed(initialEpisode, agentId, { initiator: options.initiator });
    const defaultStateDependencies =
      options.readEpisode === undefined &&
      options.writeEpisode === undefined &&
      options.appendEvent === undefined;
    const capabilityRequired = options.requireSideEffectCapability === true
      || defaultStateDependencies;
    if (
      capabilityRequired &&
      !options.sideEffectGrant &&
      typeof options.authorizeSideEffect !== "function"
    ) {
      throw new SideEffectAuthorizationError(
        "缺少服务端签发的副作用 Capability",
        "side_effect_capability_missing",
        {},
        403
      );
    }
    let sideEffectGrant = options.sideEffectGrant ?? null;
    if (capabilityRequired) {
      sideEffectGrant = requireSideEffectGrant(options, workerSideEffectCapabilitySpec(
        initialEpisode,
        agentId,
        options
      ));
    }
    const workerToolIds = assertWorkerToolIdsAllowed(
      initialEpisode,
      agentId,
      options.toolIds ?? []
    );
    claimPersistedEpisodeOperation(initialEpisode, {
      id: operationId,
      kind: `worker:${agentId}`
    });
    let episode = initialEpisode;
    const stepIndex = episode.pipeline.findIndex((step) => step.agent === agentId);
    if (stepIndex === -1) throw new Error(`Episode has no step for ${agentId}`);

    const step = episode.pipeline[stepIndex];
    episode.pipeline[stepIndex] = {
      ...step,
      status: "running",
      message: "正在运行",
      progress: 0,
      startedAt: new Date().toISOString(),
      attempts: (step.attempts ?? 0) + 1,
      lastError: null
    };
    episode.updatedAt = new Date().toISOString();
    await writeState(episode);
    operationClaimed = true;
    await recordEvent({
      type: "agent.started",
      episodeId,
      agentId,
      message: `${step.label}开始运行`
    });

    const agent = options.agent ?? getAgent(agentId);
    let revisionFeedback = [];
    let automaticRevisionAttempts = 0;
    while (true) {
      let progressUpdates = Promise.resolve();
      let progressReportingOpen = true;
      const reportProgress = (progress, message) => {
        if (!progressReportingOpen) return Promise.resolve();
        const update = progressUpdates.then(async () => {
          const current = await readState(episodeId);
          if (current.control?.activeOperation?.id !== operationId) return;
          const index = current.pipeline.findIndex((item) => item.agent === agentId);
          if (index < 0 || current.pipeline[index].status !== "running") return;
          current.pipeline[index] = { ...current.pipeline[index], progress, message };
          current.updatedAt = new Date().toISOString();
          await writeState(current);
        });
        progressUpdates = update;
        // Worker callbacks are allowed to be fire-and-forget. Keep the rejection
        // observed here and surface it when the worker finishes and the queue drains.
        void update.catch(() => undefined);
        return update;
      };

      let workerResult;
      try {
        workerResult = await agent.run(episode, {
          reviewFeedback: revisionFeedback,
          aiClient: options.aiClient ?? null,
          taskProfile: options.taskProfile ?? null,
          reviewProfile: options.reviewProfile ?? null,
          toolIds: [...workerToolIds],
          limits: options.limits ? structuredClone(options.limits) : null,
          writeArtifact: options.writeArtifact ?? null,
          readFile: options.readFile ?? null,
          inspectFileIntegrity: options.inspectFileIntegrity ?? null,
          externalAssetOptions: workerExternalAssetOptions(options.externalAssetOptions),
          sideEffectGrant,
          now: options.now ?? null,
          onProgress: reportProgress
        });
      } catch (error) {
        progressReportingOpen = false;
        await progressUpdates.catch(() => undefined);
        throw error;
      }
      progressReportingOpen = false;
      await progressUpdates;
      const rawOutput = assertValidWorkerOutput(workerResult);

      const persisted = await readState(episodeId);
      assertValidWorkerMutation(persisted, agentId, rawOutput);
      let candidateEpisode = ensureAgentArchitecture(mergePatch(persisted, rawOutput.patch));
      candidateEpisode = markReviewChecking(candidateEpisode, rawOutput);
      if (
        candidateEpisode.control.reviewEnabled &&
        rawOutput.status === "waiting_approval" &&
        rawOutput.requiresApproval
      ) {
        candidateEpisode.updatedAt = new Date().toISOString();
        await writeState(candidateEpisode);
        await recordEvent({
          type: "review.started",
          episodeId,
          agentId,
          gate: rawOutput.requiresApproval,
          message: `${rawOutput.requiresApproval} 候选产物开始机器审核`
        });
      }

      const evaluated = await reviewCandidateOutput(
        {
          sourceEpisode: persisted,
          candidateEpisode,
          agentId,
          output: rawOutput
        },
        {
          ...(options.review ?? {}),
          expectedReviewProfile: options.reviewProfile ?? null
        }
      );
      const output = evaluated.output;
      episode = evaluated.episode;
      const finalStepIndex = episode.pipeline.findIndex((item) => item.agent === agentId);
      episode.pipeline[finalStepIndex] = {
        ...episode.pipeline[finalStepIndex],
        status: output.status,
        message: output.message,
        progress: output.status === "complete" ? 1 : episode.pipeline[finalStepIndex].progress,
        lastRunAt: new Date().toISOString(),
        artifacts: output.artifacts ?? [],
        findings: output.findings ?? [],
        requiresApproval: output.requiresApproval ?? null,
        requiresHuman: output.requiresHuman ?? false,
        finishedAt: new Date().toISOString(),
        lastError: output.status === "failed" ? output.message : null
      };
      episode = routeReviewRevision(episode, agentId, evaluated.review);
      if (output.status === "complete") {
        const nextIndex = finalStepIndex + 1;
        if (episode.pipeline[nextIndex]?.status === "pending") {
          episode.pipeline[nextIndex] = {
            ...episode.pipeline[nextIndex],
            status: "ready",
            message: "上一步已完成，可以运行"
          };
        }
      }
      if (agentId === "render-agent" && output.status === "complete") {
        episode.qa = {
          status: "pending",
          reportPath: null,
          checkedAt: null,
          checks: [],
          quality: null,
          history: [...(episode.qa?.history ?? [])]
        };
        episode.approvals.final = resetApprovalForVersion(
          episode.approvals.final,
          currentGateVersion(episode, "final")
        );
        invalidateReviewForGate(episode, "final");
        const qaIndex = episode.pipeline.findIndex((item) => item.agent === "qa-agent");
        if (qaIndex >= 0) {
          episode.pipeline[qaIndex] = {
            ...episode.pipeline[qaIndex],
            status: "ready",
            message: "新版本预览已生成，可以执行技术质量检查",
            progress: 0,
            artifacts: [],
            findings: [],
            requiresApproval: null,
            requiresHuman: false,
            finishedAt: null,
            lastError: null
          };
        }
      }
      episode.history.push({
        at: new Date().toISOString(),
        type: "agent-run",
        agentId,
        status: output.status,
        message: output.message,
        reviewReportId: evaluated.review?.report.id ?? null
      });
      episode.updatedAt = new Date().toISOString();
      await writeState(episode);

      if (evaluated.review) {
        await recordEvent({
          type: "review.completed",
          episodeId,
          agentId,
          gate: evaluated.review.report.stage,
          status: evaluated.review.report.decision,
          message: `机器审核结果：${evaluated.review.report.decision}`
        });
        const crossAgentTargets = evaluated.review.revisionTargets.filter(
          (target) => target !== agentId
        );
        if (evaluated.review.report.decision === "revise" && crossAgentTargets.length > 0) {
          await recordEvent({
            type: "review.revision_routed",
            episodeId,
            agentId,
            gate: evaluated.review.report.stage,
            targets: crossAgentTargets,
            message: `机器审核问题已退回：${crossAgentTargets.join("、")}`
          });
        }
      }

      const revisionLimit = Math.min(
        episode.control?.revisionLimit ?? 2,
        Number.isInteger(options.limits?.maxRevisionRounds)
          ? options.limits.maxRevisionRounds
          : Number.POSITIVE_INFINITY
      );
      const maximumWorkerAttempts = Number.isInteger(options.limits?.maxAttempts)
        ? options.limits.maxAttempts
        : Number.POSITIVE_INFINITY;
      if (
        evaluated.review?.shouldAutoRevise &&
        automaticRevisionAttempts < revisionLimit &&
        automaticRevisionAttempts + 1 < maximumWorkerAttempts
      ) {
        automaticRevisionAttempts += 1;
        revisionFeedback = evaluated.review.report.blockingIssues;
        episode.pipeline[finalStepIndex] = {
          ...episode.pipeline[finalStepIndex],
          status: "running",
          message: `根据机器审核自动修改（${automaticRevisionAttempts}/${revisionLimit}）`,
          progress: 0,
          attempts: (episode.pipeline[finalStepIndex].attempts ?? 0) + 1,
          finishedAt: null,
          requiresHuman: false
        };
        episode.updatedAt = new Date().toISOString();
        await writeState(episode);
        await recordEvent({
          type: "agent.revision_started",
          episodeId,
          agentId,
          gate: evaluated.review.report.stage,
          message: `开始第 ${automaticRevisionAttempts} 轮自动修改`
        });
        continue;
      }

      releasePersistedEpisodeOperation(episode, operationId);
      await writeState(episode);
      operationClaimed = false;
      await recordEvent({
        type: "agent.finished",
        episodeId,
        agentId,
        status: output.status,
        message: output.message
      });
      return { episode, output, review: evaluated.review };
    }
  } catch (error) {
    const loadedEpisode = await readState(episodeId).catch(() => null);
    let episode = loadedEpisode ? recoverCheckingReviews(loadedEpisode).episode : null;
    const runningStep = episode?.pipeline.find((item) => item.agent === agentId);
    const uncommittedProviderResults = successfulProviderSettlementsAfter(
      episode ?? {},
      runningStep?.startedAt
    );
    const providerResultCommitUnknown = uncommittedProviderResults.length > 0;
    const pausedForHuman = providerResultCommitUnknown
      || error?.requiresHuman === true
      || error?.code === "manual_intervention_required"
      || error?.code === "provider_call_ambiguous";
    const failureCode = providerResultCommitUnknown
      ? "provider_result_commit_unknown"
      : typeof error?.code === "string" && error.code.trim()
        ? error.code.trim().slice(0, 120)
        : null;
    const reservationId = typeof error?.details?.reservationId === "string"
      ? error.details.reservationId.trim().slice(0, 200)
      : "";
    const reservationIds = reservationId
      ? [reservationId]
      : uncommittedProviderResults.map((entry) => entry.reservationId);
    const failureMessage = providerResultCommitUnknown
      ? "Provider 已成功结算，但产物与 Episode 是否完成提交无法确认；已禁止自动重试，必须人工核对"
      : safeErrorMessage(error, "Agent 运行失败");
    const safeAttempts = sanitizeAttemptRecords(Array.isArray(error?.attempts) ? error.attempts : []);
    if (episode && operationClaimed) {
      if (error?.routingDecision) {
        const routingDecision = redactSensitiveValue(error.routingDecision);
        const validation = validateRoutingDecision(routingDecision);
        if (validation.valid) {
          episode = recordRoutingOutcome(episode, routingDecision, {
            callCount: safeAttempts.length,
            costUsd: routingDecision.outcome?.actualCostUsd
              ?? routingDecision.outcome?.accountedCostUsd
              ?? routingDecision.outcome?.estimatedCostUsd
              ?? 0
          });
        }
      }
      const index = episode.pipeline.findIndex((item) => item.agent === agentId);
      if (index >= 0) {
        const failureAt = new Date().toISOString();
        const requiresHumanAdded = pausedForHuman
          && episode.pipeline[index].requiresHuman !== true;
        episode.pipeline[index] = {
          ...episode.pipeline[index],
          status: pausedForHuman ? "blocked" : "failed",
          message: failureMessage,
          lastRunAt: failureAt,
          finishedAt: failureAt,
          lastError: failureCode ?? failureMessage,
          requiresHuman: pausedForHuman,
          attemptLog: safeAttempts,
          ...(reservationId ? { ambiguousReservationIds: reservationIds } : {}),
          ...(providerResultCommitUnknown
            ? { uncommittedProviderResultIds: reservationIds }
            : {})
        };
        if (safeAttempts.length > 0) {
          episode.production = episode.production ?? {};
          episode.production.ai = {
            ...(episode.production.ai ?? {}),
            attempts: [...(episode.production.ai?.attempts ?? []), ...safeAttempts],
            pausedAt: new Date().toISOString(),
            pauseReason: failureMessage
          };
        }
        episode.history.push({
          at: failureAt,
          type: "agent-run",
          agentId,
          status: pausedForHuman ? "blocked" : "failed",
          failureCode,
          reservationId: reservationId || null,
          reservationIds,
          requiresHumanAdded,
          message: failureMessage
        });
        episode.updatedAt = new Date().toISOString();
        releasePersistedEpisodeOperation(episode, operationId);
        await writeState(episode);
        operationClaimed = false;
      }
    }
    await recordEvent({
      type: pausedForHuman ? "agent.paused" : "agent.failed",
      episodeId,
      agentId,
      failureCode,
      reservationId: reservationId || null,
      message: failureMessage
    });
    throw error;
  } finally {
    releaseOperation();
  }
}

export async function runNextReadyAgent(episodeId, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const episode = await readState(episodeId);
  if (!episode.control.fixedFallbackEnabled) {
    throw new Error("固定调度回退路径当前未启用");
  }
  const legal = kernelSnapshot(episode).legalActions.find(
    (action) => action.action === "run_worker"
  );
  if (!legal) throw new Error("当前没有可以自动运行的下一步");
  const kernelToolIds = [...(legal.toolIds ?? [])];
  let toolIds = kernelToolIds;
  if (options.toolIds !== undefined) {
    if (!Array.isArray(options.toolIds)) {
      const error = new Error("固定回退 Worker 工具授权必须是数组");
      error.code = "worker_tool_authorization_invalid";
      throw error;
    }
    const requestedToolIds = [...new Set(options.toolIds)];
    const expanded = requestedToolIds.filter((toolId) => !kernelToolIds.includes(toolId));
    const missing = legal.workerId === "asset-agent"
      ? kernelToolIds.filter((toolId) => !requestedToolIds.includes(toolId))
      : [];
    if (expanded.length > 0 || missing.length > 0) {
      const error = new Error("本次 Worker 工具集合与 Workflow Kernel 授权不一致");
      error.code = "worker_tool_authorization_mismatch";
      throw error;
    }
    toolIds = requestedToolIds;
  }
  return runAgent(episodeId, legal.workerId, { ...options, toolIds });
}

export async function getWorkflowState(episodeId, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const episode = await readState(episodeId);
  return kernelSnapshot(episode, {
    activeRun: isEpisodeOperationActive(episodeId) || Boolean(episode.control.activeOperation)
  });
}

export function exactApprovalBinding(episode, gate) {
  return {
    artifactVersion: currentGateVersion(episode, gate),
    artifactHash: currentGateArtifactHash(episode, gate),
    reviewReportId: episode.reviews?.[gate]?.latestReportId ?? null
  };
}

export function assertExactApprovalBinding(episode, gate, input = {}) {
  if (!APPROVAL_GATES.some((definition) => definition.id === gate)) {
    const error = new Error(`未知人工审批 Gate：${gate}`);
    error.code = "approval_gate_not_found";
    error.statusCode = 404;
    throw error;
  }
  const expected = exactApprovalBinding(episode, gate);
  const provided = input && typeof input === "object" && !Array.isArray(input)
    ? {
        artifactVersion: input.artifactVersion,
        artifactHash: input.artifactHash,
        reviewReportId: input.reviewReportId
      }
    : { artifactVersion: null, artifactHash: null, reviewReportId: null };
  const complete = Boolean(
    Number.isInteger(provided.artifactVersion)
    && /^[a-f0-9]{64}$/u.test(String(provided.artifactHash ?? ""))
    && typeof provided.reviewReportId === "string"
    && provided.reviewReportId.trim()
    && Number.isInteger(expected.artifactVersion)
    && /^[a-f0-9]{64}$/u.test(String(expected.artifactHash ?? ""))
    && typeof expected.reviewReportId === "string"
    && expected.reviewReportId.trim()
  );
  if (
    !complete
    || provided.artifactVersion !== expected.artifactVersion
    || provided.artifactHash !== expected.artifactHash
    || provided.reviewReportId !== expected.reviewReportId
  ) {
    const error = new Error("人工审批请求没有精确绑定当前产物版本、哈希和机器审核报告");
    error.code = `${gate}_approval_binding_conflict`;
    error.statusCode = 409;
    throw error;
  }
  return expected;
}

export async function approveGate(episodeId, gate, input = {}, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const sourceEpisode = await readState(episodeId);
  assertExactApprovalBinding(sourceEpisode, gate, input);
  const note = String(input.note ?? "").trim();
  const reviewStep = sourceEpisode.pipeline.find((step) => step.gate === gate);
  const finalReady = gate === "final" && sourceEpisode.qa.status === "passed";
  if (reviewStep?.status !== "waiting_approval" && !finalReady) {
    throw new Error("当前版本尚未进入人工审批状态");
  }
  if (sourceEpisode.control?.reviewEnabled) {
    const config = await readReviewConfig(options.review ?? {});
    const review = sourceEpisode.reviews?.[gate];
    const report = review?.reports?.find((item) => item.id === review.latestReportId) ?? null;
    const expectedRubricVersion = config.stages?.[gate]?.version;
    if (
      !report ||
      report.reviewConfigVersion !== config.version ||
      report.rubricVersion !== expectedRubricVersion
    ) {
      throw new Error("机器审核规则已更新，当前候选必须按最新规则重新审核后才能批准");
    }
  }
  if (!reviewPassedForGate(sourceEpisode, gate)) {
    throw new Error("当前产物版本尚未通过机器审核，不能进入人工批准");
  }
  if (
    gate === "research" &&
    sourceEpisode.research &&
    !sourceEpisode.research.readiness?.readyForFactApproval
  ) {
    throw new Error("研究证据尚未达到审批门槛，不能批准");
  }
  if (gate === "assets") {
    const hasAssets = (sourceEpisode.assets?.length ?? 0) > 0;
    const voiceReady = sourceEpisode.voice?.status === "ready" && sourceEpisode.voice?.audioPath;
    if (!hasAssets) throw new Error("请先登记并核验本期素材，再批准素材方案");
    if (!voiceReady && sourceEpisode.previewMode !== "visual-proof") {
      throw new Error("请先上传可试听的旁白文件，再批准素材与声音方案");
    }
    sourceEpisode.assets = sourceEpisode.assets.map((asset) => ({
      ...asset,
      verified: true,
      verifiedAt: new Date().toISOString()
    }));
  }
  if (gate === "final" && sourceEpisode.qa.status !== "passed") {
    throw new Error("最终成片尚未通过 QA，不能批准");
  }
  if (gate === "final") {
    await assertCurrentRenderIntegrity(sourceEpisode, {
      inspectFileIntegrity: options.inspectFileIntegrity
    });
  }
  const { episode } = applyApprovalDecision(sourceEpisode, {
    gate,
    decision: "approved",
    note,
    actor: options.actor
  });
  await writeState(episode);
  await recordEvent({
    type: "approval.granted",
    episodeId,
    gate,
    actor: options.actor ?? null,
    message: note || `${gate} 已批准`
  });
  return episode;
}

export async function rejectGate(episodeId, gate, input = {}, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const sourceEpisode = await readState(episodeId);
  assertExactApprovalBinding(sourceEpisode, gate, input);
  const feedbackText = String(input.feedback ?? "").trim();
  const reviewStep = sourceEpisode.pipeline.find((step) => step.gate === gate);
  if (
    reviewStep?.status !== "waiting_approval" &&
    sourceEpisode.approvals?.[gate]?.status !== "approved"
  ) {
    throw new Error("当前阶段没有可驳回的版本");
  }
  const { episode, record } = applyApprovalDecision(sourceEpisode, {
    gate,
    decision: "rejected",
    note: feedbackText,
    actor: options.actor
  });
  await writeState(episode);
  await recordEvent({
    type: "approval.rejected",
    episodeId,
    gate,
    actor: options.actor ?? null,
    message: `已驳回 ${gate} v${record.version ?? "?"}：${record.note}`
  });
  return episode;
}

export function isRunning(episodeId, agentId) {
  return isEpisodeOperationActive(episodeId);
}

export async function assertCurrentRenderIntegrity(episode, options = {}) {
  if (!episode.render?.outputPath) {
    const error = new Error("最终成片缺少可校验的文件路径");
    error.code = "render_integrity_unavailable";
    throw error;
  }
  if (
    !Number.isSafeInteger(episode.render?.bytes) ||
    episode.render.bytes <= 50_000 ||
    !isSha256(episode.render?.sha256)
  ) {
    const error = new Error("最终成片尚未登记有效的字节数和 SHA-256，必须重新 QA");
    error.code = "render_integrity_unrecorded";
    throw error;
  }
  const absolutePath = ensureInside(
    workspaceRoot,
    resolve(workspaceRoot, episode.render.outputPath)
  );
  const inspect = options.inspectFileIntegrity ?? inspectFileIntegrity;
  const actual = await inspect(absolutePath);
  if (!matchesFileIntegrity(episode.render, actual)) {
    const error = new Error("最终成片文件与机器审核通过的文件摘要不一致，必须重新渲染或 QA");
    error.code = "render_integrity_mismatch";
    throw error;
  }
  return actual;
}

export function recoverInterruptedEpisode(sourceEpisode, now = new Date()) {
  const checking = recoverCheckingReviews(sourceEpisode);
  const planning = recoverInterruptedPlan(checking.episode, { now });
  const dispatching = recoverInterruptedDispatch(planning.episode, { now });
  const budgetRecovery = markInterruptedBudgetReservationsAmbiguous(
    dispatching.episode,
    { now }
  );
  const episode = budgetRecovery.episode;
  const at = now.toISOString();
  const recoveredAgents = [];
  const recoveredBudgetReservations = budgetRecovery.reservationIds;
  const ambiguousBudgetReservations = getAmbiguousBudgetReservationIds(episode);
  const hasAmbiguousProviderCalls = ambiguousBudgetReservations.length > 0;
  const recoveredOperation = episode.control.activeOperation
    ? structuredClone(episode.control.activeOperation)
    : null;
  const planningProviderResults = recoveredOperation?.kind === "main-agent-planning"
    ? successfulProviderSettlementsAfter(episode, recoveredOperation.startedAt)
    : [];
  if (planningProviderResults.length > 0) {
    episode.control.budget.overrun = true;
    episode.history.push({
      at,
      type: "provider-result-commit-unknown",
      status: "blocked",
      agentId: "main-agent",
      failureCode: "provider_result_commit_unknown",
      reservationIds: planningProviderResults.map((entry) => entry.reservationId),
      message:
        "Main Agent 的 Provider 结果已成功结算，但计划是否完成提交无法确认；已禁止自动重试"
    });
  }
  if (recoveredOperation) {
    episode.control.activeOperation = null;
    episode.history.push({
      at,
      type: "operation-recovered",
      status: "released",
      message: `进程中断后释放未完成操作：${recoveredOperation.kind}`
    });
  }
  for (let index = 0; index < episode.pipeline.length; index += 1) {
    const step = episode.pipeline[index];
    if (step.status !== "running") continue;
    const uncommittedProviderResults = successfulProviderSettlementsAfter(
      episode,
      step.startedAt
    );
    const providerResultCommitUnknown = uncommittedProviderResults.length > 0;
    const requiresHuman = hasAmbiguousProviderCalls
      || providerResultCommitUnknown
      || step.requiresHuman === true;
    const requiresHumanAdded = requiresHuman && step.requiresHuman !== true;
    const failureCode = hasAmbiguousProviderCalls
      ? "provider_call_ambiguous"
      : providerResultCommitUnknown
        ? "provider_result_commit_unknown"
        : "process_interrupted";
    const reservationIds = hasAmbiguousProviderCalls
      ? [...ambiguousBudgetReservations]
      : uncommittedProviderResults.map((entry) => entry.reservationId);
    recoveredAgents.push(step.agent);
    episode.pipeline[index] = {
      ...step,
      status: "failed",
      progress: 0,
      message: hasAmbiguousProviderCalls
        ? "上次运行在 Provider 调用结算前中断，必须先人工核对调用结果和费用"
        : providerResultCommitUnknown
          ? "Provider 已成功结算，但产物与 Episode 是否完成提交无法确认；必须人工核对，不能自动重试"
          : "上次运行被进程中断，可以安全重试",
      finishedAt: at,
      lastRunAt: at,
      lastError: failureCode,
      requiresHuman,
      ...(providerResultCommitUnknown
        ? { uncommittedProviderResultIds: reservationIds }
        : {})
    };
    episode.history.push({
      at,
      type: "agent-recovered",
      agentId: step.agent,
      status: "failed",
      failureCode,
      reservationIds,
      requiresHumanAdded,
      message: hasAmbiguousProviderCalls
        ? "检测到未结算 Provider 调用，Worker 重试和预算已冻结等待人工核对"
        : providerResultCommitUnknown
          ? "检测到已结算但未确认提交的 Provider 结果，Worker 已冻结等待人工核对"
          : "检测到未完成运行，已恢复为可重试状态"
    });
  }
  if (recoveredAgents.length > 0) episode.updatedAt = at;
  if (checking.recoveredStages.length > 0) episode.updatedAt = at;
  if (recoveredOperation) episode.updatedAt = at;
  if (recoveredBudgetReservations.length > 0) episode.updatedAt = at;
  return {
    episode,
    recoveredAgents,
    recoveredReviewStages: checking.recoveredStages,
    recoveredOperation,
    recoveredBudgetReservations,
    ambiguousBudgetReservations,
    uncommittedProviderResultIds: [
      ...planningProviderResults.map((entry) => entry.reservationId),
      ...episode.pipeline.flatMap((step) => step.uncommittedProviderResultIds ?? [])
    ],
    recoveredPlan: planning.recovered,
    recoveredDispatch: dispatching.recovered
  };
}

export async function recoverInterruptedRuns(options = {}) {
  const now = options.now ?? new Date();
  const episodes = await listEpisodes();
  const recovered = [];
  for (const sourceEpisode of episodes) {
    const interrupted = recoverInterruptedEpisode(sourceEpisode, now);
    const artifacts = await reconcileEpisodeArtifacts(interrupted.episode, {
      now,
      access: options.access
    });
    if (
      interrupted.recoveredAgents.length === 0 &&
      interrupted.recoveredReviewStages.length === 0 &&
      !interrupted.recoveredOperation &&
      interrupted.recoveredBudgetReservations.length === 0 &&
      !interrupted.recoveredPlan &&
      !interrupted.recoveredDispatch &&
      !artifacts.changed
    ) continue;
    await writeEpisode(artifacts.episode);
    for (const agentId of interrupted.recoveredAgents) {
      await appendEvent({
        type: "agent.recovered",
        episodeId: sourceEpisode.id,
        agentId,
        message: interrupted.ambiguousBudgetReservations.length > 0
          ? "进程中断的任务已恢复，但 Provider 调用仍有歧义，必须人工对账后再重试"
          : interrupted.uncommittedProviderResultIds.length > 0
            ? "Provider 已成功结算但产物提交状态不明，任务已冻结，禁止自动重试"
            : "进程中断的任务已恢复，可从失败状态重试"
      });
    }
    for (const stage of interrupted.recoveredReviewStages) {
      await appendEvent({
        type: "review.recovered",
        episodeId: sourceEpisode.id,
        gate: stage,
        message: "中断的机器审核已恢复为可安全重试状态"
      });
    }
    if (interrupted.recoveredBudgetReservations.length > 0) {
      await appendEvent({
        type: "budget.reservations.ambiguous",
        episodeId: sourceEpisode.id,
        status: "ambiguous",
        message:
          `已冻结 ${interrupted.recoveredBudgetReservations.length} 项中断的 Provider 调用预算，等待人工核对后显式结算`
      });
    }
    if (interrupted.recoveredOperation) {
      await appendEvent({
        type: "operation.recovered",
        episodeId: sourceEpisode.id,
        message: `已释放中断的 ${interrupted.recoveredOperation.kind} 操作锁`
      });
    }
    if (interrupted.uncommittedProviderResultIds.length > 0) {
      await appendEvent({
        type: "provider.result_commit_unknown",
        episodeId: sourceEpisode.id,
        status: "blocked",
        reservationIds: interrupted.uncommittedProviderResultIds,
        message:
          "Provider 已成功结算但本地产物提交状态不明；必须人工核对，禁止自动重复调用"
      });
    }
    if (interrupted.recoveredPlan) {
      await appendEvent({
        type: "main-agent.plan.recovered",
        episodeId: sourceEpisode.id,
        message: interrupted.uncommittedProviderResultIds.length > 0
          ? "中断的 Main Agent 计划包含已结算但未确认提交的 Provider 结果，已禁止自动重试"
          : "中断的 Main Agent 计划已恢复为失败记录，可安全重试"
      });
    }
    if (interrupted.recoveredDispatch) {
      await appendEvent({
        type: "main-agent.dispatch.recovered",
        episodeId: sourceEpisode.id,
        message: "中断的受控调度已恢复为失败记录，不会自动重复执行"
      });
    }
    if (artifacts.missingRender) {
      await appendEvent({
        type: "render.missing",
        episodeId: sourceEpisode.id,
        agentId: "render-agent",
        message: "状态中登记的成片文件不在本机，需要重新渲染或恢复媒体备份"
      });
    }
    if (artifacts.invalidRenderIntegrity) {
      await appendEvent({
        type: "render.integrity_failed",
        episodeId: sourceEpisode.id,
        agentId: "render-agent",
        message: "状态中登记的成片文件摘要不一致，需要重新渲染或恢复可信备份"
      });
    }
    recovered.push({
      episodeId: sourceEpisode.id,
      agentIds: interrupted.recoveredAgents,
      reviewStages: interrupted.recoveredReviewStages,
      operation: interrupted.recoveredOperation,
      budgetReservations: interrupted.recoveredBudgetReservations,
      ambiguousBudgetReservations: interrupted.ambiguousBudgetReservations,
      planRecovered: interrupted.recoveredPlan,
      dispatchRecovered: interrupted.recoveredDispatch,
      missingRender: artifacts.missingRender,
      invalidRenderIntegrity: artifacts.invalidRenderIntegrity ?? false
    });
  }
  return recovered;
}

export async function reconcileEpisodeArtifacts(sourceEpisode, options = {}) {
  const episode = structuredClone(sourceEpisode);
  const outputPath = episode.render?.outputPath;
  const shouldExist = episode.render?.status === "complete" && outputPath;
  if (!shouldExist) return { episode, changed: false, missingRender: false };
  const canAccess = options.access ?? access;
  let failure = null;
  try {
    await canAccess(ensureInside(workspaceRoot, resolve(workspaceRoot, outputPath)));
    await assertCurrentRenderIntegrity(episode, {
      inspectFileIntegrity: options.inspectFileIntegrity
    });
    return { episode, changed: false, missingRender: false };
  } catch (error) {
    failure = error;
    const at = (options.now ?? new Date()).toISOString();
    const missingRender = failure?.code === "ENOENT";
    const invalidRenderIntegrity = !missingRender;
    episode.render.status = missingRender ? "missing" : "invalid";
    episode.render.progress = 0;
    const renderIndex = episode.pipeline.findIndex((step) => step.agent === "render-agent");
    if (renderIndex >= 0) {
      episode.pipeline[renderIndex] = {
        ...episode.pipeline[renderIndex],
        status: "failed",
        progress: 0,
        message: missingRender
          ? "成片文件不在本机，请重新渲染或恢复媒体备份"
          : "成片文件摘要与登记记录不一致，请重新渲染或恢复可信备份",
        lastError: missingRender
          ? "render_artifact_missing"
          : "render_artifact_integrity_mismatch"
      };
    }
    episode.qa = {
      ...episode.qa,
      status: "stale",
      checkedAt: at
    };
    const qaIndex = episode.pipeline.findIndex((step) => step.agent === "qa-agent");
    if (qaIndex >= 0) {
      episode.pipeline[qaIndex] = {
        ...episode.pipeline[qaIndex],
        status: "blocked",
        progress: 0,
        message: "等待恢复或重新生成可信成片后复检"
      };
    }
    episode.approvals.final = resetApprovalForVersion(
      episode.approvals.final,
      currentGateVersion(episode, "final")
    );
    invalidateReviewForGate(episode, "final");
    if (episode.status === "approved") episode.status = "in_production";
    episode.updatedAt = at;
    episode.history.push({
      at,
      type: "artifact-reconciliation",
      status: "failed",
      message: missingRender
        ? "检测到登记的成片文件缺失，已撤销旧 QA 与终审状态"
        : "检测到成片文件完整性异常，已撤销旧 QA 与终审状态"
    });
    return { episode, changed: true, missingRender, invalidRenderIntegrity };
  }
}
