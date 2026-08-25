import {
  CONTROL_MODES,
  ensureAgentArchitecture
} from "../../shared/agent-contracts.mjs";
import { appendEvent, readEpisode, writeEpisode } from "../../shared/store.mjs";
import { getAmbiguousBudgetReservationIds } from "./budget-ledger.mjs";
import { runShadowPlanning } from "./main-agent.mjs";
import { assertKernelPlanAllowed } from "./workflow-kernel.mjs";

const evidenceConflictCodes = new Set(["EVIDENCE_CONFLICT", "SOURCE_CONFLICT"]);
const controlledRuns = new Set();

function timestamp(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

function latestReviewReport(review) {
  return review.reports?.find((report) => report.id === review.latestReportId)
    ?? review.reports?.at(-1)
    ?? null;
}

function providerOutage(providerHealth) {
  const states = Object.values(providerHealth ?? {}).map((health) => health?.state);
  return states.length > 0 && states.every((state) => state === "unavailable");
}

function pauseResult(code, message, details = {}) {
  return { code, message, ...details };
}

export function controlStopReason(sourceEpisode, options = {}) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  if (episode.control.stopRequested) {
    return pauseResult("stop_requested", "已收到人工停止请求");
  }

  const waiting = episode.pipeline.find((step) => step.status === "waiting_approval");
  if (waiting) {
    return pauseResult("human_approval", "已到达人工审批闸门", {
      gate: waiting.gate ?? waiting.requiresApproval ?? null,
      stepId: waiting.id
    });
  }

  const waitingCheckpoint = Object.entries(episode.reviewCheckpoints ?? {})
    .find(([, checkpoint]) => checkpoint?.status === "waiting_approval");
  if (waitingCheckpoint) {
    return pauseResult("human_checkpoint", "已到达生成前人工审批检查点", {
      checkpointId: waitingCheckpoint[0],
      candidateHash: waitingCheckpoint[1].currentCandidate?.candidateHash ?? null
    });
  }

  for (const [stage, review] of Object.entries(episode.reviews)) {
    const report = latestReviewReport(review);
    const conflict = [...(report?.blockingIssues ?? []), ...(report?.warnings ?? [])]
      .find((issue) => evidenceConflictCodes.has(issue.code));
    if (conflict) {
      return pauseResult("evidence_conflict", "审核发现证据冲突，需要人工判断", {
        stage,
        issueCode: conflict.code
      });
    }
  }

  const escalated = Object.entries(episode.reviews)
    .find(([, review]) => review.status === "escalated");
  if (escalated) {
    return pauseResult("review_escalated", "机器审核已升级人工处理", {
      stage: escalated[0]
    });
  }

  const exhaustedRevision = Object.entries(episode.reviews).find(([, review]) => (
    review.status === "revision_required" &&
    review.revisionRounds >= episode.control.revisionLimit
  ));
  if (exhaustedRevision) {
    return pauseResult("review_revision_limit", "连续审核失败已达到自动修改上限", {
      stage: exhaustedRevision[0]
    });
  }

  const ambiguousReservationIds = getAmbiguousBudgetReservationIds(episode);
  if (ambiguousReservationIds.length > 0) {
    return pauseResult(
      "budget_reconciliation_required",
      "存在中断后尚未人工核对的 Provider 调用，预算和后续调度保持冻结",
      { ambiguousReservationIds }
    );
  }

  const humanStep = episode.pipeline.find((step) => step.requiresHuman);
  if (humanStep) {
    return pauseResult("human_intervention", "Worker 已请求人工介入", {
      stepId: humanStep.id
    });
  }

  const budget = episode.control.budget;
  if (budget.maxCalls !== null && budget.usedCalls >= budget.maxCalls) {
    return pauseResult("call_budget_exhausted", "模型调用预算已经用完");
  }
  if (budget.maxCostUsd !== null && budget.usedCostUsd >= budget.maxCostUsd) {
    return pauseResult("cost_budget_exhausted", "模型费用预算已经用完");
  }
  if (budget.overrun) {
    return pauseResult("cost_budget_overrun", "模型实际费用超过预留预算，需要人工检查");
  }
  if (providerOutage(options.providerHealth)) {
    return pauseResult("provider_unavailable", "所有已知 Provider 当前均不可用");
  }
  return null;
}

