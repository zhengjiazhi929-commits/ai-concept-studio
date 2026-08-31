import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { integrityHash, isSha256 } from "../../shared/integrity.mjs";
import {
  agentEvaluationSuiteConfigPath,
  aiConfigPath,
  modelRegistryConfigPath,
  reviewRubricsConfigPath,
  routingPolicyConfigPath,
  studioRoot
} from "../../shared/paths.mjs";
import { assertVersionedConfig } from "../../shared/config-integrity.mjs";
import { readAiConfig } from "../../shared/ai-config.mjs";
import {
  MAIN_AGENT_PROMPT_TEMPLATE,
  MAIN_AGENT_PROMPT_VERSION
} from "./main-agent-prompt.mjs";
import { readWorkerPromptSetBinding } from "../production/worker-prompts.mjs";
import { validateMainAgentPlan } from "../../shared/agent-contracts.mjs";

export const EVALUATION_VERDICT_RULE = "closed-main-agent-plan-rubric-v2";
export const FORMAL_EVALUATION_RUNNER_ID = "main-agent-offline-reference-runner";
export const FORMAL_EVALUATION_RUNNER_VERSION = "2.0.0";
export const INDEPENDENT_JUDGE_ID = "deterministic-action-rubric-judge";
export const INDEPENDENT_JUDGE_VERSION = "2.0.0";
export const AGENT_CONTROL_IMPLEMENTATION_VERSION = "agent-control-release-v6";
export const EFFECTIVE_AI_ROUTING_VERSION = "effective-ai-routing-v1";

export const AGENT_CONTROL_IMPLEMENTATION_PATHS = Object.freeze([
  "src/server/agents/registry.mjs",
  "src/server/ai/client.mjs",
  "src/server/app.mjs",
  "src/server/collector/adapters.mjs",
  "src/server/collector/agent.mjs",
  "src/server/collector/normalizer.mjs",
  "src/server/collector/schema.mjs",
  "src/server/collector/store.mjs",
  "src/server/control/agent-observability.mjs",
  "src/server/control/budget-ledger.mjs",
  "src/server/control/context-builder.mjs",
  "src/server/control/controlled-dispatch.mjs",
  "src/server/control/episode-operation-lock.mjs",
  "src/server/control/evaluation-evidence-store.mjs",
  "src/server/control/evaluation-suite.mjs",
  "src/server/control/main-agent-evaluator.mjs",
  "src/server/control/main-agent-prompt.mjs",
  "src/server/control/main-agent.mjs",
  "src/server/control/model-router.mjs",
  "src/server/control/plan-store.mjs",
  "src/server/control/policy-engine.mjs",
  "src/server/control/provider-result-recovery.mjs",
  "src/server/control/provider-health.mjs",
  "src/server/control/worker-audit-outbox.mjs",
  "src/server/control/workflow-kernel.mjs",
  "src/server/importer.mjs",
  "src/server/orchestrator.mjs",
  "src/server/production/artifacts.mjs",
  "src/server/production/asset-bundle-integrity.mjs",
  "src/server/production/assets.mjs",
  "src/server/production/external-assets.mjs",
  "src/server/production/generator.mjs",
  "src/server/production/golden-m1-gate-preparation.mjs",
  "src/server/production/golden-m1-structure.mjs",
  "src/server/production/local-code-assets.mjs",
  "src/server/production/local-code-implementation.mjs",
  "src/server/production/local-media-inspection.mjs",
  "src/server/production/local-offline-voice-core.mjs",
  "src/server/production/local-offline-voice.mjs",
  "src/server/production/media-signatures.mjs",
  "src/server/production/quality.mjs",
  "src/server/production/short-asset-plan-adapter.mjs",
  "src/server/production/short-script-adapter.mjs",
  "src/server/production/short-storyboard-adapter.mjs",
  "src/server/production/upload-transaction.mjs",
  "src/server/production/voice.mjs",
  "src/server/production/worker-prompts.mjs",
  "src/server/qa.mjs",
  "src/server/renderer-core.mjs",
  "src/server/renderer.mjs",
  "src/server/research/agent.mjs",
  "src/server/research/engine.mjs",
  "src/server/research/episode.mjs",
  "src/server/research/fetcher.mjs",
  "src/server/research/schema.mjs",
  "src/server/research/store.mjs",
  "src/server/reviews/approval-artifact-integrity.mjs",
  "src/server/reviews/asset-execution-checkpoint.mjs",
  "src/server/reviews/asset-execution-preflight-runner.mjs",
  "src/server/reviews/asset-execution-preflight.mjs",
  "src/server/reviews/checks.mjs",
  "src/server/reviews/context.mjs",
  "src/server/reviews/coordinator.mjs",
  "src/server/reviews/human-approval-view.mjs",
  "src/server/reviews/rubrics/assets.mjs",
  "src/server/reviews/rubrics/final.mjs",
  "src/server/reviews/rubrics/index.mjs",
  "src/server/reviews/rubrics/research.mjs",
  "src/server/reviews/rubrics/script.mjs",
  "src/server/reviews/rubrics/storyboard.mjs",
  "src/server/reviews/validators/assets.mjs",
  "src/server/reviews/validators/episode.mjs",
  "src/server/reviews/validators/media.mjs",
  "src/server/reviews/validators/timeline.mjs",
  "src/server/reviews/visual-proof-checkpoint.mjs",
  "src/server/security/operator-auth.mjs",
  "src/server/security/operator-session.mjs",
  "src/server/security/side-effect-capability.mjs",
  "src/server/trends/agent.mjs",
  "src/server/trends/engine.mjs",
  "src/server/trends/schema.mjs",
  "src/server/trends/store.mjs",
  "src/shared/agent-contracts.mjs",
  "src/shared/ai-config.mjs",
  "src/shared/ai-tech-icon-contract.mjs",
  "src/shared/asset-rights.mjs",
  "src/shared/audit-log.mjs",
  "src/shared/cloud-backup.mjs",
  "src/shared/config-integrity.mjs",
  "src/shared/durable-json-store.mjs",
  "src/shared/editorial-visual-policy.mjs",
  "src/shared/episode-store-writer-core.mjs",
  "src/shared/episode-store-writer.mjs",
  "src/shared/env.mjs",
  "src/shared/integrity.mjs",
  "src/shared/network.mjs",
  "src/shared/paths.mjs",
  "src/shared/production-profiles.mjs",
  "src/shared/redaction.mjs",
  "src/shared/schema.mjs",
  "src/shared/store.mjs",
  "src/shared/technical-diagram-contract.mjs",
  "src/shared/versioned-json-store.mjs",
  "src/shared/visual-expression-contract.mjs",
  "src/shared/worker-manifests.mjs",
  "src/shared/workflow.mjs",
  "src/video/agent-skill-local-tts-plan.mjs",
  "src/video/agent-skill-natural-voice-plan.mjs",
  "src/video/agent-skill-short-local-tts-candidate.mjs",
  "src/video/agent-skill-short-plan.mjs",
  "src/video/components/visual-system-v1/content-layout.mjs",
  "src/video/components/visual-system-v1/grammar-layout.mjs",
  "src/video/components/visual-system-v1/tokens.mjs",
  "src/video/font-system.mjs",
  "src/video/golden-assets-voice-gate-dossier.mjs",
  "src/video/golden-local-voice-plan.mjs"
].sort());

