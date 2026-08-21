export const TECHNICAL_DIAGRAM_CONTRACT_VERSION = "technical-diagram-contract-v3";
export const PROGRESSIVE_KNOWLEDGE_MOTION_LEGACY_VERSION =
  "progressive-knowledge-derivation-v2";
export const PROGRESSIVE_KNOWLEDGE_MOTION_VERSION =
  "progressive-knowledge-derivation-v3";
export const CUMULATIVE_PATH_EMPHASIS_VERSION =
  "cumulative-path-emphasis-v1";
export const TECHNICAL_DIAGRAM_TRANSITION_VERSION =
  "technical-diagram-transition-v1";
export const TECHNICAL_DIAGRAM_TRANSITION_DURATION_SECONDS = 0.6;
export const TECHNICAL_DIAGRAM_TRANSITION_EASING = "ease-in-out-smoothstep";
export const TECHNICAL_DIAGRAM_ARROWHEAD_REVEAL = "continuous-fade";

export const TECHNICAL_DIAGRAM_STYLE = "ai-research-paper-system-diagram";
export const TECHNICAL_DIAGRAM_SEMANTIC_LAYER =
  "generated-geometry-local-label-overlay";
export const TECHNICAL_DIAGRAM_LOCAL_SEMANTIC_LAYER =
  "local-code-semantic-diagram";

export const TECHNICAL_DIAGRAM_REQUIRED_PRIMITIVES = Object.freeze([
  "rectangular-module-nodes",
  "directed-connectors",
  "group-boundaries",
  "clear-flow-order"
]);

export const TECHNICAL_DIAGRAM_FORBIDDEN_PRIMITIVES = Object.freeze([
  "decorative-blobs",
  "cloud-metaphors",
  "gears",
  "rings",
  "waves",
  "ornamental-gradients"
]);