function modeAdmissionUnavailable(details = {}) {
  const operationMessage = details.operation
    ? `；已拒绝 ${details.operation}`
    : "";
  const error = new Error(
    `可信正式评测 Runner、签名证明与不可篡改证据存储尚未接入${operationMessage}` +
    "；请通过控制模式接口显式切换到 shadow"
  );
  error.code = "control_mode_admission_unavailable";
  error.statusCode = 409;
  error.persistedMode = details.persistedMode ?? null;
  error.operation = details.operation ?? null;
  error.safeFallbackMode = "shadow";
  return error;
}

export function transitionControlMode(sourceEpisode, requestedMode, options = {}) {
  if (!CONTROL_MODES.has(requestedMode)) throw new Error(`未知控制模式：${requestedMode}`);
  const episode = ensureAgentArchitecture(sourceEpisode);
  const currentMode = episode.control.mode;
  if (currentMode === requestedMode) {
    if (requestedMode !== "shadow") {
      throw modeAdmissionUnavailable({
        persistedMode: currentMode,
        operation: "control mode transition"
      });
    }
    const shadowNeedsNormalization = Boolean(
      requestedMode === "shadow" &&
      (
        episode.control.mainAgentEnabled ||
        episode.control.modelRouterEnabled ||
        episode.control.pendingDispatch
      )
    );
    if (!shadowNeedsNormalization) {
      return { episode, changed: false, evaluation: null };
    }
    if (episode.control.pendingDispatch?.status === "executing") {
      throw new Error("受控调度正在执行，必须等待动作边界后再收回 shadow 执行开关");
    }
    const at = timestamp(options.now);
    if (episode.control.pendingDispatch) {
      episode.dispatchHistory.push({
        id: `${episode.control.pendingDispatch.id}-cancelled`,
        at,
        mode: "assisted",
        planId: episode.control.pendingDispatch.planId,
        workerId: episode.control.pendingDispatch.plan?.workerId ?? null,
        status: "cancelled",
        reasonCode: "shadow_mode_normalized"
      });
    }
    episode.control.mainAgentEnabled = false;
    episode.control.modelRouterEnabled = false;
    episode.control.pendingDispatch = null;
    episode.history.push({
      at,
      type: "control-shadow-normalized",
      from: currentMode,
      to: requestedMode,
      message: "shadow 模式已收回 Main Agent 与 Model Router 执行开关"
    });
    episode.updatedAt = at;
    return { episode, changed: true, evaluation: null };
  }

  const allowed = {
    shadow: new Set(["assisted"]),
    assisted: new Set(["shadow", "active"]),
    active: new Set(["shadow", "assisted"])
  };
  if (!allowed[currentMode].has(requestedMode)) {
    throw new Error(`不允许从 ${currentMode} 直接切换到 ${requestedMode}`);
  }

  if (requestedMode !== "shadow") {
    throw modeAdmissionUnavailable({
      persistedMode: currentMode,
      operation: "control mode transition"
    });
  }

  const at = timestamp(options.now);
  if (episode.control.pendingDispatch?.status === "executing") {
    throw new Error("受控调度正在执行，必须等待动作边界后再切换模式");
  }
  if (episode.control.pendingDispatch) {
    episode.dispatchHistory.push({
      id: `${episode.control.pendingDispatch.id}-cancelled`,
      at,
      mode: "assisted",
      planId: episode.control.pendingDispatch.planId,
      workerId: episode.control.pendingDispatch.plan?.workerId ?? null,
      status: "cancelled",
      reasonCode: "mode_changed"
    });
  }
  episode.control.mode = requestedMode;
  episode.control.mainAgentEnabled = false;
  episode.control.modelRouterEnabled = false;
  episode.control.pendingDispatch = null;
  episode.history.push({
    at,
    type: "control-mode-changed",
    from: currentMode,
    to: requestedMode,
    message: `控制模式从 ${currentMode} 切换为 ${requestedMode}`
  });
  episode.updatedAt = at;
  return { episode, changed: true, evaluation: null };
}