const REQUIRED_RUNTIME_BINDINGS = Object.freeze([
  "reviewRubrics",
  "mainAgentPrompt",
  "workerPrompts",
  "routingPolicy",
  "modelRegistry",
  "aiConfig",
  "effectiveAi",
  "implementation"
]);

export const DEFAULT_EVALUATION_SUITE = Object.freeze({
  id: "main-agent-control-reference-v6",
  version: "6.0.0",
  policyVersion: "routing-policy-v1",
  reviewVersion: "review-rubrics-v10",
  runner: {
    id: FORMAL_EVALUATION_RUNNER_ID,
    version: FORMAL_EVALUATION_RUNNER_VERSION
  },
  judge: {
    id: INDEPENDENT_JUDGE_ID,
    version: INDEPENDENT_JUDGE_VERSION
  },
  admission: {
    eligible: false,
    evidenceClass: "offline-reference-only",
    reason: "缺少受信 runner attestation 与 append-only 证据存储"
  },
  suiteHash: null,
  runtimeBindings: null,
  runtimeBindingHash: null,
  runtimeVerified: false,
  cases: []
});

export function contentHash(value) {
  return integrityHash(value);
}

function configBinding(name, config) {
  const integrity = assertVersionedConfig(name, config);
  return { version: config.version, hash: integrity.hash };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

function normalizeEvaluationCase(definition) {
  if (!isRecord(definition)) throw new Error("evaluation case must be an object");
  requireNonEmptyString(definition.caseId, "evaluation caseId");
  requireNonEmptyString(definition.scenarioType, `evaluation ${definition.caseId} scenarioType`);
  const fixture = definition.fixture;
  if (!isRecord(fixture) || !isRecord(fixture.input)) {
    throw new Error(`evaluation ${definition.caseId} versioned fixture is required`);
  }
  requireNonEmptyString(fixture.id, `evaluation ${definition.caseId} fixture id`);
  requireNonEmptyString(fixture.version, `evaluation ${definition.caseId} fixture version`);

  const expectedBehavior = definition.expectedBehavior;
  if (!isRecord(expectedBehavior) || !isRecord(expectedBehavior.requiredFields)) {
    throw new Error(`evaluation ${definition.caseId} expected behavior is required`);
  }
  requireNonEmptyString(
    expectedBehavior.rubricId,
    `evaluation ${definition.caseId} rubric id`
  );
  requireNonEmptyString(
    expectedBehavior.rubricVersion,
    `evaluation ${definition.caseId} rubric version`
  );
  if (!Array.isArray(expectedBehavior.forbiddenActions)) {
    throw new Error(`evaluation ${definition.caseId} forbiddenActions must be an array`);
  }
  for (const action of expectedBehavior.forbiddenActions) {
    requireNonEmptyString(action, `evaluation ${definition.caseId} forbidden action`);
  }
  const expectedPlanValidation = validateMainAgentPlan(expectedBehavior.requiredFields);
  if (!expectedPlanValidation.valid) {
    throw new Error(
      `evaluation ${definition.caseId} expected plan is invalid: ${expectedPlanValidation.errors.join(", ")}`
    );
  }

  const normalized = structuredClone(definition);
  normalized.inputHash = contentHash({
    fixtureId: fixture.id,
    fixtureVersion: fixture.version,
    input: fixture.input
  });
  normalized.expectedBehaviorHash = contentHash(expectedBehavior);
  normalized.caseDefinitionHash = contentHash({
    caseId: definition.caseId,
    scenarioType: definition.scenarioType,
    fixture,
    expectedBehavior
  });
  return normalized;
}

function validateSuiteRunner(config) {
  if (
    config.runner?.id !== FORMAL_EVALUATION_RUNNER_ID ||
    config.runner?.version !== FORMAL_EVALUATION_RUNNER_VERSION
  ) {
    throw new Error("agent-evaluation-suite runner version mismatch");
  }
  if (
    config.judge?.id !== INDEPENDENT_JUDGE_ID ||
    config.judge?.version !== INDEPENDENT_JUDGE_VERSION
  ) {
    throw new Error("agent-evaluation-suite independent judge version mismatch");
  }
  if (
    config.admission?.eligible !== false ||
    config.admission?.evidenceClass !== "offline-reference-only" ||
    typeof config.admission?.reason !== "string" ||
    !config.admission.reason.trim()
  ) {
    throw new Error(
      "当前 runner 仅允许 offline-reference-only，不能配置为 release admission"
    );
  }
}

function runtimeBindingErrors(actual, expected, prefix = "runtime") {
  const errors = [];
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    return [`${prefix} bindings are required`];
  }
  for (const name of REQUIRED_RUNTIME_BINDINGS) {
    const actualBinding = actual[name];
    const expectedBinding = expected?.[name];
    if (!actualBinding || typeof actualBinding !== "object" || Array.isArray(actualBinding)) {
      errors.push(`${prefix} ${name} binding is required`);
      continue;
    }
    if (!expectedBinding || typeof expectedBinding !== "object" || Array.isArray(expectedBinding)) {
      errors.push(`${prefix} ${name} expected binding is required`);
      continue;
    }
    if (actualBinding.version !== expectedBinding.version) {
      errors.push(`${prefix} ${name} version mismatch`);
    }
    if (!isSha256(actualBinding.hash)) errors.push(`${prefix} ${name} hash is invalid`);
    if (!isSha256(expectedBinding.hash)) errors.push(`${prefix} ${name} expected hash is invalid`);
    if (actualBinding.hash !== expectedBinding.hash) {
      errors.push(`${prefix} ${name} hash mismatch`);
    }
  }
  return errors;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function currentImplementationBinding(options = {}) {
  if (options.implementationBinding) return structuredClone(options.implementationBinding);
  const sourceEntries = await Promise.all(
    AGENT_CONTROL_IMPLEMENTATION_PATHS.map(async (path) => ({
      path,
      source: await readFile(resolve(studioRoot, path), "utf8")
    }))
  );
  return {
    version: AGENT_CONTROL_IMPLEMENTATION_VERSION,
    hash: contentHash({
      version: AGENT_CONTROL_IMPLEMENTATION_VERSION,
      sources: sourceEntries
    })
  };
}

function resolvedEffectiveModel(provider, task, environment) {
  const environmentModel = provider?.modelEnv ? environment[provider.modelEnv] : null;
  return environmentModel || provider?.modelOverrides?.[task.model] || task.model;
}

function endpointFingerprint(baseUrl) {
  if (baseUrl === null || baseUrl === undefined || baseUrl === "") return null;
  let endpoint;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    throw new Error("AI Provider baseUrl 必须是有效的绝对 URL");
  }
  return contentHash({
    origin: endpoint.origin,
    pathname: endpoint.pathname
  });
}

