import { randomUUID } from "node:crypto";
import { ensureAgentArchitecture } from "../../shared/agent-contracts.mjs";
import { appendEvent, readEpisode, writeEpisode } from "../../shared/store.mjs";
import { currentGateArtifactHash, currentGateVersion } from "../../shared/workflow.mjs";
import { workerManifest } from "../../shared/worker-manifests.mjs";
import { reviewPassedForGate } from "./policy-engine.mjs";
import { getAmbiguousBudgetReservationIds } from "./budget-ledger.mjs";
import { requireSideEffectGrant } from "../security/side-effect-capability.mjs";

export const PROVIDER_RESULT_RETRY_CONFIRMATION =
  "I_CONFIRMED_PROVIDER_RESULT_NOT_COMMITTED_AND_AUTHORIZE_A_NEW_CALL";
export const PROVIDER_RESULT_COMMIT_CONFIRMATION =
  "I_CONFIRMED_PROVIDER_RESULT_COMMITTED_AND_BOUND_TO_CURRENT_REVIEW";

const decisions = new Set(["retry_authorized", "commit_confirmed"]);

export class ProviderResultRecoveryError extends Error {
  constructor(message, code, statusCode = 400, details = {}) {
    super(message);
    this.name = "ProviderResultRecoveryError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function recoveryError(message, code, statusCode = 400, details = {}) {
  return new ProviderResultRecoveryError(message, code, statusCode, details);
}

function timestamp(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

function normalizedActor(actor) {
  if (
    typeof actor !== "string" ||
    !actor.startsWith("human:") ||
    actor.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(actor)
  ) {
    throw recoveryError(
      "Provider 结果裁决必须使用服务端认证的人工身份",
      "provider_result_adjudication_forbidden",
      403
    );
  }
  return actor;
}

function normalizedReservationIds(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw recoveryError(
      "Provider 结果裁决必须精确列出待裁决的 reservationIds",
      "provider_result_adjudication_input_invalid"
    );
  }
  const ids = [...new Set(value.map((item) => String(item ?? "").trim()))].sort();
  if (
    ids.length !== value.length ||
    ids.some((id) => !id || id.length > 200 || /[\u0000-\u001f\u007f]/u.test(id))
  ) {
    throw recoveryError(
      "Provider 结果裁决的 reservationIds 无效或包含重复项",
      "provider_result_adjudication_input_invalid"
    );
  }
  return ids;
}

function sameIds(left, right) {
  const normalizedLeft = [...new Set(left ?? [])].sort();
  const normalizedRight = [...new Set(right ?? [])].sort();
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function decisionConfirmation(decision) {
  return decision === "retry_authorized"
    ? PROVIDER_RESULT_RETRY_CONFIRMATION
    : PROVIDER_RESULT_COMMIT_CONFIRMATION;
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw recoveryError(
      "Provider 结果裁决请求必须是对象",
      "provider_result_adjudication_input_invalid"
    );
  }
  const target = String(input.target ?? "").trim();
  if (!target || target.length > 160 || /[\u0000-\u001f\u007f]/u.test(target)) {
    throw recoveryError(
      "Provider 结果裁决 target 无效",
      "provider_result_adjudication_input_invalid"
    );
  }
  if (!decisions.has(input.decision)) {
    throw recoveryError(
      "Provider 结果裁决 decision 无效",
      "provider_result_adjudication_input_invalid"
    );
  }
  if (input.confirmation !== decisionConfirmation(input.decision)) {
    throw recoveryError(
      "Provider 结果裁决缺少与决定匹配的显式确认语",
      "provider_result_adjudication_confirmation_required"
    );
  }
  if (!Number.isInteger(input.expectedStateVersion) || input.expectedStateVersion < 0) {
    throw recoveryError(
      "Provider 结果裁决必须绑定当前 Episode stateVersion",
      "provider_result_adjudication_input_invalid"
    );
  }
  return {
    target,
    decision: input.decision,
    confirmation: input.confirmation,
    expectedStateVersion: input.expectedStateVersion,
    reservationIds: normalizedReservationIds(input.reservationIds),
    artifactVersion: input.artifactVersion,
    artifactHash: input.artifactHash,
    reviewReportId: input.reviewReportId,
    note: String(input.note ?? "").trim().slice(0, 1000)
  };
}

function matchingAdjudication(episode, input) {
  return [...(episode.history ?? [])].reverse().find((entry) => (
    entry?.type === "provider-result-adjudicated" &&
    entry.target === input.target &&
    entry.decision === input.decision &&
    sameIds(entry.reservationIds, input.reservationIds)
  )) ?? null;
}

function adjudicationAuditEvent(episodeId, adjudication) {
  const eventId = `${adjudication.id}:audit`;
  return {
    eventId,
    idempotencyKey: eventId,
    at: adjudication.at,
    type: "provider.result_commit.adjudicated",
    episodeId,
    target: adjudication.target,
    decision: adjudication.decision,
    reservationIds: [...adjudication.reservationIds],
    actor: adjudication.actor,
    message: adjudication.decision === "commit_confirmed"
      ? "人工已确认当前机器审核产物完成本地提交，继续等待 Gate 审批"
      : "人工已确认本地结果不可复用；未来新调用仍需独立授权与预算"
  };
}

function unresolvedHistoryRecord(episode, target, reservationIds) {
  const resolvedIds = new Set(
    (episode.history ?? [])
      .filter((entry) => entry?.type === "provider-result-adjudicated")
      .flatMap((entry) => entry.reservationIds ?? [])
  );
  return [...(episode.history ?? [])].reverse().find((entry) => {
    const unknown = entry?.failureCode === "provider_result_commit_unknown" ||
      entry?.type === "provider-result-commit-unknown";
    const entryTarget = entry?.agentId ?? null;
    const ids = entry?.reservationIds ?? [];
    return unknown && entryTarget === target && sameIds(ids, reservationIds) &&
      ids.some((id) => !resolvedIds.has(id));
  }) ?? null;
}

function unresolvedCommitIds(episode) {
  const resolved = new Set(
    (episode.history ?? [])
      .filter((entry) => entry?.type === "provider-result-adjudicated")
      .flatMap((entry) => entry.reservationIds ?? [])
  );
  const unknown = new Set();
  for (const entry of episode.history ?? []) {
    if (
      entry?.failureCode === "provider_result_commit_unknown" ||
      entry?.type === "provider-result-commit-unknown"
    ) {
      for (const id of entry.reservationIds ?? []) {
        if (!resolved.has(id)) unknown.add(id);
      }
    }
  }
  for (const step of episode.pipeline ?? []) {
    for (const id of step.uncommittedProviderResultIds ?? []) {
      if (!resolved.has(id)) unknown.add(id);
    }
  }
  for (const id of episode.control?.currentPlan?.uncommittedProviderResultIds ?? []) {
    if (!resolved.has(id)) unknown.add(id);
  }
  return [...unknown].sort();
}

function budgetActuallyExceeded(episode) {
  const budget = episode.control?.budget ?? {};
  return Boolean(
    (Number.isInteger(budget.maxCalls) && (budget.usedCalls ?? 0) > budget.maxCalls) ||
    (Number.isFinite(budget.maxCostUsd) &&
      (budget.usedCostUsd ?? 0) > budget.maxCostUsd)
  );
}

function clearCommitUnknownFreeze(episode, marker) {
  if (
    marker?.previousBudgetOverrun === false &&
    unresolvedCommitIds(episode).length === 0 &&
    getAmbiguousBudgetReservationIds(episode).length === 0 &&
    !budgetActuallyExceeded(episode)
  ) {
    episode.control.budget.overrun = false;
  }
}

function assertCommitBinding(episode, gate, input) {
  const expected = {
    artifactVersion: currentGateVersion(episode, gate),
    artifactHash: currentGateArtifactHash(episode, gate),
    reviewReportId: episode.reviews?.[gate]?.latestReportId ?? null
  };
  if (
    episode.control?.reviewEnabled !== true ||
    !Number.isInteger(input.artifactVersion) ||
    input.artifactVersion !== expected.artifactVersion ||
    input.artifactHash !== expected.artifactHash ||
    input.reviewReportId !== expected.reviewReportId ||
    typeof expected.reviewReportId !== "string" ||
    !expected.reviewReportId ||
    !reviewPassedForGate(episode, gate)
  ) {
    throw recoveryError(
      "确认本地提交必须精确绑定当前产物版本、字节元数据与已通过的机器审核",
      "provider_result_commit_binding_conflict",
      409,
      { expected }
    );
  }
  return expected;
}

function releaseWorker(episode, step, input, marker, at, actor) {
  const humanFreezeWasAdded = marker?.requiresHumanAdded === true;
  if (input.decision === "commit_confirmed") {
    const gate = workerManifest(step.agent)?.gate;
    if (!gate) {
      throw recoveryError(
        "该 Worker 没有可绑定的人工 Gate，不能把未知 Provider 结果直接视为已提交",
        "provider_result_commit_confirmation_unsupported",
        409
      );
    }
    assertCommitBinding(episode, gate, input);
    step.status = "waiting_approval";
    step.requiresApproval = gate;
    step.message = "人工已确认 Provider 结果和当前机器审核产物完成提交，等待 Gate 审批";
  } else {
    step.status = "failed";
    step.requiresApproval = null;
    step.message =
      "人工确认本地没有可复用提交；后续如重试，必须重新取得独立 Capability 和预算";
  }
  if (humanFreezeWasAdded) step.requiresHuman = false;
  step.lastError = null;
  step.lastRunAt = at;
  delete step.uncommittedProviderResultIds;
  step.providerResultAdjudication = {
    decision: input.decision,
    at,
    actor,
    reservationIds: [...input.reservationIds]
  };
}

function releaseMainAgent(episode, input, at, actor) {
  if (input.decision !== "retry_authorized") {
    throw recoveryError(
      "Main Agent 的未提交计划没有 Gate 产物可绑定，只能在人工确认本地结果不可复用后授权新规划",
      "provider_result_commit_confirmation_unsupported",
      409
    );
  }
  const plan = episode.control?.currentPlan;
  if (plan) {
    plan.requiresHuman = false;
    plan.retryAuthorizedAt = at;
    plan.retryAuthorizedBy = actor;
    delete plan.uncommittedProviderResultIds;
  }
  for (const record of episode.planHistory ?? []) {
    if (record.id !== plan?.id) continue;
    record.requiresHuman = false;
    record.retryAuthorizedAt = at;
    record.retryAuthorizedBy = actor;
    delete record.uncommittedProviderResultIds;
  }
}

export async function adjudicateProviderResultCommit(episodeId, rawInput, options = {}) {
  const actor = normalizedActor(options.actor);
  const input = validateInput(rawInput);
  if (options.requireSideEffectCapability === true) {
    requireSideEffectGrant(options, {
      episodeId,
      operation: options.capabilityOperation ?? "provider-result:adjudicate",
      scopes: ["state.write"],
      maxCalls: 0,
      maxCostUsd: 0
    });
  }
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const episode = ensureAgentArchitecture(await readState(episodeId));
  const duplicate = matchingAdjudication(episode, input);
  if (duplicate) {
    // Episode CAS may have committed while the audit append failed. Replaying
    // the same idempotency key repairs that split outcome without a state write.
    await recordEvent(adjudicationAuditEvent(episodeId, duplicate));
    return { episode, adjudication: duplicate, unchanged: true };
  }
  if (episode.control?.stateVersion !== input.expectedStateVersion) {
    throw recoveryError(
      "Episode 已变化，请刷新后重新核对 Provider 结果",
      "provider_result_adjudication_state_conflict",
      409,
      {
        expectedStateVersion: input.expectedStateVersion,
        actualStateVersion: episode.control?.stateVersion ?? null
      }
    );
  }
  const marker = unresolvedHistoryRecord(episode, input.target, input.reservationIds);
  let step = null;
  if (input.target !== "main-agent") {
    step = episode.pipeline.find((item) => item.agent === input.target) ?? null;
    if (
      !step ||
      step.lastError !== "provider_result_commit_unknown" ||
      !sameIds(step.uncommittedProviderResultIds, input.reservationIds)
    ) {
      throw recoveryError(
        "当前 Worker 没有与请求精确匹配的未提交 Provider 结果",
        "provider_result_adjudication_not_pending",
        409
      );
    }
  } else if (!marker) {
    throw recoveryError(
      "Main Agent 没有与请求精确匹配的未提交 Provider 结果",
      "provider_result_adjudication_not_pending",
      409
    );
  }
  if (!marker) {
    throw recoveryError(
      "缺少可审计的 Provider 结果提交不明记录",
      "provider_result_adjudication_evidence_missing",
      409
    );
  }

  const at = timestamp(options.now);
  if (step) releaseWorker(episode, step, input, marker, at, actor);
  else releaseMainAgent(episode, input, at, actor);
  const adjudication = {
    id: `provider-result-adjudication:${randomUUID()}`,
    at,
    type: "provider-result-adjudicated",
    status: "resolved",
    target: input.target,
    decision: input.decision,
    reservationIds: [...input.reservationIds],
    actor,
    expectedStateVersion: input.expectedStateVersion,
    artifactVersion: input.decision === "commit_confirmed" ? input.artifactVersion : null,
    artifactHash: input.decision === "commit_confirmed" ? input.artifactHash : null,
    reviewReportId: input.decision === "commit_confirmed" ? input.reviewReportId : null,
    note: input.note
  };
  episode.history.push(adjudication);
  clearCommitUnknownFreeze(episode, marker);
  episode.updatedAt = at;
  await writeState(episode);
  await recordEvent(adjudicationAuditEvent(episodeId, adjudication));
  return { episode, adjudication, unchanged: false };
}