export async function setControlMode(episodeId, requestedMode, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const sourceEpisode = await readState(episodeId);
  const changed = transitionControlMode(sourceEpisode, requestedMode, options);
  if (changed.changed) {
    await writeState(changed.episode);
    await recordEvent({
      type: "control.mode_changed",
      episodeId,
      mode: requestedMode,
      message: `控制模式已切换为 ${requestedMode}`,
      ...(requestedMode === "active"
        ? {
            authorizationId: options.activeAuthorization?.authorizationId,
            authorizationNonce: options.activeAuthorization?.nonce,
            actorId: options.activeAuthorization?.actorId,
            releaseEvidenceHash: options.activeAuthorization?.releaseEvidenceHash
          }
        : {})
    });
  }
  return changed;
}

export async function setStopRequest(episodeId, requested, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const episode = ensureAgentArchitecture(await readState(episodeId));
  const at = timestamp(options.now);
  episode.control.stopRequested = Boolean(requested);
  if (
    requested &&
    episode.control.pendingDispatch &&
    episode.control.pendingDispatch.status !== "executing"
  ) {
    episode.dispatchHistory.push({
      id: `${episode.control.pendingDispatch.id}-cancelled`,
      at,
      mode: "assisted",
      planId: episode.control.pendingDispatch.planId,
      workerId: episode.control.pendingDispatch.plan?.workerId ?? null,
      status: "cancelled",
      reasonCode: "stop_requested"
    });
    episode.control.pendingDispatch = null;
  }
  episode.history.push({
    at,
    type: requested ? "control-stop-requested" : "control-stop-cleared",
    message: requested ? "人工请求停止受控调度" : "人工已清除停止请求"
  });
  episode.updatedAt = at;
  await writeState(episode);
  await recordEvent({
    type: requested ? "control.stop_requested" : "control.stop_cleared",
    episodeId,
    message: requested ? "受控调度将在边界处停止" : "停止请求已由人工清除"
  });
  return episode;
}

function assertDispatchModeAdmitted(episode, expected, operation) {
  if (episode.control.mode !== expected) {
    throw new Error(`当前为 ${episode.control.mode} 模式，不能执行 ${expected} 调度`);
  }
  throw modeAdmissionUnavailable({
    persistedMode: episode.control.mode,
    operation
  });
}

function assertNoStop(episode, options) {
  const reason = controlStopReason(episode, options);
  if (!reason) return;
  const error = new Error(reason.message);
  error.code = reason.code;
  error.stopReason = reason;
  throw error;
}

function planningFailure(error) {
  return pauseResult(
    error?.requiresHuman || error?.code === "manual_intervention_required"
      ? "provider_unavailable"
      : "planning_failed",
    "Main Agent 规划失败，已暂停等待人工检查"
  );
}

function nonWorkerPause(plan) {
  if (plan.action === "wait_for_approval") {
    return pauseResult("human_approval", "Main Agent 选择等待人工审批");
  }
  if (plan.action === "wait_for_checkpoint") {
    return pauseResult("human_checkpoint", "Main Agent 选择等待生成前人工审批检查点");
  }
  if (plan.action === "wait_for_input") {
    return pauseResult("human_input", "Main Agent 选择等待人工提供所需素材");
  }
  if (plan.action === "stop") return pauseResult("main_agent_stop", "Main Agent 建议停止");
  return pauseResult("no_legal_work", "Main Agent 当前没有可执行动作");
}

async function planOnce(episodeId, mode, options) {
  const planRunner = options.planRunner ?? runShadowPlanning;
  return planRunner(episodeId, {
    ...options,
    mode,
    readEpisode: options.readEpisode ?? readEpisode,
    writeEpisode: options.writeEpisode ?? writeEpisode,
    appendEvent: options.appendEvent ?? appendEvent
  });
}