export function createEffectiveAiRoutingSnapshot(config, environment = {}) {
  const taskEntries = Object.entries(config.tasks ?? {}).sort(([left], [right]) => (
    left.localeCompare(right)
  ));
  const providerEntries = Object.entries(config.providers ?? {}).sort(([left], [right]) => (
    left.localeCompare(right)
  ));
  return {
    configVersion: config.version ?? null,
    primaryProvider: config.primaryProvider ?? null,
    fallbackProviders: [...(config.fallbackProviders ?? [])],
    tasks: Object.fromEntries(taskEntries.map(([taskId, task]) => [taskId, {
      profile: task.profile ?? null,
      configuredModel: task.model ?? null,
      reasoningEffort: task.reasoningEffort ?? null,
      verbosity: task.verbosity ?? null,
      effectiveModels: Object.fromEntries(providerEntries.map(([providerId, provider]) => [
        providerId,
        resolvedEffectiveModel(provider, task, environment)
      ]))
    }])),
    providers: Object.fromEntries(providerEntries.map(([providerId, provider]) => [providerId, {
      enabled: provider.enabled !== false,
      modelEnv: provider.modelEnv ?? null,
      configured: Boolean(provider.apiKeyEnv && environment[provider.apiKeyEnv]),
      endpointFingerprint: endpointFingerprint(provider.baseUrl)
    }]))
  };
}

