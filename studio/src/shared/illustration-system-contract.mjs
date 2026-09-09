export const ILLUSTRATION_SYSTEM_CONTRACT_VERSION = "illustration-system-contract-v1";
export const ILLUSTRATION_PROOF_SCHEMA_VERSION = "illustration-proof-candidate-v1";
export const ILLUSTRATION_OBJECT_KINDS = Object.freeze([
  "document", "database", "context", "packet", "version", "comparison"
]);
export const ILLUSTRATION_ACTION_KINDS = Object.freeze([
  "select", "transfer", "reveal", "query", "compare", "restore"
]);

const candidateAuthority = Object.freeze({
  status: "candidate",
  productionApproved: false,
  userAccepted: false,
  finalAccepted: false
});
const forbiddenApprovalFields = Object.freeze([
  "approval", "humanApproval", "productionApproval", "episodeApproval", "finalApproval", "approved"
]);

export class IllustrationContractError extends TypeError {
  constructor(issues) {
    super(issues.map((issue) => `${issue.location}: ${issue.message}`).join("; "));
    this.name = "IllustrationContractError";
    this.code = "illustration_contract_invalid";
    this.issues = issues;
  }
}

function issue(code, location, message) {
  return { code, location, message };
}

function record(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function identifier(value) {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function jsonIssues(value, location = "definition", ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return [];
  if (typeof value === "number" && Number.isFinite(value)) return [];
  if (typeof value !== "object" || ancestors.has(value) ||
      (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return [issue("non-json-value", location, "Expected finite, acyclic JSON data")];
  }
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      return [issue("non-json-value", location, "Sparse arrays and named array properties cannot enter an evidence hash")];
    }
  }
  const next = new Set(ancestors).add(value);
  return Object.entries(value).flatMap(([key, child]) => jsonIssues(child, `${location}.${key}`, next));
}

function authorityIssues(value, location) {
  if (!record(value)) return [];
  return [
    ...Object.entries(candidateAuthority)
      .filter(([key, expected]) => Object.hasOwn(value, key) && value[key] !== expected)
      .map(([key]) => issue("candidate-only", `${location}.${key}`, "Illustration proofs cannot grant approval or acceptance")),
    ...forbiddenApprovalFields.filter((key) => Object.hasOwn(value, key))
      .map((key) => issue("candidate-only", `${location}.${key}`, "Approval records belong to an authorized review workflow, not this proof contract"))
  ];
}

function claimIssues(claimIds, knownClaims, location) {
  if (!Array.isArray(claimIds) || claimIds.length === 0 ||
      claimIds.some((id) => !identifier(id) || (knownClaims && !knownClaims.has(id))) ||
      new Set(claimIds).size !== claimIds.length) {
    return [issue("claim-binding", location, "Expected unique claims that resolve to the sequence explanation")];
  }
  return [];
}

function idIssues(items, location) {
  const seen = new Set();
  return items.flatMap((item, index) => {
    const id = item?.id;
    if (!identifier(id)) return [issue("invalid-id", `${location}.${index}.id`, "Expected a stable object or action identifier")];
    if (seen.has(id)) return [issue("duplicate-id", `${location}.${index}.id`, `Duplicate identifier: ${id}`)];
    seen.add(id);
    return [];
  });
}

function referenceIssues(objectIds, knownIds, location) {
  if (!Array.isArray(objectIds) || objectIds.length === 0 ||
      objectIds.some((id) => !knownIds.has(id)) || new Set(objectIds).size !== objectIds.length) {
    return [issue("object-reference", location, "Expected unique references to existing illustration objects")];
  }
  return [];
}

export function validateIllustrationSequence(value) {
  const issues = jsonIssues(value);
  if (!record(value)) return { valid: false, issues: [issue("sequence-shape", "definition", "Expected a sequence object"), ...issues] };
  issues.push(...authorityIssues(value, "definition"));
  if (value.schemaVersion != null && value.schemaVersion !== ILLUSTRATION_SYSTEM_CONTRACT_VERSION) {
    issues.push(issue("contract-version", "schemaVersion", "Unsupported illustration contract version"));
  }
  if (!identifier(value.id) || (value.version != null && !positiveInteger(value.version))) {
    issues.push(issue("sequence-identity", "id/version", "Expected a stable ID and positive integer version"));
  }
  if (!text(value.title)) issues.push(issue("sequence-title", "title", "A reviewable title is required"));
  const genericGoals = new Set(["animation", "illustration", "动起来", "动画", "插画"]);
  if (!text(value.explanationGoal) || genericGoals.has(value.explanationGoal.trim().toLowerCase())) {
    issues.push(issue("explanation-goal", "explanationGoal", "State what the viewer should understand from the object actions"));
  }
  issues.push(...claimIssues(value.claimIds, null, "claimIds"));
  const knownClaims = new Set(Array.isArray(value.claimIds) ? value.claimIds : []);
  if (!positiveInteger(value.durationInFrames) || !positiveInteger(value.fps)) {
    issues.push(issue("sequence-timing", "durationInFrames/fps", "Duration and FPS must be positive integers"));
  }
  const objects = Array.isArray(value.objects) ? value.objects : [];
  const actions = Array.isArray(value.actions) ? value.actions : [];
  if (objects.length === 0 || actions.length === 0) {
    issues.push(issue("sequence-content", "objects/actions", "A sequence needs visible objects and meaningful actions"));
  }
  issues.push(...idIssues(objects, "objects"), ...idIssues(actions, "actions"));
  const knownIds = new Set(objects.map((item) => item?.id).filter(identifier));
  objects.forEach((object, index) => {
    const location = `objects.${index}`;
    if (!ILLUSTRATION_OBJECT_KINDS.includes(object?.kind)) issues.push(issue("object-kind", `${location}.kind`, "Unregistered illustration object kind"));
    if (!text(object?.label)) issues.push(issue("object-label", `${location}.label`, "Objects need a reviewable semantic label"));
    issues.push(...claimIssues(object?.claimIds, knownClaims, `${location}.claimIds`));
  });
  let previousStart = -1;
  actions.forEach((action, index) => {
    const location = `actions.${index}`;
    if (!ILLUSTRATION_ACTION_KINDS.includes(action?.kind)) issues.push(issue("action-kind", `${location}.kind`, "Unregistered illustration action kind"));
    issues.push(...referenceIssues(action?.objectIds, knownIds, `${location}.objectIds`));
    issues.push(...claimIssues(action?.claimIds, knownClaims, `${location}.claimIds`));
    const { fromFrame, toFrame } = action ?? {};
    // Action intervals are half-open; independent actions may run in parallel.
    if (!Number.isSafeInteger(fromFrame) || !Number.isSafeInteger(toFrame) ||
        fromFrame < 0 || toFrame <= fromFrame || toFrame > value.durationInFrames) {
      issues.push(issue("action-timing", location, "Action frames must satisfy 0 <= fromFrame < toFrame <= durationInFrames"));
    }
    if (fromFrame < previousStart) issues.push(issue("action-order", location, "Actions must be listed in start-frame order"));
    previousStart = fromFrame;
  });
  if (value.checkpoints != null && !Array.isArray(value.checkpoints)) {
    issues.push(issue("checkpoint-shape", "checkpoints", "Expected an array of observable state checkpoints"));
  }
  const checkpoints = Array.isArray(value.checkpoints) ? value.checkpoints : [];
  issues.push(...idIssues(checkpoints, "checkpoints"));
  let previousFrame = -1;
  checkpoints.forEach((checkpoint, index) => {
    const location = `checkpoints.${index}`;
    if (!Number.isSafeInteger(checkpoint?.frame) || checkpoint.frame < 0 || checkpoint.frame >= value.durationInFrames) {
      issues.push(issue("checkpoint-timing", location, "A checkpoint must name a rendered frame within the sequence"));
    }
    if (checkpoint?.frame < previousFrame) issues.push(issue("checkpoint-order", location, "Checkpoints must be listed in frame order"));
    previousFrame = checkpoint?.frame;
    if (!text(checkpoint?.state)) issues.push(issue("checkpoint-state", `${location}.state`, "Describe the observable object state"));
    issues.push(...referenceIssues(checkpoint?.objectIds, knownIds, `${location}.objectIds`));
    issues.push(...claimIssues(checkpoint?.claimIds, knownClaims, `${location}.claimIds`));
  });
  return { valid: issues.length === 0, issues };
}

export function defineIllustrationSequence(input) {
  const review = validateIllustrationSequence(input);
  if (!review.valid) throw new IllustrationContractError(review.issues);
  return deepFreeze({
    ...structuredClone(input),
    schemaVersion: ILLUSTRATION_SYSTEM_CONTRACT_VERSION,
    version: input.version ?? 1,
    ...candidateAuthority
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function hashIllustrationValue(value) {
  const issues = jsonIssues(value, "hashInput");
  if (issues.length) throw new IllustrationContractError(issues);
  // Web Crypto keeps this shared contract usable in Node and browser bundles.
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeEvidence(input, location) {
  const issues = jsonIssues(input, location);
  if (!Array.isArray(input) || input.length === 0) {
    issues.push(issue("evidence-missing", location, "Current artifact fingerprints are required"));
  }
  const paths = new Set();
  for (const [index, artifact] of (Array.isArray(input) ? input : []).entries()) {
    if (!record(artifact) || !text(artifact.path) || !positiveInteger(artifact.bytes) ||
        typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
      issues.push(issue("evidence-integrity", `${location}.${index}`, "Artifacts require path, positive byte length and lowercase SHA-256"));
    }
    if (paths.has(artifact?.path)) issues.push(issue("evidence-duplicate", `${location}.${index}`, "Duplicate artifact path"));
    paths.add(artifact?.path);
  }
  if (issues.length) throw new IllustrationContractError(issues);
  return structuredClone(input).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

// This binds caller-observed bytes; filesystem inspection and human decisions
// remain outside this pure contract. A matching fingerprint is not acceptance.
export async function createIllustrationProofCandidate(input) {
  if (!record(input)) throw new IllustrationContractError([issue("evidence-missing", "candidate", "Current definition and observed evidence are required")]);
  const issues = authorityIssues(input, "candidate");
  if (issues.length) throw new IllustrationContractError(issues);
  const definition = defineIllustrationSequence(input.definition);
  const sourceEvidence = normalizeEvidence(input.sourceEvidence, "sourceEvidence");
  const styleEvidence = normalizeEvidence(input.styleEvidence, "styleEvidence");
  const previewEvidence = normalizeEvidence(input.previewEvidence, "previewEvidence");
  const [definitionSha256, sourceSha256, styleSha256, previewSha256] = await Promise.all([
    definition, sourceEvidence, styleEvidence, previewEvidence
  ].map(hashIllustrationValue));
  const payload = {
    schemaVersion: ILLUSTRATION_PROOF_SCHEMA_VERSION,
    definition, sourceEvidence, styleEvidence, previewEvidence,
    bindings: { definitionSha256, sourceSha256, styleSha256, previewSha256 },
    ...candidateAuthority
  };
  return deepFreeze({ ...payload, candidateHash: await hashIllustrationValue(payload) });
}

export async function verifyIllustrationProofCandidate(candidate, observedEvidence) {
  const issues = authorityIssues(candidate, "candidate");
  if (!record(candidate) || candidate.schemaVersion !== ILLUSTRATION_PROOF_SCHEMA_VERSION) {
    issues.push(issue("proof-version", "candidate.schemaVersion", "Unsupported or missing proof candidate"));
  }
  try {
    const { candidateHash, ...payload } = candidate ?? {};
    if (candidateHash !== await hashIllustrationValue(payload)) {
      issues.push(issue("candidate-tampered", "candidateHash", "Recorded candidate content no longer matches its SHA-256"));
    }
    const current = await createIllustrationProofCandidate(observedEvidence);
    if (candidateHash !== current.candidateHash) {
      issues.push(issue("evidence-stale", "candidateHash", "Current definition, source, style or preview differs from the recorded candidate"));
    }
  } catch (error) {
    if (!(error instanceof IllustrationContractError)) throw error;
    issues.push(...error.issues);
  }
  return deepFreeze({ valid: issues.length === 0, issues, ...candidateAuthority });
}