async function withControlLock(episodeId, callback) {
  if (controlledRuns.has(episodeId)) {
    throw new Error("这一期已有受控调度正在运行，请等待动作边界");
  }
  controlledRuns.add(episodeId);
  try {
    return await callback();
  } finally {
    controlledRuns.delete(episodeId);
  }
}

async function prepareAssistedDispatchUnlocked(episodeId, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  let episode = ensureAgentArchitecture(await readState(episodeId));
  assertDispatchModeAdmitted(episode, "assisted", "assisted prepare");
  if (episode.control.pendingDispatch) throw new Error("已有调度动作等待人工确认");
  const stop = controlStopReason(episode, options);
  if (stop) return { episode, status: "paused", stop };

  let planned;
  try {
    planned = await planOnce(episodeId, "assisted", options);
  } catch (error) {
    episode = ensureAgentArchitecture(await readState(episodeId));
    return { episode, status: "paused", stop: planningFailure(error) };
  }
  if (planned.record.status !== "proposed") {
    return {
      episode: planned.episode,
      status: "rejected",
      plan: planned.record,
      stop: pauseResult("invalid_plan", "Main Agent 计划未通过合同或 Kernel 校验")
    };
  }
  if (planned.record.plan.action !== "run_worker") {
    return {
      episode: planned.episode,
      status: "paused",
      plan: planned.record,
      stop: nonWorkerPause(planned.record.plan)
    };
  }

  episode = ensureAgentArchitecture(await readState(episodeId));
  assertNoStop(episode, options);
  assertKernelPlanAllowed(episode, planned.record.plan);
  const at = timestamp(options.now);
  const pending = {
    id: `dispatch-${planned.record.id}`,
    planId: planned.record.id,
    planVersion: planned.record.version,
    plan: structuredClone(planned.record.plan),
    status: "waiting_confirmation",
    createdAt: at
  };
  episode.control.pendingDispatch = pending;
  episode.updatedAt = at;
  await writeState(episode);
  await recordEvent({
    type: "main-agent.assisted.confirmation_required",
    episodeId,
    planId: pending.planId,
    workerId: pending.plan.workerId,
    message: "Main Agent 调度建议等待人工逐次确认"
  });
  return { episode, status: "waiting_confirmation", pending };
}

export async function prepareAssistedDispatch(episodeId, options = {}) {
  return withControlLock(episodeId, () => prepareAssistedDispatchUnlocked(episodeId, options));
}

function startDispatchRecord(episode, planRecord, mode, options = {}) {
  const at = timestamp(options.now);
  const idempotencyKey = `${episode.id}:${planRecord.version}:${planRecord.plan.workerId}:1`;
  const existing = episode.dispatchHistory.find((entry) => entry.idempotencyKey === idempotencyKey);
  if (existing) {
    const error = new Error("该计划动作已经执行或正在执行，不会重复派发");
    error.code = "duplicate_dispatch";
    throw error;
  }
  const record = {
    id: options.dispatchId ?? `execution-${planRecord.id}`,
    planId: planRecord.id,
    planVersion: planRecord.version,
    mode,
    workerId: planRecord.plan.workerId,
    idempotencyKey,
    taskProfile: planRecord.plan.taskProfile,
    reviewProfile: planRecord.plan.reviewProfile,
    toolIds: [...(planRecord.plan.toolIds ?? [])],
    limits: structuredClone(planRecord.plan.limits),
    status: "running",
    humanConfirmed: Boolean(options.humanConfirmed),
    startedAt: at,
    completedAt: null,
    reasonCode: null
  };
  episode.dispatchHistory.push(record);
  episode.updatedAt = at;
  return record;
}

function finishDispatchRecord(episode, recordId, status, options = {}) {
  const record = episode.dispatchHistory.find((entry) => entry.id === recordId);
  if (!record) throw new Error(`缺少调度审计记录：${recordId}`);
  record.status = status;
  record.completedAt = timestamp(options.now);
  record.reasonCode = options.reasonCode ?? null;
  episode.updatedAt = record.completedAt;
  return record;
}