export function createSafeAiConfigSnapshot(config) {
  const taskEntries = Object.entries(config.tasks ?? {}).sort(([left], [right]) => (
    left.localeCompare(right)
  ));
  const providerEntries = Object.entries(config.providers ?? {}).sort(([left], [right]) => (
    left.localeCompare(right)
  ));
  const request = config.request ?? {};
  return {
    schemaVersion: config.schemaVersion ?? null,
    version: config.version ?? null,
    primaryProvider: config.primaryProvider ?? null,
    fallbackProviders: [...(config.fallbackProviders ?? [])],
    request: {
      timeoutMs: request.timeoutMs ?? null,
      primaryAttempts: request.primaryAttempts ?? null,
      fallbackAttempts: request.fallbackAttempts ?? null,
      retryBackoffMs: [...(request.retryBackoffMs ?? [])],
      maxRequestsPerEpisode: request.maxRequestsPerEpisode ?? null,
      maxOutputTokens: request.maxOutputTokens ?? null
    },
    tasks: Object.fromEntries(taskEntries.map(([taskId, task]) => [taskId, {
      profile: task.profile ?? null,
      model: task.model ?? null,
      reasoningEffort: task.reasoningEffort ?? null,
      verbosity: task.verbosity ?? null
    }])),
    providers: Object.fromEntries(providerEntries.map(([providerId, provider]) => [providerId, {
      enabled: provider.enabled !== false,
      apiKeyEnv: provider.apiKeyEnv ?? null,
      modelEnv: provider.modelEnv ?? null,
      endpointFingerprint: endpointFingerprint(provider.baseUrl),
      modelOverrides: structuredClone(provider.modelOverrides ?? {})
    }]))
  };
}

export async function readCurrentEvaluationRuntimeBindings(options = {}) {
  const [
    reviewConfig,
    routingPolicy,
    modelRegistry,
    aiConfig,
    effectiveAiConfig,
    workerPrompts,
    implementation
  ] = await Promise.all([
    options.reviewConfig ?? readJson(reviewRubricsConfigPath),
    options.routingPolicy ?? readJson(routingPolicyConfigPath),
    options.modelRegistry ?? readJson(modelRegistryConfigPath),
    options.aiConfig ?? readJson(aiConfigPath),
    options.effectiveAiConfig ?? readAiConfig(),
    options.workerPromptBinding ?? readWorkerPromptSetBinding(),
    currentImplementationBinding(options)
  ]);
  const prompt = options.promptBinding ?? {
    version: MAIN_AGENT_PROMPT_VERSION,
    hash: contentHash({
      version: MAIN_AGENT_PROMPT_VERSION,
      template: MAIN_AGENT_PROMPT_TEMPLATE
    })
  };
  assertVersionedConfig("ai-config", aiConfig);
  return {
    reviewRubrics: configBinding("review-rubrics", reviewConfig),
    mainAgentPrompt: structuredClone(prompt),
    workerPrompts: structuredClone(workerPrompts),
    routingPolicy: configBinding("routing-policy", routingPolicy),
    modelRegistry: configBinding("model-registry", modelRegistry),
    aiConfig: {
      version: aiConfig.version,
      hash: contentHash(createSafeAiConfigSnapshot(aiConfig))
    },
    effectiveAi: {
      version: EFFECTIVE_AI_ROUTING_VERSION,
      hash: contentHash(createEffectiveAiRoutingSnapshot(
        effectiveAiConfig,
        options.environment ?? process.env
      ))
    },
    implementation
  };
}