const CONTRACT_KINDS = new Set([
  "technical-architecture",
  "technical-flow",
  "technical-comparison"
]);
const READING_DIRECTIONS = new Set(["top-to-bottom", "left-to-right"]);
const RELATIONS = new Set([
  "guides",
  "invokes",
  "then",
  "discovers-and-calls",
  "connects",
  "returns",
  "has",
  "lacks"
]);
const CONTRACT_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "style",
  "readingDirection",
  "semanticLayer",
  "sourceSceneIds",
  "sourceRequirements",
  "nodes",
  "edges",
  "motionPolicy",
  "requiredPrimitives",
  "forbiddenPrimitives"
]);
const NODE_KEYS = Object.freeze(["id", "label", "role"]);
const EDGE_KEYS = Object.freeze(["id", "from", "to", "relation", "directed"]);
const MOTION_POLICY_LEGACY_KEYS = Object.freeze([
  "schemaVersion",
  "mode",
  "durationSeconds",
  "initialVisibleNodeIds",
  "retainRevealedElements",
  "allowCompleteDiagramAtStart",
  "maxNewNodesPerPhase",
  "transition",
  "phases"
]);
const MOTION_POLICY_KEYS = Object.freeze([
  ...MOTION_POLICY_LEGACY_KEYS,
  "emphasisPolicy"
]);
const TRANSITION_KEYS = Object.freeze([
  "schemaVersion",
  "durationSeconds",
  "easing",
  "bounce",
  "arrowheadReveal"
]);
const PHASE_KEYS = Object.freeze([
  "id",
  "order",
  "kind",
  "startSecond",
  "endSecond",
  "learningObjective",
  "revealNodeIds",
  "activateEdgeIds"
]);
const EMPHASIS_POLICY_KEYS = Object.freeze([
  "schemaVersion",
  "sceneId",
  "mode",
  "fps",
  "sceneStartFrame",
  "sceneEndFrameExclusive",
  "retainHighlightedElements",
  "neutralElements",
  "transition",
  "stages",
  "endBehavior"
]);
const EMPHASIS_NEUTRAL_KEYS = Object.freeze([
  "treatment",
  "nodeIds",
  "edgeIds"
]);
const EMPHASIS_TRANSITION_KEYS = Object.freeze([
  "nodeEnterFrames",
  "edgeDrawFrames",
  "arrowheadFadeFrames",
  "easing",
  "bounce"
]);
const EMPHASIS_STAGE_KEYS = Object.freeze([
  "id",
  "order",
  "label",
  "startFrameOffset",
  "highlightNodeIds",
  "highlightEdgeIds"
]);
const EMPHASIS_END_BEHAVIOR_KEYS = Object.freeze([
  "mode",
  "holdStartFrameOffset",
  "crossfadeStartFrameOffset",
  "crossfadeDurationFrames",
  "outgoingDiagramId",
  "incomingDiagramId",
  "retainHighlightThroughCrossfade",
  "easing",
  "bounce"
]);

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value, expectedKeys) {
  if (!isObject(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  return actualKeys.length === sortedExpected.length &&
    actualKeys.every((key, index) => key === sortedExpected[index]);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueStringArray(values, options = {}) {
  const allowEmpty = options.allowEmpty === true;
  return Array.isArray(values) &&
    (allowEmpty || values.length > 0) &&
    values.every((value) => nonEmptyString(value) && value === value.trim()) &&
    new Set(values).size === values.length;
}

function exactStringArray(left, right) {
  return uniqueStringArray(left) &&
    uniqueStringArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function normalizePrimitive(value) {
  return String(value).trim().toLowerCase().replaceAll(/[\s_]+/gu, "-");
}

function primitiveSet(values) {
  if (!uniqueStringArray(values)) return null;
  const normalized = values.map(normalizePrimitive);
  return new Set(normalized).size === normalized.length ? new Set(normalized) : null;
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function sameNumber(left, right) {
  return Math.abs(Number(left) - Number(right)) < 1e-9;
}

function setExactlyMatches(values, expected) {
  return values.length === expected.size && values.every((value) => expected.has(value));
}

export function progressiveTechnicalFlowPromptDirective(contract) {
  const phases = contract?.motionPolicy?.phases;
  if (!Array.isArray(phases)) return "";
  const phaseDirective = phases.map((phase) => {
    const interval = `${Number(phase.startSecond).toFixed(1)}-${Number(phase.endSecond).toFixed(1)} seconds`;
    if (phase.kind === "hold") {
      return `${interval}: hold the complete diagram unchanged for review`;
    }
    const nodes = Array.isArray(phase.revealNodeIds)
      ? phase.revealNodeIds.join(", ")
      : "";
    const edges = Array.isArray(phase.activateEdgeIds) && phase.activateEdgeIds.length > 0
      ? ` and activate only ${phase.activateEdgeIds.join(", ")}`
      : " with no connector yet";
    return `${interval}: reveal only ${nodes}${edges}`;
  }).join("; ");
  const transition = contract?.motionPolicy?.transition;
  if (!hasExactKeys(transition, TRANSITION_KEYS)) return phaseDirective;
  return `${phaseDirective}; use ${Number(transition.durationSeconds).toFixed(2)}-second smooth ease-in/ease-out transitions with no bounce and continuously faded arrowheads`;
}

function transitionPolicyValid(transition) {
  return hasExactKeys(transition, TRANSITION_KEYS) &&
    transition.schemaVersion === TECHNICAL_DIAGRAM_TRANSITION_VERSION &&
    sameNumber(
      transition.durationSeconds,
      TECHNICAL_DIAGRAM_TRANSITION_DURATION_SECONDS
    ) &&
    transition.easing === TECHNICAL_DIAGRAM_TRANSITION_EASING &&
    transition.bounce === false &&
    transition.arrowheadReveal === TECHNICAL_DIAGRAM_ARROWHEAD_REVEAL;
}

function cumulativePathEmphasisValid(contract, policy, nodeIdSet, edgeIdSet) {
  const emphasis = policy.emphasisPolicy;
  if (!hasExactKeys(emphasis, EMPHASIS_POLICY_KEYS)) return false;
  if (
    emphasis.schemaVersion !== CUMULATIVE_PATH_EMPHASIS_VERSION ||
    emphasis.mode !== "cumulative-path-highlight" ||
    !nonEmptyString(emphasis.sceneId) ||
    !contract.sourceSceneIds.includes(emphasis.sceneId) ||
    !positiveInteger(emphasis.fps) ||
    !nonNegativeInteger(emphasis.sceneStartFrame) ||
    !positiveInteger(emphasis.sceneEndFrameExclusive) ||
    emphasis.sceneEndFrameExclusive <= emphasis.sceneStartFrame ||
    emphasis.retainHighlightedElements !== true ||
    !hasExactKeys(emphasis.neutralElements, EMPHASIS_NEUTRAL_KEYS) ||
    emphasis.neutralElements.treatment !== "base-style-throughout" ||
    !uniqueStringArray(emphasis.neutralElements.nodeIds) ||
    !uniqueStringArray(emphasis.neutralElements.edgeIds) ||
    emphasis.neutralElements.nodeIds.length !== 1 ||
    emphasis.neutralElements.edgeIds.length !== 1 ||
    !emphasis.neutralElements.nodeIds.every((id) => nodeIdSet.has(id)) ||
    !emphasis.neutralElements.edgeIds.every((id) => edgeIdSet.has(id)) ||
    !hasExactKeys(emphasis.transition, EMPHASIS_TRANSITION_KEYS) ||
    !positiveInteger(emphasis.transition.nodeEnterFrames) ||
    !positiveInteger(emphasis.transition.edgeDrawFrames) ||
    !positiveInteger(emphasis.transition.arrowheadFadeFrames) ||
    emphasis.transition.easing !== TECHNICAL_DIAGRAM_TRANSITION_EASING ||
    emphasis.transition.bounce !== false ||
    !Array.isArray(emphasis.stages) ||
    emphasis.stages.length !== 4 ||
    !hasExactKeys(emphasis.endBehavior, EMPHASIS_END_BEHAVIOR_KEYS)
  ) {
    return false;
  }

  const neutralNodeId = emphasis.neutralElements.nodeIds[0];
  const neutralEdgeId = emphasis.neutralElements.edgeIds[0];
  const neutralNode = contract.nodes.find((node) => node.id === neutralNodeId);
  const neutralEdge = contract.edges.find((edge) => edge.id === neutralEdgeId);
  const terminalPhase = policy.phases.at(-1);
  if (
    neutralNode?.role !== "executable-action" ||
    neutralEdge?.relation !== "invokes" ||
    !new Set([neutralEdge?.from, neutralEdge?.to]).has(neutralNodeId) ||
    terminalPhase?.kind !== "hold" ||
    emphasis.sceneStartFrame !== Math.ceil(
      terminalPhase.startSecond * emphasis.fps - 1e-7
    ) ||
    emphasis.sceneEndFrameExclusive !== Math.ceil(
      policy.durationSeconds * emphasis.fps - 1e-7
    )
  ) {
    return false;
  }

  const stageIds = new Set();
  const highlightedNodes = new Set();
  const highlightedEdges = new Set();
  let previousStartFrameOffset = -1;
  let previousCompletionFrameOffset = 0;
  for (const [index, stage] of emphasis.stages.entries()) {
    if (
      !hasExactKeys(stage, EMPHASIS_STAGE_KEYS) ||
      !nonEmptyString(stage.id) ||
      stage.id !== stage.id.trim() ||
      stageIds.has(stage.id) ||
      stage.order !== index + 1 ||
      !nonEmptyString(stage.label) ||
      !nonNegativeInteger(stage.startFrameOffset) ||
      (index === 0 && stage.startFrameOffset !== 0) ||
      stage.startFrameOffset <= previousStartFrameOffset ||
      (index > 0 && stage.startFrameOffset < previousCompletionFrameOffset) ||
      !uniqueStringArray(stage.highlightNodeIds) ||
      stage.highlightNodeIds.length !== 1 ||
      !uniqueStringArray(stage.highlightEdgeIds, { allowEmpty: true }) ||
      (index === 0 && stage.highlightEdgeIds.length !== 0) ||
      (index > 0 && stage.highlightEdgeIds.length !== 1)
    ) {
      return false;
    }
    stageIds.add(stage.id);
    previousStartFrameOffset = stage.startFrameOffset;

    for (const nodeId of stage.highlightNodeIds) {
      if (
        !nodeIdSet.has(nodeId) ||
        highlightedNodes.has(nodeId) ||
        emphasis.neutralElements.nodeIds.includes(nodeId)
      ) {
        return false;
      }
      highlightedNodes.add(nodeId);
    }
    for (const edgeId of stage.highlightEdgeIds) {
      if (
        !edgeIdSet.has(edgeId) ||
        highlightedEdges.has(edgeId) ||
        emphasis.neutralElements.edgeIds.includes(edgeId)
      ) {
        return false;
      }
      const edge = contract.edges.find((candidate) => candidate.id === edgeId);
      if (!highlightedNodes.has(edge.from) || !highlightedNodes.has(edge.to)) {
        return false;
      }
      highlightedEdges.add(edgeId);
    }
    previousCompletionFrameOffset = stage.startFrameOffset + Math.max(
      emphasis.transition.nodeEnterFrames,
      emphasis.transition.edgeDrawFrames + emphasis.transition.arrowheadFadeFrames
    );
  }

  const allCoveredNodes = new Set([
    ...highlightedNodes,
    ...emphasis.neutralElements.nodeIds
  ]);
  const allCoveredEdges = new Set([
    ...highlightedEdges,
    ...emphasis.neutralElements.edgeIds
  ]);
  if (
    !setExactlyMatches([...allCoveredNodes], nodeIdSet) ||
    !setExactlyMatches([...allCoveredEdges], edgeIdSet)
  ) {
    return false;
  }

  const end = emphasis.endBehavior;
  const sceneFrameCount = emphasis.sceneEndFrameExclusive - emphasis.sceneStartFrame;
  return end.mode === "hold-then-crossfade" &&
    end.holdStartFrameOffset === previousCompletionFrameOffset &&
    end.crossfadeStartFrameOffset === sceneFrameCount &&
    end.holdStartFrameOffset < end.crossfadeStartFrameOffset &&
    positiveInteger(end.crossfadeDurationFrames) &&
    nonEmptyString(end.outgoingDiagramId) &&
    nonEmptyString(end.incomingDiagramId) &&
    end.outgoingDiagramId !== end.incomingDiagramId &&
    end.retainHighlightThroughCrossfade === true &&
    end.easing === TECHNICAL_DIAGRAM_TRANSITION_EASING &&
    end.bounce === false;
}

function progressiveMotionPolicyValid(call, contract, nodeIdSet, edgeIdSet, options = {}) {
  const policy = contract.motionPolicy;
  const legacy = policy?.schemaVersion === PROGRESSIVE_KNOWLEDGE_MOTION_LEGACY_VERSION;
  const current = policy?.schemaVersion === PROGRESSIVE_KNOWLEDGE_MOTION_VERSION;
  if (!legacy && !current) return false;
  if (!hasExactKeys(policy, legacy ? MOTION_POLICY_LEGACY_KEYS : MOTION_POLICY_KEYS)) {
    return false;
  }
  if (
    policy.mode !== "progressive-knowledge-derivation" ||
    !Number.isFinite(policy.durationSeconds) ||
    policy.durationSeconds <= 0 ||
    !uniqueStringArray(policy.initialVisibleNodeIds, { allowEmpty: true }) ||
    !policy.initialVisibleNodeIds.every((id) => nodeIdSet.has(id)) ||
    policy.initialVisibleNodeIds.length >= nodeIdSet.size ||
    policy.retainRevealedElements !== true ||
    policy.allowCompleteDiagramAtStart !== false ||
    policy.maxNewNodesPerPhase !== 1 ||
    !transitionPolicyValid(policy.transition) ||
    !Array.isArray(policy.phases) ||
    policy.phases.length < 2
  ) {
    return false;
  }
  if (
    current && options.requireEmphasis === true &&
    !cumulativePathEmphasisValid(contract, policy, nodeIdSet, edgeIdSet)
  ) {
    return false;
  }
  if (
    current && options.requireEmphasis !== true &&
    policy.emphasisPolicy !== null
  ) {
    return false;
  }
  const requestDuration = call?.requestParameters?.duration;
  if (requestDuration !== undefined && !sameNumber(requestDuration, policy.durationSeconds)) {
    return false;
  }

  const phaseIds = new Set();
  const revealedNodes = new Set(policy.initialVisibleNodeIds);
  const activatedEdges = new Set();
  const nodeRevealOrder = new Map(policy.initialVisibleNodeIds.map((id) => [id, 0]));
  let previousEnd = 0;
  for (const [index, phase] of policy.phases.entries()) {
    if (
      !hasExactKeys(phase, PHASE_KEYS) ||
      !nonEmptyString(phase.id) ||
      phase.id !== phase.id.trim() ||
      phaseIds.has(phase.id) ||
      phase.order !== index + 1 ||
      !new Set(["reveal", "hold"]).has(phase.kind) ||
      !finiteNonNegative(phase.startSecond) ||
      !finiteNonNegative(phase.endSecond) ||
      !sameNumber(phase.startSecond, previousEnd) ||
      phase.endSecond <= phase.startSecond ||
      phase.endSecond > policy.durationSeconds ||
      !nonEmptyString(phase.learningObjective) ||
      !uniqueStringArray(phase.revealNodeIds, { allowEmpty: true }) ||
      !uniqueStringArray(phase.activateEdgeIds, { allowEmpty: true })
    ) {
      return false;
    }
    phaseIds.add(phase.id);
    previousEnd = phase.endSecond;

    const isLast = index === policy.phases.length - 1;
    if (phase.kind === "hold") {
      if (
        !isLast ||
        phase.revealNodeIds.length > 0 ||
        phase.activateEdgeIds.length > 0 ||
        phase.endSecond - phase.startSecond < 0.75
      ) {
        return false;
      }
      continue;
    }
    if (
      isLast ||
      phase.revealNodeIds.length === 0 ||
      phase.revealNodeIds.length > policy.maxNewNodesPerPhase ||
      policy.transition.durationSeconds > phase.endSecond - phase.startSecond
    ) {
      return false;
    }
    for (const nodeId of phase.revealNodeIds) {
      if (!nodeIdSet.has(nodeId) || revealedNodes.has(nodeId)) return false;
      revealedNodes.add(nodeId);
      nodeRevealOrder.set(nodeId, phase.order);
    }
    for (const edgeId of phase.activateEdgeIds) {
      if (!edgeIdSet.has(edgeId) || activatedEdges.has(edgeId)) return false;
      const edge = contract.edges.find((candidate) => candidate.id === edgeId);
      if (
        !nodeRevealOrder.has(edge.from) ||
        !nodeRevealOrder.has(edge.to) ||
        nodeRevealOrder.get(edge.from) > phase.order ||
        nodeRevealOrder.get(edge.to) > phase.order
      ) {
        return false;
      }
      activatedEdges.add(edgeId);
    }
  }

  const promptDirective = progressiveTechnicalFlowPromptDirective(contract);
  const promptBound = options.requirePromptDirective === false ||
    String(call?.prompt ?? "").includes(promptDirective);
  return sameNumber(previousEnd, policy.durationSeconds) &&
    setExactlyMatches([...revealedNodes], nodeIdSet) &&
    setExactlyMatches([...activatedEdges], edgeIdSet) &&
    promptDirective.length > 0 &&
    promptBound;
}

export function technicalDiagramContractValid(call, options = {}) {
  const contract = call?.visualContract;
  if (!hasExactKeys(contract, CONTRACT_KEYS)) return false;
  const localCode = call?.productionMethod?.kind === "local-code-animation";
  const expectedSemanticLayer = options.semanticLayer ?? (
    localCode
      ? TECHNICAL_DIAGRAM_LOCAL_SEMANTIC_LAYER
      : TECHNICAL_DIAGRAM_SEMANTIC_LAYER
  );
  if (
    contract.schemaVersion !== TECHNICAL_DIAGRAM_CONTRACT_VERSION ||
    !CONTRACT_KINDS.has(contract.kind) ||
    contract.style !== TECHNICAL_DIAGRAM_STYLE ||
    !READING_DIRECTIONS.has(contract.readingDirection) ||
    contract.semanticLayer !== expectedSemanticLayer ||
    !exactStringArray(contract.sourceSceneIds, call?.sceneIds) ||
    !uniqueStringArray(contract.sourceRequirements)
  ) {
    return false;
  }

  if (
    !Array.isArray(contract.nodes) ||
    contract.nodes.length < 2 ||
    !contract.nodes.every((node) =>
      hasExactKeys(node, NODE_KEYS) &&
      nonEmptyString(node.id) && node.id === node.id.trim() &&
      nonEmptyString(node.label) &&
      nonEmptyString(node.role)
    )
  ) {
    return false;
  }
  const nodeIds = contract.nodes.map((node) => node.id);
  const nodeIdSet = new Set(nodeIds);
  if (nodeIdSet.size !== nodeIds.length) return false;

  if (
    !Array.isArray(contract.edges) ||
    contract.edges.length === 0 ||
    !contract.edges.every((edge) =>
      hasExactKeys(edge, EDGE_KEYS) &&
      nonEmptyString(edge.id) && edge.id === edge.id.trim() &&
      nonEmptyString(edge.from) && edge.from === edge.from.trim() &&
      nonEmptyString(edge.to) && edge.to === edge.to.trim() &&
      edge.from !== edge.to &&
      RELATIONS.has(edge.relation) &&
      edge.directed === true &&
      nodeIdSet.has(edge.from) &&
      nodeIdSet.has(edge.to)
    )
  ) {
    return false;
  }
  const edgeIds = contract.edges.map((edge) => edge.id);
  const edgeIdSet = new Set(edgeIds);
  if (edgeIdSet.size !== edgeIds.length) return false;

  const requiredPrimitives = primitiveSet(contract.requiredPrimitives);
  const forbiddenPrimitives = primitiveSet(contract.forbiddenPrimitives);
  if (!Boolean(
    requiredPrimitives &&
    forbiddenPrimitives &&
    TECHNICAL_DIAGRAM_REQUIRED_PRIMITIVES.every((item) => requiredPrimitives.has(item)) &&
    TECHNICAL_DIAGRAM_FORBIDDEN_PRIMITIVES.every((item) => forbiddenPrimitives.has(item)) &&
    [...requiredPrimitives].every((item) => !forbiddenPrimitives.has(item))
  )) {
    return false;
  }

  const motionRequired = options.requireMotion === true ||
    contract.kind === "technical-flow" ||
    localCode;
  return motionRequired
    ? progressiveMotionPolicyValid(call, contract, nodeIdSet, edgeIdSet, {
        requirePromptDirective: options.requirePromptDirective ?? !localCode,
        requireEmphasis: localCode && contract.kind === "technical-architecture"
      })
    : contract.motionPolicy === null;
}

export function localTechnicalDiagramContractValid(item) {
  return item?.productionMethod?.kind === "local-code-animation" &&
    item?.assetType === "technical-diagram" &&
    technicalDiagramContractValid(item, {
      semanticLayer: TECHNICAL_DIAGRAM_LOCAL_SEMANTIC_LAYER,
      requireMotion: true,
      requirePromptDirective: false
    });
}

export function progressiveTechnicalFlowContractValid(call) {
  return call?.visualContract?.kind === "technical-flow" &&
    technicalDiagramContractValid(call);
}

export function localTechnicalDiagramPlanReview(plan) {
  const items = Array.isArray(plan?.items) ? plan.items : [];
  const itemIds = items
    .filter((item) =>
      item?.productionMethod?.kind === "local-code-animation" &&
      item?.assetType === "technical-diagram"
    )
    .map((item) => String(item?.id ?? "unknown"));
  const invalidItemIds = items
    .filter((item) => itemIds.includes(String(item?.id ?? "unknown")))
    .filter((item) => !localTechnicalDiagramContractValid(item))
    .map((item) => String(item?.id ?? "unknown"));
  const motionSchemaVersions = items
    .filter((item) => itemIds.includes(String(item?.id ?? "unknown")))
    .map((item) => item?.visualContract?.motionPolicy?.schemaVersion ?? null);
  const legacySchemaSet = motionSchemaVersions.length > 0 &&
    motionSchemaVersions.every((version) =>
      version === PROGRESSIVE_KNOWLEDGE_MOTION_LEGACY_VERSION
    ) && Number(plan?.sourceStoryboard?.version ?? Number.POSITIVE_INFINITY) <= 4;
  const currentSchemaSet = motionSchemaVersions.length > 0 &&
    motionSchemaVersions.every((version) =>
      version === PROGRESSIVE_KNOWLEDGE_MOTION_VERSION
    );
  const motionSchemaSetPassed = itemIds.length === 0 || legacySchemaSet || currentSchemaSet;
  return {
    required: itemIds.length > 0,
    passed: invalidItemIds.length === 0 && motionSchemaSetPassed,
    schemaVersion: TECHNICAL_DIAGRAM_CONTRACT_VERSION,
    motionSchemaVersion: PROGRESSIVE_KNOWLEDGE_MOTION_VERSION,
    legacyMotionSchemaVersion: PROGRESSIVE_KNOWLEDGE_MOTION_LEGACY_VERSION,
    legacySchemaSet,
    currentSchemaSet,
    motionSchemaSetPassed,
    observedMotionSchemaVersions: [...new Set(motionSchemaVersions)],
    itemIds,
    invalidItemIds
  };
}

function looksLikeGeneratedVideoCall(call) {
  return Boolean(
    call?.visualContract?.kind === "technical-flow" ||
    call?.requestParameters?.duration ||
    /\bmp4\b|\bvideo\b/iu.test(String(call?.outputSpec ?? ""))
  );
}

export function progressiveTechnicalFlowPlanReview(plan) {
  const calls = Array.isArray(plan?.executionPolicy?.externalApiCalls)
    ? plan.executionPolicy.externalApiCalls
    : [];
  const items = Array.isArray(plan?.items) ? plan.items : [];
  const videoCalls = calls.filter(looksLikeGeneratedVideoCall);
  const invalidCallIds = videoCalls
    .filter((call) => !progressiveTechnicalFlowContractValid(call))
    .map((call) => String(call?.id ?? "unknown"));
  const invalidItemIds = items
    .filter((item) => item?.productionMethod?.kind === "external-video-generation")
    .filter((item) => {
      const call = videoCalls.find((candidate) =>
        candidate?.providerId === item?.productionMethod?.externalProvider &&
        candidate?.model === item?.productionMethod?.externalModel &&
        JSON.stringify(candidate?.sceneIds ?? []) === JSON.stringify(item?.sceneIds ?? [])
      );
      return !call ||
        JSON.stringify(call.visualContract ?? null) !==
          JSON.stringify(item.visualContract ?? null);
    })
    .map((item) => String(item?.id ?? "unknown"));
  const localReview = localTechnicalDiagramPlanReview(plan);
  return {
    required: videoCalls.length > 0 || localReview.required,
    passed: invalidCallIds.length === 0 &&
      invalidItemIds.length === 0 &&
      (!localReview.required || localReview.passed),
    schemaVersion: PROGRESSIVE_KNOWLEDGE_MOTION_VERSION,
    callIds: videoCalls.map((call) => String(call?.id ?? "unknown")),
    invalidCallIds,
    invalidItemIds,
    localItemIds: localReview.itemIds,
    invalidLocalItemIds: localReview.invalidItemIds
  };
}
