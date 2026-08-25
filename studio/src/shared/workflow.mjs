import { APPROVAL_GATES, APPROVAL_GATE_IDS } from "./schema.mjs";
import { createReviewState } from "./agent-contracts.mjs";
import { integrityHash } from "./integrity.mjs";

const gateDefinitions = new Map(APPROVAL_GATES.map((gate) => [gate.id, gate]));

function timestamp(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

export function createApprovalState(initial = {}) {
  return {
    status: initial.status ?? "pending",
    at: initial.at ?? null,
    note: initial.note ?? "",
    feedback: initial.feedback ?? "",
    currentVersion: initial.currentVersion ?? null,
    history: Array.isArray(initial.history) ? initial.history : [],
    provenance: initial.provenance
      ?? (initial.status === "approved" ? "legacy-approval" : null),
    reviewReportId: initial.reviewReportId ?? null,
    artifactHash: initial.artifactHash ?? null
  };
}

export function createApprovalMap(initial = {}) {
  return Object.fromEntries(
    APPROVAL_GATES.map((gate) => [gate.id, createApprovalState(initial[gate.id])])
  );
}

export function currentGateVersion(episode, gate) {
  if (gate === "research") {
    return episode.research?.version
      ?? episode.research?.versions?.at(-1)?.version
      ?? null;
  }
  if (gate === "script") return episode.production?.scriptDraft?.version ?? null;
  if (gate === "storyboard") return episode.production?.storyboardDraft?.version ?? null;
  if (gate === "assets") {
    if (Number.isInteger(episode.production?.assetBundleRevision)) {
      return episode.production.assetBundleRevision > 0
        ? episode.production.assetBundleRevision
        : null;
    }
    return Math.max(
      episode.production?.assetPlan?.version ?? 0,
      episode.production?.voicePlan?.version ?? 0,
      episode.production?.materialsVersion ?? 0,
      episode.voice?.version ?? 0
    ) || null;
  }
  if (gate === "final") {
    if (episode.render?.version) return episode.render.version;
    const match = /preview-v(\d{3})\.mp4$/u.exec(episode.render?.outputPath ?? "");
    return match ? Number(match[1]) : null;
  }
  return null;
}

export function nextAssetBundleRevision(episode) {
  const current = Number.isInteger(episode.production?.assetBundleRevision)
    ? episode.production.assetBundleRevision
    : currentGateVersion(episode, "assets") ?? 0;
  return Math.max(0, current) + 1;
}

function stableAssets(assets = []) {
  return assets.map((asset) => ({
    id: asset.id ?? null,
    planItemId: asset.planItemId ?? null,
    type: asset.type ?? null,
    path: asset.path ?? null,
    source: asset.source ?? null,
    bytes: asset.bytes ?? null,
    sha256: asset.sha256 ?? null,
    privacy: asset.privacy ?? null
  }));
}

// Gate 3 approves the storyboard's user-visible structure and logical evidence
// intent. Physical asset/audio files are produced later and are bound by Gate 4;
// keeping them out here avoids invalidating an approved storyboard merely because
// the asset worker materialized the already-approved intent.
export function storyboardGateScenes(scenes = []) {
  return scenes.map((scene) => ({
    id: scene.id ?? null,
    start: scene.start ?? null,
    end: scene.end ?? null,
    type: scene.type ?? null,
    index: scene.index ?? null,
    kicker: scene.kicker ?? null,
    title: scene.title ?? null,
    statement: scene.statement ?? null,
    subtitle: scene.subtitle ?? null,
    label: scene.label ?? null,
    evidenceRef: scene.evidenceRef ?? null,
    assetHint: scene.assetHint ?? null
  }));
}

export function gateArtifactPayload(episode, gate) {
  if (gate === "research") {
    return { research: episode.research ?? null, sourceDocs: episode.sourceDocs ?? [] };
  }
  if (gate === "script") return { scriptDraft: episode.production?.scriptDraft ?? null };
  if (gate === "storyboard") {
    return {
      storyboardDraft: episode.production?.storyboardDraft ?? null,
      scenes: storyboardGateScenes(episode.scenes ?? []),
      subtitles: episode.subtitles ?? [],
      render: {
        width: episode.render?.width ?? null,
        height: episode.render?.height ?? null,
        fps: episode.render?.fps ?? null,
        durationSeconds: episode.render?.durationSeconds ?? null,
        compositionId: episode.render?.compositionId ?? null
      }
    };
  }
  if (gate === "assets") {
    return {
      assetBundleRevision: episode.production?.assetBundleRevision ?? null,
      assetPlan: episode.production?.assetPlan ?? null,
      voicePlan: episode.production?.voicePlan ?? null,
      materialsVersion: episode.production?.materialsVersion ?? null,
      assets: stableAssets(episode.assets),
      voice: {
        status: episode.voice?.status ?? null,
        version: episode.voice?.version ?? null,
        mode: episode.voice?.mode ?? null,
        audioPath: episode.voice?.audioPath ?? null,
        publicPath: episode.voice?.publicPath ?? null,
        bytes: episode.voice?.bytes ?? null,
        sha256: episode.voice?.sha256 ?? null,
        durationSeconds: episode.voice?.durationSeconds ?? null,
        sampleRate: episode.voice?.sampleRate ?? null,
        channels: episode.voice?.channels ?? null,
        bitsPerSample: episode.voice?.bitsPerSample ?? null,
        provenance: episode.voice?.provenance ?? null,
        verification: episode.voice?.verification ?? null,
        authorization: episode.voice?.authorization ?? null
      },
      sceneBindings: (episode.scenes ?? []).map((scene) => ({
        id: scene.id,
        asset: scene.asset ?? null,
        audio: scene.audio ?? null
      }))
    };
  }
  if (gate === "final") {
    return {
      render: {
        version: episode.render?.version ?? null,
        outputPath: episode.render?.outputPath ?? null,
        bytes: episode.render?.bytes ?? null,
        sha256: episode.render?.sha256 ?? null,
        width: episode.render?.width ?? null,
        height: episode.render?.height ?? null,
        fps: episode.render?.fps ?? null,
        durationSeconds: episode.render?.durationSeconds ?? null,
        compositionId: episode.render?.compositionId ?? null,
        muted: episode.render?.muted ?? null
      },
      qa: {
        status: episode.qa?.status ?? null,
        reportPath: episode.qa?.reportPath ?? null,
        checks: episode.qa?.checks ?? [],
        quality: episode.qa?.quality ?? null
      }
    };
  }
  return null;
}

export function currentGateArtifactHash(episode, gate) {
  const version = currentGateVersion(episode, gate);
  const payload = gateArtifactPayload(episode, gate);
  if (!Number.isInteger(version) || version < 1 || payload === null) return null;
  return integrityHash({ gate, version, payload });
}

export function latestReviewFeedback(episode, gate) {
  const direct = episode.production?.feedback?.[gate]?.text;
  if (direct) return direct;
  const humanFeedback = [...(episode.approvalHistory ?? [])]
    .reverse()
    .find((entry) => entry.gate === gate && entry.decision === "rejected")?.note;
  if (humanFeedback) return humanFeedback;

  const review = episode.reviews?.[gate];
  const report = review?.reports?.find((item) => item.id === review.latestReportId)
    ?? review?.reports?.at(-1);
  return Array.isArray(report?.blockingIssues) && report.blockingIssues.length > 0
    ? structuredClone(report.blockingIssues)
    : "";
}

function resetDownstreamApprovals(episode, restartIndex, currentGate) {
  for (const gate of APPROVAL_GATES) {
    if (gate.id === currentGate) continue;
    const stepIndex = episode.pipeline.findIndex((step) => step.id === gate.stepId);
    if (stepIndex <= restartIndex) continue;
    episode.approvals[gate.id] = {
      ...createApprovalState(episode.approvals[gate.id]),
      status: "pending",
      at: null,
      note: "",
      feedback: "",
      provenance: null,
      reviewReportId: null,
      artifactHash: null
    };
    invalidateReviewForGate(episode, gate.id);
  }
}

export function invalidateReviewForGate(episode, gate) {
  if (!episode.reviews?.[gate]) return;
  const previous = createReviewState(episode.reviews[gate]);
  episode.reviews[gate] = {
    ...previous,
    status: "not_started",
    artifactVersion: null,
    artifactHash: null,
    revisionRounds: 0
  };
}

function markRevisionData(episode, gate, note, at) {
  episode.production = episode.production ?? {};
  episode.production.feedback = {
    ...(episode.production.feedback ?? {}),
    [gate]: { text: note, at, version: currentGateVersion(episode, gate) }
  };

  if (gate === "research") {
    episode.research = { ...(episode.research ?? {}), needsRevision: true };
  }
  if (gate === "script" && episode.production.scriptDraft) {
    episode.production.scriptDraft = { ...episode.production.scriptDraft, needsRevision: true };
  }
  if (gate === "storyboard" && episode.production.storyboardDraft) {
    episode.production.storyboardDraft = {
      ...episode.production.storyboardDraft,
      needsRevision: true
    };
  }
  if (gate === "assets") {
    if (episode.production.assetPlan) {
      episode.production.assetPlan = { ...episode.production.assetPlan, needsRevision: true };
    }
    episode.voice = { ...(episode.voice ?? {}), needsRevision: true };
  }

  if (["research", "script", "storyboard", "assets", "final"].includes(gate)) {
    episode.render = { ...(episode.render ?? {}), status: "stale", progress: 0 };
    episode.qa = { ...(episode.qa ?? {}), status: "stale", checkedAt: at };
  }
}

export function applyApprovalDecision(sourceEpisode, options) {
  const { gate, decision } = options;
  if (!APPROVAL_GATE_IDS.has(gate)) throw new Error(`Unknown approval gate: ${gate}`);
  if (!new Set(["approved", "rejected"]).has(decision)) {
    throw new Error(`Unknown approval decision: ${decision}`);
  }
  const note = String(options.note ?? "").trim();
  const actor = typeof options.actor === "string" && options.actor.startsWith("human:")
    ? options.actor.slice(0, 128)
    : null;
  if (decision === "rejected" && !note) throw new Error("驳回时必须填写修改意见");

  const episode = structuredClone(sourceEpisode);
  const at = timestamp(options.now);
  const version = currentGateVersion(episode, gate);
  const previous = createApprovalState(episode.approvals?.[gate]);
  const record = {
    at,
    gate,
    decision,
    note,
    version,
    ...(actor ? { actor } : {})
  };
  episode.approvals = episode.approvals ?? {};
  episode.approvals[gate] = {
    ...previous,
    status: decision,
    at,
    note: decision === "approved" ? note : "",
    feedback: decision === "rejected" ? note : "",
    currentVersion: version,
    history: [...previous.history, record],
    provenance: decision === "approved" ? "reviewed-v2" : null,
    reviewReportId: decision === "approved" ? episode.reviews?.[gate]?.latestReportId ?? null : null,
    artifactHash: decision === "approved" ? currentGateArtifactHash(episode, gate) : null
  };
  episode.approvalHistory = [...(episode.approvalHistory ?? []), record];

  const definition = gateDefinitions.get(gate);
  const reviewStepIndex = episode.pipeline.findIndex((step) => step.id === definition.stepId);
  if (decision === "approved") {
    if (reviewStepIndex >= 0 && episode.pipeline[reviewStepIndex].status === "waiting_approval") {
      episode.pipeline[reviewStepIndex] = {
        ...episode.pipeline[reviewStepIndex],
        status: gate === "final" ? "complete" : "ready",
        progress: gate === "final" ? 1 : episode.pipeline[reviewStepIndex].progress,
        requiresApproval: null,
        message:
          gate === "final"
            ? "技术与内容 QA、人工成片审批均已通过"
            : "人工审批已通过，可以继续运行"
      };
    }
    if (gate === "final") episode.status = "approved";
  } else {
    const restartIndex = episode.pipeline.findIndex((step) => step.id === definition.restartStepId);
    for (let index = restartIndex; index < episode.pipeline.length; index += 1) {
      const step = episode.pipeline[index];
      episode.pipeline[index] = {
        ...step,
        status: index === restartIndex ? "ready" : "pending",
        progress: 0,
        requiresApproval: null,
        message:
          index === restartIndex
            ? `已收到修改意见：${note}`
            : "等待修改后的上一步重新完成"
      };
    }
    resetDownstreamApprovals(episode, restartIndex, gate);
    invalidateReviewForGate(episode, gate);
    markRevisionData(episode, gate, note, at);
    episode.status = "in_production";
  }

  episode.updatedAt = at;
  episode.history = [
    ...(episode.history ?? []),
    {
      at,
      type: decision === "approved" ? "approval" : "rejection",
      gate,
      version,
      message: note || `${gate} 已批准`
    }
  ];
  return { episode, record };
}

export function resetApprovalForVersion(sourceApproval, version) {
  return {
    ...createApprovalState(sourceApproval),
    status: "pending",
    at: null,
    note: "",
    feedback: "",
    currentVersion: version,
    provenance: null,
    reviewReportId: null,
    artifactHash: null
  };
}

export function prepareGateForHumanReview(sourceEpisode, options = {}) {
  const gate = options.gate;
  if (!APPROVAL_GATE_IDS.has(gate)) throw new Error(`Unknown approval gate: ${gate}`);
  const reason = String(options.reason ?? "").trim();
  if (!reason) throw new Error("准备重新审批时必须记录原因");

  const episode = structuredClone(sourceEpisode);
  const definition = gateDefinitions.get(gate);
  const stepIndex = episode.pipeline.findIndex((step) => step.id === definition.stepId);
  const version = currentGateVersion(episode, gate);
  const artifactHash = currentGateArtifactHash(episode, gate);
  if (stepIndex < 0 || !Number.isInteger(version) || !/^[a-f0-9]{64}$/u.test(artifactHash ?? "")) {
    throw new Error(`当前 ${gate} 产物没有可供人工复核的完整版本与哈希`);
  }

  const previous = createApprovalState(episode.approvals?.[gate]);
  const currentStep = episode.pipeline[stepIndex];
  const alreadyPrepared = Boolean(
    previous.status === "pending"
    && previous.currentVersion === version
    && previous.artifactHash === null
    && currentStep.status === "waiting_approval"
    && currentStep.requiresApproval === gate
  );
  if (alreadyPrepared) return { episode, changed: false, version, artifactHash };

  const at = timestamp(options.now);
  episode.approvals[gate] = resetApprovalForVersion(previous, version);
  invalidateReviewForGate(episode, gate);
  resetDownstreamApprovals(episode, stepIndex, gate);

  for (let index = stepIndex; index < episode.pipeline.length; index += 1) {
    const step = episode.pipeline[index];
    episode.pipeline[index] = index === stepIndex
      ? {
          ...step,
          status: "waiting_approval",
          progress: step.progress ?? 0,
          requiresApproval: gate,
          requiresHuman: false,
          message: reason,
          lastError: null
        }
      : {
          ...step,
          status: "pending",
          progress: 0,
          requiresApproval: null,
          requiresHuman: false,
          message: `等待当前 ${gate} Gate 完成`,
          lastError: null
        };
  }

  episode.render = { ...(episode.render ?? {}), status: "stale", progress: 0 };
  episode.qa = { ...(episode.qa ?? {}), status: "stale", checkedAt: at };
  episode.status = "in_production";
  episode.updatedAt = at;
  episode.history = [
    ...(episode.history ?? []),
    {
      at,
      type: "approval-binding-invalidated",
      gate,
      version,
      previousVersion: previous.currentVersion ?? null,
      previousArtifactHash: previous.artifactHash ?? null,
      artifactHash,
      message: reason
    }
  ];
  return { episode, changed: true, version, artifactHash };
}