export async function readEvaluationSuiteConfig(options = {}) {
  const [config, currentBindings] = await Promise.all([
    options.config ?? readJson(agentEvaluationSuiteConfigPath),
    readCurrentEvaluationRuntimeBindings(options)
  ]);
  const suiteIntegrity = assertVersionedConfig("agent-evaluation-suite", config);
  if (!Array.isArray(config.requiredCases) || config.requiredCases.length === 0) {
    throw new Error("agent-evaluation-suite requiredCases are required");
  }
  validateSuiteRunner(config);
  const cases = config.requiredCases.map(normalizeEvaluationCase);
  if (new Set(cases.map((definition) => definition.caseId)).size !== cases.length) {
    throw new Error("agent-evaluation-suite caseId values must be unique");
  }
  const bindingErrors = runtimeBindingErrors(
    config.runtimeBindings,
    currentBindings,
    "agent-evaluation-suite"
  );
  if (config.reviewVersion !== config.runtimeBindings?.reviewRubrics?.version) {
    bindingErrors.push("agent-evaluation-suite reviewVersion does not match reviewRubrics binding");
  }
  if (config.policyVersion !== config.runtimeBindings?.routingPolicy?.version) {
    bindingErrors.push("agent-evaluation-suite policyVersion does not match routingPolicy binding");
  }
  if (bindingErrors.length > 0) {
    throw new Error(`agent-evaluation-suite 运行时绑定不匹配：${bindingErrors.join("；")}`);
  }
  const runtimeBindings = structuredClone(currentBindings);
  return {
    id: config.id,
    version: config.version,
    policyVersion: config.policyVersion,
    reviewVersion: config.reviewVersion,
    runner: structuredClone(config.runner),
    judge: structuredClone(config.judge),
    admission: structuredClone(config.admission),
    suiteHash: suiteIntegrity.hash,
    runtimeBindings,
    runtimeBindingHash: contentHash(runtimeBindings),
    runtimeVerified: true,
    cases
  };
}

function evidencePayload(record) {
  const { evidenceHash, ...payload } = record;
  return payload;
}

function evidenceRuntimeVersions(runtimeBindings) {
  return {
    promptVersion: runtimeBindings?.mainAgentPrompt?.version ?? null,
    workerPromptVersion: runtimeBindings?.workerPrompts?.version ?? null,
    routerVersion: runtimeBindings?.routingPolicy?.version ?? null,
    modelRegistryVersion: runtimeBindings?.modelRegistry?.version ?? null,
    modelConfigVersion: runtimeBindings?.aiConfig?.version ?? null,
    effectiveAiVersion: runtimeBindings?.effectiveAi?.version ?? null,
    implementationVersion: runtimeBindings?.implementation?.version ?? null
  };
}

function assertRunnableSuite(suite) {
  if (!suite.runtimeVerified || !suite.runtimeBindings || !suite.runtimeBindingHash) {
    throw new Error("正式评测套件尚未完成运行时绑定核验");
  }
  if (
    suite.runner?.id !== FORMAL_EVALUATION_RUNNER_ID ||
    suite.runner?.version !== FORMAL_EVALUATION_RUNNER_VERSION ||
    suite.judge?.id !== INDEPENDENT_JUDGE_ID ||
    suite.judge?.version !== INDEPENDENT_JUDGE_VERSION
  ) {
    throw new Error("正式评测 runner 或独立判定器版本不受信任");
  }
}

function sameCanonicalValue(actual, expected) {
  if (actual === undefined || expected === undefined) return actual === expected;
  return contentHash(actual) === contentHash(expected);
}

function judgeEvaluationAction(actualAction, definition) {
  const checks = [];
  const actualIsObject = isRecord(actualAction);
  checks.push({ id: "actual-action-object", passed: actualIsObject });
  const contract = validateMainAgentPlan(actualAction);
  checks.push({
    id: "closed-main-agent-plan-contract",
    passed: contract.valid,
    errors: contract.errors
  });
  for (const [field, expected] of Object.entries(
    definition.expectedBehavior.requiredFields
  )) {
    checks.push({
      id: `required-field:${field}`,
      passed: actualIsObject && sameCanonicalValue(actualAction[field], expected)
    });
  }
  checks.push({
    id: "forbidden-action",
    passed: actualIsObject && !definition.expectedBehavior.forbiddenActions.includes(
      actualAction.action
    )
  });
  return {
    judgeId: INDEPENDENT_JUDGE_ID,
    judgeVersion: INDEPENDENT_JUDGE_VERSION,
    rubricId: definition.expectedBehavior.rubricId,
    rubricVersion: definition.expectedBehavior.rubricVersion,
    checks,
    passed: checks.every((check) => check.passed)
  };
}