async function executeWorkerPlan(episodeId, planRecord, mode, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  if (typeof options.runWorker !== "function") {
    throw new Error("受控调度缺少显式 Worker 执行器");
  }
  let episode = ensureAgentArchitecture(await readState(episodeId));
  const idempotencyKey = `${episode.id}:${planRecord.version}:${planRecord.plan.workerId}:1`;
  const previousDispatch = episode.dispatchHistory.find(
    (entry) => entry.idempotencyKey === idempotencyKey
  );
  if (previousDispatch?.status === "completed") {
    return {
      episode,
      status: "completed",
      dispatch: previousDispatch,
      deduplicated: true
    };
  }
  if (previousDispatch) {
    const error = new Error("该计划动作已有未完成审计记录，需要人工检查后再重试");
    error.code = "duplicate_dispatch";
    throw error;
  }
  assertNoStop(episode, options);
  assertKernelPlanAllowed(episode, planRecord.plan);
  const dispatch = startDispatchRecord(episode, planRecord, mode, options);
  await writeState(episode);
  await recordEvent({
    type: `main-agent.${mode}.dispatch_started`,
    episodeId,
    planId: planRecord.id,
    workerId: planRecord.plan.workerId,
    idempotencyKey: `${dispatch.idempotencyKey}:started`,
    message: `受控调度开始执行 ${planRecord.plan.workerId}`
  });
  try {
    await options.runWorker(episodeId, planRecord.plan.workerId, {
      initiator: "main-agent",
      idempotencyKey: dispatch.idempotencyKey,
      taskProfile: planRecord.plan.taskProfile,
      reviewProfile: planRecord.plan.reviewProfile,
      toolIds: [...(planRecord.plan.toolIds ?? [])],
      limits: structuredClone(planRecord.plan.limits)
    });
    episode = ensureAgentArchitecture(await readState(episodeId));
    const completed = finishDispatchRecord(episode, dispatch.id, "completed", options);
    episode.control.pendingDispatch = null;
    await writeState(episode);
    await recordEvent({
      type: `main-agent.${mode}.dispatch_completed`,
      episodeId,
      planId: planRecord.id,
      workerId: planRecord.plan.workerId,
      idempotencyKey: `${dispatch.idempotencyKey}:completed`,
      message: `受控调度已完成 ${planRecord.plan.workerId}`
    });
    return { episode, status: "completed", dispatch: completed };
  } catch (error) {
    episode = ensureAgentArchitecture(await readState(episodeId));
    const reasonCode = error?.requiresHuman || error?.code === "manual_intervention_required"
      ? "provider_unavailable"
      : "worker_failed";
    const failed = finishDispatchRecord(episode, dispatch.id, "failed", {
      ...options,
      reasonCode
    });
    episode.control.pendingDispatch = null;
    await writeState(episode);
    await recordEvent({
      type: `main-agent.${mode}.dispatch_paused`,
      episodeId,
      planId: planRecord.id,
      workerId: planRecord.plan.workerId,
      status: "paused",
      idempotencyKey: `${dispatch.idempotencyKey}:paused`,
      message: "Worker 执行失败，受控调度已暂停"
    });
    return {
      episode,
      status: "paused",
      dispatch: failed,
      stop: pauseResult(reasonCode, "Worker 执行失败，已暂停等待人工检查")
    };
  }
}

async function confirmAssistedDispatchUnlocked(episodeId, dispatchId, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  let episode = ensureAgentArchitecture(await readState(episodeId));
  assertDispatchModeAdmitted(episode, "assisted", "assisted confirm");
  assertNoStop(episode, options);
  const pending = episode.control.pendingDispatch;
  if (!pending || pending.id !== dispatchId || pending.status !== "waiting_confirmation") {
    throw new Error("待确认调度不存在、已过期或状态不正确");
  }
  if (
    episode.control.currentPlan?.id !== pending.planId ||
    episode.control.currentPlan?.version !== pending.planVersion
  ) {
    throw new Error("待确认调度所对应的计划版本已经过期");
  }
  assertKernelPlanAllowed(episode, pending.plan);
  episode.control.pendingDispatch = { ...pending, status: "executing", confirmedAt: timestamp(options.now) };
  await writeState(episode);
  return executeWorkerPlan(episodeId, episode.control.currentPlan, "assisted", {
    ...options,
    dispatchId,
    humanConfirmed: true
  });
}