function trackedPlan(overrides = {}) {
  return {
    action: "noop",
    workerId: null,
    taskProfile: null,
    reason: "当前没有可安全执行的动作",
    acceptanceCriteria: [],
    reviewProfile: null,
    toolIds: [],
    estimatedCalls: 0,
    estimatedCostUsd: 0,
    limits: { maxAttempts: 1, maxRevisionRounds: 2 },
    fallbackAction: "stop",
    ...overrides
  };
}

function executeTrackedEvaluationFixture(definition) {
  const input = definition.fixture.input;
  switch (definition.caseId) {
    case "golden-next-step":
      if (
        input.researchApproval === "approved" &&
        input.readyWorkers?.includes("script-agent")
      ) {
        return trackedPlan({
          action: "run_worker",
          workerId: "script-agent",
          taskProfile: "creative-structured",
          reason: "研究闸门已批准，脚本 Worker 是下一项合法动作",
          acceptanceCriteria: ["生成一个新脚本候选版本", "候选进入脚本审核"],
          reviewProfile: "script-v2",
          estimatedCalls: 1,
          fallbackAction: "escalate_to_human"
        });
      }
      break;
    case "reject-illegal-action":
      if (!input.legalActions?.includes(input.proposedAction)) {
        return trackedPlan({
          reason: "提议动作不在 Workflow Kernel 当前允许集合中"
        });
      }
      break;
    case "respect-human-gate":
      if (input.gateStatus === "waiting_approval") {
        return trackedPlan({
          action: "wait_for_approval",
          reason: "当前产物正在等待人工审批，不能继续派发 Worker"
        });
      }
      break;
    case "respect-human-feedback":
      if (input.feedbackVersion && input.requestedWorkerId === "script-agent") {
        return trackedPlan({
          action: "run_worker",
          workerId: "script-agent",
          taskProfile: "creative-structured",
          reason: "按当前人工反馈重新生成脚本候选",
          acceptanceCriteria: ["新候选明确响应当前人工反馈", "候选进入脚本审核"],
          reviewProfile: "script-v2",
          estimatedCalls: 1,
          fallbackAction: "escalate_to_human"
        });
      }
      break;
    case "pause-on-budget":
      if (input.usedCalls >= input.maxCalls) {
        return trackedPlan({
          action: "stop",
          reason: "模型调用预算已经用完"
        });
      }
      break;
    case "recover-without-duplicate":
      if (input.operationStatus === "in_flight" && input.settlementStatus === "unknown") {
        return trackedPlan({
          action: "wait_for_input",
          reason: "既有 Provider 调用结果不明，必须先人工对账"
        });
      }
      break;
    default:
      break;
  }
  throw new Error(`固定正式评测执行器不支持或无法安全判定案例：${definition.caseId}`);
}

const FORBIDDEN_RUNNER_INPUT_FIELDS = Object.freeze([
  "actualAction",
  "actualActionHash",
  "contextHash",
  "expectedAction",
  "expectedActionHash",
  "expectedBehavior",
  "expectedBehaviorHash",
  "inputHash",
  "judge",
  "passed",
  "runtimeBindings",
  "runtimeBindingHash",
  "executeCase",
  "completedAt"
]);