export async function confirmAssistedDispatch(episodeId, dispatchId, options = {}) {
  return withControlLock(
    episodeId,
    () => confirmAssistedDispatchUnlocked(episodeId, dispatchId, options)
  );
}

async function runActiveCycleUnlocked(episodeId, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  let episode = ensureAgentArchitecture(await readState(episodeId));
  assertDispatchModeAdmitted(episode, "active", "active run");
  if (!episode.control.modelRouterEnabled) throw new Error("Model Router 未启用");
  const maximumActions = Math.max(1, Math.min(32, options.maxActions ?? 8));
  const dispatches = [];

  for (let actionIndex = 0; actionIndex < maximumActions; actionIndex += 1) {
    episode = ensureAgentArchitecture(await readState(episodeId));
    if (episode.control.mode !== "active") {
      return {
        episode,
        status: "paused",
        stop: pauseResult("mode_changed", "控制模式已改变，active 调度在动作边界暂停"),
        dispatches
      };
    }
    const stop = controlStopReason(episode, options);
    if (stop) return { episode, status: "paused", stop, dispatches };

    let planned;
    try {
      planned = await planOnce(episodeId, "active", options);
    } catch (error) {
      episode = ensureAgentArchitecture(await readState(episodeId));
      return { episode, status: "paused", stop: planningFailure(error), dispatches };
    }
    if (planned.record.status !== "proposed") {
      return {
        episode: planned.episode,
        status: "paused",
        stop: pauseResult("invalid_plan", "Main Agent 计划未通过合同或 Kernel 校验"),
        dispatches
      };
    }
    if (planned.record.plan.action !== "run_worker") {
      return {
        episode: planned.episode,
        status: "paused",
        stop: nonWorkerPause(planned.record.plan),
        dispatches
      };
    }

    episode = ensureAgentArchitecture(await readState(episodeId));
    assertKernelPlanAllowed(episode, planned.record.plan);
    const executed = await executeWorkerPlan(episodeId, planned.record, "active", options);
    dispatches.push(executed.dispatch);
    if (executed.status !== "completed") {
      return { ...executed, dispatches };
    }
  }

  episode = ensureAgentArchitecture(await readState(episodeId));
  return {
    episode,
    status: "paused",
    stop: pauseResult("active_action_limit", "本轮 active 调度已达到动作上限"),
    dispatches
  };
}

export async function runActiveCycle(episodeId, options = {}) {
  return withControlLock(episodeId, () => runActiveCycleUnlocked(episodeId, options));
}

export function recoverInterruptedDispatch(sourceEpisode, options = {}) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  const pending = episode.control.pendingDispatch;
  if (pending?.status !== "executing") return { episode, recovered: false };
  const at = timestamp(options.now);
  const record = episode.dispatchHistory.find((entry) => entry.id === pending.id);
  if (record?.status === "running") {
    record.status = "failed";
    record.completedAt = at;
    record.reasonCode = "process_interrupted";
  } else {
    episode.dispatchHistory.push({
      id: pending.id,
      planId: pending.planId,
      planVersion: pending.planVersion,
      mode: "assisted",
      workerId: pending.plan?.workerId ?? null,
      taskProfile: pending.plan?.taskProfile ?? null,
      reviewProfile: pending.plan?.reviewProfile ?? null,
      toolIds: [...(pending.plan?.toolIds ?? [])],
      limits: pending.plan?.limits ? structuredClone(pending.plan.limits) : null,
      status: "failed",
      humanConfirmed: true,
      startedAt: pending.confirmedAt ?? pending.createdAt,
      completedAt: at,
      reasonCode: "process_interrupted"
    });
  }
  episode.control.pendingDispatch = null;
  episode.history.push({
    at,
    type: "dispatch-recovered",
    status: "failed",
    message: "中断的受控调度已恢复为失败记录，不会自动重复执行"
  });
  episode.updatedAt = at;
  return { episode, recovered: true };
}