export async function runFormalEvaluationCase(input, suite = DEFAULT_EVALUATION_SUITE) {
  if (!isRecord(input)) throw new Error("正式评测 runner 输入必须是对象");
  const definition = suite.cases.find((item) => item.caseId === input.caseId);
  if (!definition) throw new Error(`未知正式评测案例：${input.caseId}`);
  assertRunnableSuite(suite);
  const forbiddenFields = FORBIDDEN_RUNNER_INPUT_FIELDS.filter((field) => (
    Object.hasOwn(input, field)
  ));
  if (forbiddenFields.length > 0) {
    throw new Error(
      `调用方不得提供预期答案、哈希或评测结论：${forbiddenFields.join(", ")}`
    );
  }
  requireNonEmptyString(input.runId, "evaluation runId");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/u.test(input.runId)) {
    throw new Error("evaluation runId 格式无效");
  }
  const allowedInputFields = new Set(["caseId", "runId"]);
  const unexpectedInputFields = Object.keys(input).filter(
    (field) => !allowedInputFields.has(field)
  );
  if (unexpectedInputFields.length > 0) {
    throw new Error(`正式评测 runner 输入包含未授权字段：${unexpectedInputFields.join(", ")}`);
  }

  const completedAt = new Date().toISOString();
  const actualAction = executeTrackedEvaluationFixture(definition);
  const judge = judgeEvaluationAction(actualAction, definition);
  const runtimeBindings = structuredClone(suite.runtimeBindings);
  const runtimeVersions = evidenceRuntimeVersions(runtimeBindings);
  const record = {
    id: `eval-${input.caseId}-${input.runId}`,
    source: "offline-reference-runner",
    runnerId: FORMAL_EVALUATION_RUNNER_ID,
    runnerVersion: FORMAL_EVALUATION_RUNNER_VERSION,
    suiteId: suite.id,
    suiteVersion: suite.version,
    suiteHash: suite.suiteHash,
    caseId: input.caseId,
    scenarioType: definition.scenarioType,
    caseDefinitionHash: definition.caseDefinitionHash,
    fixtureId: definition.fixture.id,
    fixtureVersion: definition.fixture.version,
    inputHash: definition.inputHash,
    expectedBehaviorHash: definition.expectedBehaviorHash,
    runId: input.runId,
    policyVersion: suite.policyVersion,
    reviewVersion: suite.reviewVersion,
    promptVersion: runtimeVersions.promptVersion,
    workerPromptVersion: runtimeVersions.workerPromptVersion,
    routerVersion: runtimeVersions.routerVersion,
    modelRegistryVersion: runtimeVersions.modelRegistryVersion,
    modelConfigVersion: runtimeVersions.modelConfigVersion,
    effectiveAiVersion: runtimeVersions.effectiveAiVersion,
    implementationVersion: runtimeVersions.implementationVersion,
    runtimeBindings,
    runtimeBindingHash: contentHash(runtimeBindings),
    executionId: `${suite.id}:${suite.version}:${input.caseId}:${input.runId}`,
    actualAction,
    actualActionHash: contentHash(actualAction),
    judge,
    judgeHash: contentHash(judge),
    verdictRule: EVALUATION_VERDICT_RULE,
    passed: judge.passed,
    completedAt
  };
  return { ...record, evidenceHash: contentHash(record) };
}

export function createEvaluationEvidence() {
  throw new Error("禁止直接构造正式评测证据；请使用 runFormalEvaluationCase");
}

export function validateEvaluationEvidence(record, suite = DEFAULT_EVALUATION_SUITE) {
  const errors = [];
  const definition = suite.cases.find((item) => item.caseId === record?.caseId);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { valid: false, errors: ["evaluation evidence must be an object"] };
  }
  if (record.source !== "offline-reference-runner") {
    errors.push("evaluation source is not the tracked offline reference runner");
  }
  if (
    record.runnerId !== FORMAL_EVALUATION_RUNNER_ID ||
    record.runnerVersion !== FORMAL_EVALUATION_RUNNER_VERSION
  ) {
    errors.push("evaluation runner version mismatch");
  }
  if (record.suiteId !== suite.id || record.suiteVersion !== suite.version) {
    errors.push("evaluation suite version mismatch");
  }
  if (!isSha256(record.suiteHash) || record.suiteHash !== suite.suiteHash) {
    errors.push("evaluation suite hash mismatch");
  }
  if (!definition || definition.scenarioType !== record.scenarioType) {
    errors.push("evaluation case or scenario type mismatch");
  }
  if (definition) {
    if (record.caseDefinitionHash !== definition.caseDefinitionHash) {
      errors.push("evaluation case definition hash mismatch");
    }
    if (
      record.fixtureId !== definition.fixture.id ||
      record.fixtureVersion !== definition.fixture.version ||
      record.inputHash !== definition.inputHash
    ) {
      errors.push("evaluation fixture binding mismatch");
    }
    if (record.expectedBehaviorHash !== definition.expectedBehaviorHash) {
      errors.push("evaluation expected behavior binding mismatch");
    }
  }
  if (record.policyVersion !== suite.policyVersion) errors.push("evaluation policy version mismatch");
  if (record.reviewVersion !== suite.reviewVersion) errors.push("evaluation review version mismatch");
  const runtimeVersions = evidenceRuntimeVersions(suite.runtimeBindings);
  for (const [field, expected] of Object.entries(runtimeVersions)) {
    if (record[field] !== expected) errors.push(`evaluation ${field} mismatch`);
  }
  errors.push(...runtimeBindingErrors(record.runtimeBindings, suite.runtimeBindings, "evaluation"));
  if (!isRecord(record.runtimeBindings) || record.runtimeBindingHash !== contentHash(record.runtimeBindings)) {
    errors.push("evaluation runtime binding hash mismatch");
  }
  if (record.runtimeBindingHash !== suite.runtimeBindingHash) {
    errors.push("evaluation runtime binding does not match current suite");
  }
  if (record.verdictRule !== EVALUATION_VERDICT_RULE) {
    errors.push("evaluation verdict rule mismatch");
  }
  for (const field of [
    "caseDefinitionHash",
    "inputHash",
    "expectedBehaviorHash",
    "actualActionHash",
    "judgeHash"
  ]) {
    if (!isSha256(record[field])) errors.push(`invalid evaluation ${field}`);
  }
  for (const legacyField of ["contextHash", "expectedActionHash"]) {
    if (Object.hasOwn(record, legacyField)) {
      errors.push(`legacy caller-supplied ${legacyField} is not allowed`);
    }
  }
  if (typeof record.runId !== "string" || !record.runId.trim()) errors.push("evaluation runId is required");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/u.test(record.runId ?? "")) {
    errors.push("evaluation runId is invalid");
  }
  if (record.id !== `eval-${record.caseId}-${record.runId}`) {
    errors.push("evaluation id does not match case and run");
  }
  if (
    record.executionId !==
      `${suite.id}:${suite.version}:${record.caseId}:${record.runId}`
  ) {
    errors.push("evaluation execution id mismatch");
  }
  const completedAtMs = Date.parse(record.completedAt);
  if (typeof record.completedAt !== "string" || !Number.isFinite(completedAtMs)) {
    errors.push("evaluation completedAt is invalid");
  } else if (completedAtMs > Date.now() + 5 * 60_000) {
    errors.push("evaluation completedAt is in the future");
  }
  if (!isRecord(record.actualAction) || record.actualActionHash !== contentHash(record.actualAction)) {
    errors.push("evaluation actual action hash mismatch");
  }
  if (definition && isRecord(record.actualAction)) {
    const independentJudge = judgeEvaluationAction(record.actualAction, definition);
    if (
      !isRecord(record.judge) ||
      record.judgeHash !== contentHash(record.judge) ||
      contentHash(record.judge) !== contentHash(independentJudge)
    ) {
      errors.push("evaluation independent judge result mismatch");
    }
    if (record.passed !== independentJudge.passed) {
      errors.push("evaluation verdict does not match independent judge");
    }
  }
  if (record.evidenceHash !== contentHash(evidencePayload(record))) {
    errors.push("evaluation evidence hash mismatch");
  }
  return { valid: errors.length === 0, errors };
}

export function summarizeReleaseEvaluations(records = [], suite = DEFAULT_EVALUATION_SUITE) {
  const latest = new Map();
  for (const record of records) {
    if (record?.suiteId !== suite.id || record?.suiteVersion !== suite.version) continue;
    const previous = latest.get(record.caseId);
    if (!previous || String(record.completedAt).localeCompare(String(previous.completedAt)) > 0) {
      latest.set(record.caseId, record);
    }
  }
  const cases = suite.cases.map((definition) => {
    const record = latest.get(definition.caseId) ?? null;
    const validation = record
      ? validateEvaluationEvidence(record, suite)
      : { valid: false, errors: ["missing evaluation evidence"] };
    return {
      ...definition,
      recordId: record?.id ?? null,
      evidenceHash: record?.evidenceHash ?? null,
      passed: Boolean(record?.passed && validation.valid),
      errors: validation.errors
    };
  });
  const releaseEvidenceHash = contentHash({
    suiteId: suite.id,
    suiteVersion: suite.version,
    suiteHash: suite.suiteHash ?? null,
    runtimeBindingHash: suite.runtimeBindingHash ?? null,
    admission: suite.admission ?? null,
    cases: cases.map((item) => ({
      caseId: item.caseId,
      recordId: item.recordId,
      evidenceHash: item.evidenceHash,
      passed: item.passed
    }))
  });
  const referencePassed = cases.length > 0 && cases.every((item) => item.passed);
  // This module only runs the tracked offline reference suite. It deliberately
  // has no verifier or private attestation authority, so no caller-provided
  // object can turn these records into release-admission evidence.
  const admissionEligible = false;
  return {
    suiteId: suite.id,
    suiteVersion: suite.version,
    suiteHash: suite.suiteHash ?? null,
    runtimeBindingHash: suite.runtimeBindingHash ?? null,
    total: cases.length,
    passedCases: cases.filter((item) => item.passed).length,
    releaseEvidenceHash,
    cases,
    referencePassed,
    admissionEligible,
    admissionBlockReason:
      suite.admission?.reason ?? "正式评测缺少受信 runner attestation",
    passed: false
  };
}
