import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  StateConflictError,
  writeVersionedJson
} from "../src/shared/versioned-json-store.mjs";
import {
  agentEvaluationSuiteConfigPath,
  aiConfigPath,
  studioRoot
} from "../src/shared/paths.mjs";
import { readAiConfig } from "../src/shared/ai-config.mjs";
import {
  AGENT_CONTROL_IMPLEMENTATION_PATHS,
  AGENT_CONTROL_IMPLEMENTATION_VERSION,
  contentHash,
  createEffectiveAiRoutingSnapshot,
  createEvaluationEvidence,
  createSafeAiConfigSnapshot,
  readCurrentEvaluationRuntimeBindings,
  readEvaluationSuiteConfig,
  runFormalEvaluationCase,
  summarizeReleaseEvaluations,
  validateEvaluationEvidence
} from "../src/server/control/evaluation-suite.mjs";

function resealEvidence(record) {
  const { evidenceHash: _discarded, ...payload } = record;
  return { ...payload, evidenceHash: contentHash(payload) };
}

async function passingReleaseEvidence(suite) {
  return Promise.all(suite.cases.map((definition, index) => runFormalEvaluationCase({
    caseId: definition.caseId,
    runId: `release-${index}`
  }, suite)));
}

function localImportSpecifiers(source) {
  const specifiers = new Set();
  for (const match of source.matchAll(/\bfrom\s*["'](\.[^"']+)["']/gu)) {
    specifiers.add(match[1]);
  }
  for (const match of source.matchAll(/(?:^|\n)\s*import\s*["'](\.[^"']+)["']/gmu)) {
    specifiers.add(match[1]);
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/gu)) {
    specifiers.add(match[1]);
  }
  return [...specifiers];
}

async function resolveLocalImport(fromPath, specifier) {
  const base = resolve(studioRoot, dirname(fromPath), specifier);
  const candidates = [
    base,
    `${base}.mjs`,
    `${base}.js`,
    resolve(base, "index.mjs"),
    resolve(base, "index.js")
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        return relative(studioRoot, candidate).replaceAll("\\", "/");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function implementationStaticImportClosure(initialPaths) {
  const queue = [...initialPaths];
  const closure = new Set();
  while (queue.length > 0) {
    const path = queue.shift();
    if (closure.has(path)) continue;
    closure.add(path);
    const source = await readFile(join(studioRoot, path), "utf8");
    for (const specifier of localImportSpecifiers(source)) {
      const importedPath = await resolveLocalImport(path, specifier);
      assert.ok(importedPath, `无法解析 ${path} 的本地静态依赖 ${specifier}`);
      if (!closure.has(importedPath)) queue.push(importedPath);
    }
  }
  return [...closure].sort();
}

test("跨进程状态写入使用版本比较，过期快照收到明确冲突", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-cas-"));
  const destination = join(directory, "episode.json");
  const options = {
    getVersion: (value) => value?.stateVersion ?? 0,
    setVersion: (value, version) => {
      value.stateVersion = version;
    }
  };
  try {
    const first = await writeVersionedJson(destination, { id: "case", stateVersion: 0 }, {
      ...options,
      expectedVersion: 0
    });
    assert.equal(first.version, 1);
    await assert.rejects(
      writeVersionedJson(destination, { id: "stale", stateVersion: 0 }, {
        ...options,
        expectedVersion: 0
      }),
      (error) => error instanceof StateConflictError && error.statusCode === 409
    );
    const persisted = JSON.parse(await readFile(destination, "utf8"));
    assert.equal(persisted.id, "case");
    assert.equal(persisted.stateVersion, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("正式评测必须覆盖全部类别，且证据被修改后不再允许升级", async () => {
  const suite = await readEvaluationSuiteConfig();
  const records = await passingReleaseEvidence(suite);
  const reference = summarizeReleaseEvaluations(records, suite);
  assert.equal(reference.referencePassed, true);
  assert.equal(reference.admissionEligible, false);
  assert.equal(reference.passed, false);
  assert.match(reference.admissionBlockReason, /attestation/u);
  const callerForgedSuite = structuredClone(suite);
  callerForgedSuite.admission = {
    eligible: true,
    evidenceClass: "trusted-runner-attested",
    attestationVerified: true,
    reason: "caller claims trusted"
  };
  const forgedAdmission = summarizeReleaseEvaluations(records, callerForgedSuite);
  assert.equal(forgedAdmission.referencePassed, true);
  assert.equal(forgedAdmission.admissionEligible, false);
  assert.equal(forgedAdmission.passed, false);
  records[0].passed = false;
  const tampered = summarizeReleaseEvaluations(records, suite);
  assert.equal(tampered.passed, false);
  assert.equal(tampered.referencePassed, false);
  assert.ok(tampered.cases[0].errors.includes("evaluation evidence hash mismatch"));
});

test("正式评测只能由 runner 根据固定 Fixture 和独立规则生成结论", async () => {
  const suite = await readEvaluationSuiteConfig();
  const definition = suite.cases[0];
  assert.equal(definition.fixture.version, "golden-next-step-v2");
  assert.match(definition.inputHash, /^[a-f0-9]{64}$/u);
  assert.match(definition.expectedBehaviorHash, /^[a-f0-9]{64}$/u);

  const evidence = await runFormalEvaluationCase({
    caseId: suite.cases[0].caseId,
    runId: "release-tracked-runner"
  }, suite);
  assert.equal(evidence.passed, true);
  assert.equal(evidence.inputHash, definition.inputHash);
  assert.equal(evidence.expectedBehaviorHash, definition.expectedBehaviorHash);
  assert.equal(evidence.judge.passed, true);
  assert.equal(validateEvaluationEvidence(evidence, suite).valid, true);

  const forged = {
    ...evidence,
    actualActionHash: evidence.expectedBehaviorHash,
    passed: false
  };
  const resealed = resealEvidence(forged);
  const validation = validateEvaluationEvidence(resealed, suite);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("evaluation actual action hash mismatch"));
  assert.ok(validation.errors.includes("evaluation verdict does not match independent judge"));

  const dangerousExtraField = structuredClone(evidence);
  dangerousExtraField.actualAction.providerId = "forbidden-provider";
  dangerousExtraField.actualAction.toolIds = ["paid.unapproved.tool"];
  dangerousExtraField.actualAction.estimatedCostUsd = 999999;
  dangerousExtraField.actualActionHash = contentHash(dangerousExtraField.actualAction);
  const dangerousValidation = validateEvaluationEvidence(
    resealEvidence(dangerousExtraField),
    suite
  );
  assert.equal(dangerousValidation.valid, false);
  assert.ok(
    dangerousValidation.errors.includes("evaluation independent judge result mismatch")
  );

  const future = structuredClone(evidence);
  future.runId = "future-clone";
  future.id = `eval-${future.caseId}-${future.runId}`;
  future.executionId = `${suite.id}:${suite.version}:${future.caseId}:${future.runId}`;
  future.completedAt = "2099-01-01T00:00:00.000Z";
  const futureValidation = validateEvaluationEvidence(resealEvidence(future), suite);
  assert.equal(futureValidation.valid, false);
  assert.ok(futureValidation.errors.includes("evaluation completedAt is in the future"));

  await assert.rejects(
    runFormalEvaluationCase({
      caseId: definition.caseId,
      runId: "caller-supplied-answer",
      expectedActionHash: definition.expectedBehaviorHash,
      actualActionHash: definition.expectedBehaviorHash,
      passed: true,
      executeCase: async () => ({ actualAction: definition.expectedBehavior.requiredFields })
    }, suite),
    /调用方不得提供预期答案、哈希或评测结论/u
  );
  assert.throws(
    () => createEvaluationEvidence({
      caseId: definition.caseId,
      runId: "legacy-self-certified",
      expectedActionHash: definition.expectedBehaviorHash,
      actualActionHash: definition.expectedBehaviorHash
    }, suite),
    /禁止直接构造正式评测证据/u
  );
});

test("正式评测证据强绑定 Rubric、Prompt、Router、模型配置与控制实现", async () => {
  const suite = await readEvaluationSuiteConfig();
  assert.equal(suite.runtimeVerified, true);
  assert.equal(suite.reviewVersion, "review-rubrics-v9");
  assert.equal(suite.runtimeBindings.reviewRubrics.version, "review-rubrics-v9");
  assert.match(suite.suiteHash, /^[a-f0-9]{64}$/u);

  const fieldByBinding = {
    reviewRubrics: "reviewVersion",
    mainAgentPrompt: "promptVersion",
    routingPolicy: "routerVersion",
    modelRegistry: "modelRegistryVersion",
    aiConfig: "modelConfigVersion",
    effectiveAi: "effectiveAiVersion",
    implementation: "implementationVersion"
  };
  for (const [bindingName, versionField] of Object.entries(fieldByBinding)) {
    const records = await passingReleaseEvidence(suite);
    const stale = structuredClone(records[0]);
    stale.runtimeBindings[bindingName] = {
      version: `${stale.runtimeBindings[bindingName].version}-stale`,
      hash: contentHash({ stale: bindingName })
    };
    stale[versionField] = stale.runtimeBindings[bindingName].version;
    if (bindingName === "routingPolicy") stale.policyVersion = stale[versionField];
    stale.runtimeBindingHash = contentHash(stale.runtimeBindings);
    records[0] = resealEvidence(stale);

    const summary = summarizeReleaseEvaluations(records, suite);
    assert.equal(summary.passed, false, `${bindingName} 漂移必须 fail-closed`);
    assert.ok(
      summary.cases[0].errors.includes(`evaluation ${bindingName} version mismatch`),
      `${bindingName} 应报告版本不匹配`
    );
  }

  const suiteDriftRecords = await passingReleaseEvidence(suite);
  suiteDriftRecords[0].suiteHash = contentHash({ stale: "evaluation-suite" });
  suiteDriftRecords[0] = resealEvidence(suiteDriftRecords[0]);
  const suiteDrift = summarizeReleaseEvaluations(suiteDriftRecords, suite);
  assert.equal(suiteDrift.passed, false);
  assert.ok(suiteDrift.cases[0].errors.includes("evaluation suite hash mismatch"));
});

test("implementation 指纹覆盖控制链路的最小安全依赖闭包", async () => {
  const requiredPaths = [
    "src/shared/integrity.mjs",
    "src/shared/config-integrity.mjs",
    "src/shared/paths.mjs",
    "src/shared/env.mjs",
    "src/server/control/policy-engine.mjs",
    "src/shared/worker-manifests.mjs",
    "src/shared/workflow.mjs",
    "src/shared/schema.mjs",
    "src/server/app.mjs",
    "src/server/security/operator-auth.mjs",
    "src/server/security/operator-session.mjs",
    "src/server/security/side-effect-capability.mjs",
    "src/server/control/episode-operation-lock.mjs",
    "src/server/control/provider-health.mjs",
    "src/server/reviews/asset-execution-checkpoint.mjs",
    "src/shared/technical-diagram-contract.mjs",
    "src/server/reviews/checks.mjs",
    "src/server/reviews/rubrics/research.mjs",
    "src/server/reviews/rubrics/script.mjs",
    "src/server/reviews/rubrics/storyboard.mjs",
    "src/server/reviews/rubrics/assets.mjs",
    "src/server/reviews/rubrics/final.mjs",
    "src/server/reviews/validators/episode.mjs",
    "src/server/reviews/validators/timeline.mjs",
    "src/server/reviews/validators/assets.mjs",
    "src/server/reviews/validators/media.mjs",
    "src/server/production/quality.mjs",
    "src/server/production/local-offline-voice-core.mjs",
    "src/server/production/local-offline-voice.mjs"
  ];
  assert.equal(
    new Set(AGENT_CONTROL_IMPLEMENTATION_PATHS).size,
    AGENT_CONTROL_IMPLEMENTATION_PATHS.length,
    "implementation 绑定路径不得重复"
  );
  assert.deepEqual(
    AGENT_CONTROL_IMPLEMENTATION_PATHS,
    [...AGENT_CONTROL_IMPLEMENTATION_PATHS].sort(),
    "implementation 绑定路径必须保持稳定字典序"
  );
  assert.deepEqual(
    AGENT_CONTROL_IMPLEMENTATION_PATHS,
    await implementationStaticImportClosure(AGENT_CONTROL_IMPLEMENTATION_PATHS),
    "implementation 绑定必须覆盖所有本地静态 import/export 与字面量 dynamic import"
  );
  for (const path of requiredPaths) {
    assert.ok(AGENT_CONTROL_IMPLEMENTATION_PATHS.includes(path), `${path} 必须纳入实现绑定`);
  }

  const sources = await Promise.all(AGENT_CONTROL_IMPLEMENTATION_PATHS.map(async (path) => ({
    path,
    source: await readFile(join(studioRoot, path), "utf8")
  })));
  const current = await readCurrentEvaluationRuntimeBindings();
  assert.equal(current.implementation.hash, contentHash({
    version: AGENT_CONTROL_IMPLEMENTATION_VERSION,
    sources
  }));

  const driftedSources = structuredClone(sources);
  driftedSources[0].source += "\n// evaluation binding drift fixture";
  const driftedImplementation = {
    version: AGENT_CONTROL_IMPLEMENTATION_VERSION,
    hash: contentHash({
      version: AGENT_CONTROL_IMPLEMENTATION_VERSION,
      sources: driftedSources
    })
  };
  assert.notEqual(driftedImplementation.hash, current.implementation.hash);
  await assert.rejects(
    readEvaluationSuiteConfig({ implementationBinding: driftedImplementation }),
    /implementation hash mismatch/u
  );
});

test("旧 review-rubrics-v5 评测证据不能给当前 v9 套件放行", async () => {
  const suite = await readEvaluationSuiteConfig();
  const records = await passingReleaseEvidence(suite);
  const stale = structuredClone(records[0]);
  stale.reviewVersion = "review-rubrics-v5";
  stale.runtimeBindings.reviewRubrics = {
    version: "review-rubrics-v5",
    hash: contentHash({ version: "review-rubrics-v5" })
  };
  stale.runtimeBindingHash = contentHash(stale.runtimeBindings);
  records[0] = resealEvidence(stale);

  const summary = summarizeReleaseEvaluations(records, suite);
  assert.equal(summary.passed, false);
  assert.ok(summary.cases[0].errors.includes("evaluation review version mismatch"));
  assert.ok(summary.cases[0].errors.includes("evaluation reviewRubrics version mismatch"));
});

test("评测套件配置声明旧 Rubric 或旧运行时哈希时拒绝加载", async () => {
  const config = JSON.parse(await readFile(agentEvaluationSuiteConfigPath, "utf8"));
  const oldRubric = structuredClone(config);
  oldRubric.reviewVersion = "review-rubrics-v5";
  oldRubric.runtimeBindings.reviewRubrics = {
    version: "review-rubrics-v5",
    hash: contentHash({ version: "review-rubrics-v5" })
  };
  await assert.rejects(
    readEvaluationSuiteConfig({ config: oldRubric }),
    /reviewRubrics version mismatch/u
  );

  const forgedAdmission = structuredClone(config);
  forgedAdmission.admission = {
    eligible: true,
    evidenceClass: "trusted-runner-attested",
    reason: "caller claims it is trusted"
  };
  await assert.rejects(
    readEvaluationSuiteConfig({ config: forgedAdmission }),
    /仅允许 offline-reference-only/u
  );

  const staleRouter = structuredClone(config);
  staleRouter.runtimeBindings.routingPolicy.hash = contentHash({ stale: "routing-policy" });
  await assert.rejects(
    readEvaluationSuiteConfig({ config: staleRouter }),
    /routingPolicy hash mismatch/u
  );
});

test("有效 AI 主通道、local 结果与模型环境覆盖漂移都会使评测绑定失效", async () => {
  const effective = await readAiConfig();
  const providerIds = Object.keys(effective.providers);
  const alternatePrimary = providerIds.find((id) => id !== effective.primaryProvider);
  assert.ok(alternatePrimary, "测试配置至少需要两个 Provider");

  const localEffectiveDrift = structuredClone(effective);
  localEffectiveDrift.primaryProvider = alternatePrimary;
  localEffectiveDrift.fallbackProviders = providerIds.filter((id) => id !== alternatePrimary);
  await assert.rejects(
    readEvaluationSuiteConfig({ effectiveAiConfig: localEffectiveDrift }),
    /effectiveAi hash mismatch/u
  );

  const previousPrimary = process.env.AI_PRIMARY_PROVIDER;
  process.env.AI_PRIMARY_PROVIDER = alternatePrimary;
  try {
    await assert.rejects(
      readEvaluationSuiteConfig(),
      /effectiveAi hash mismatch/u
    );
  } finally {
    if (previousPrimary === undefined) delete process.env.AI_PRIMARY_PROVIDER;
    else process.env.AI_PRIMARY_PROVIDER = previousPrimary;
  }

  const modelEnv = effective.providers[effective.primaryProvider].modelEnv;
  assert.ok(modelEnv, "主 Provider 必须声明模型覆盖环境变量");
  const previousModel = process.env[modelEnv];
  process.env[modelEnv] = "evaluation-drift-model";
  try {
    await assert.rejects(
      readEvaluationSuiteConfig(),
      /effectiveAi hash mismatch/u
    );
  } finally {
    if (previousModel === undefined) delete process.env[modelEnv];
    else process.env[modelEnv] = previousModel;
  }
});

test("有效 AI 指纹只绑定 API key 配置状态，不保存或哈希 key 值", async () => {
  const effective = await readAiConfig();
  const [provider] = Object.values(effective.providers);
  assert.ok(provider.apiKeyEnv, "Provider 必须声明 API key 环境变量名称");
  const environmentA = { [provider.apiKeyEnv]: "secret-alpha" };
  const environmentB = { [provider.apiKeyEnv]: "secret-beta" };
  const environmentMissing = {};
  const bindingsA = await readCurrentEvaluationRuntimeBindings({
    effectiveAiConfig: effective,
    environment: environmentA
  });
  const bindingsB = await readCurrentEvaluationRuntimeBindings({
    effectiveAiConfig: effective,
    environment: environmentB
  });
  const bindingsMissing = await readCurrentEvaluationRuntimeBindings({
    effectiveAiConfig: effective,
    environment: environmentMissing
  });
  assert.equal(bindingsA.effectiveAi.hash, bindingsB.effectiveAi.hash);
  assert.notEqual(bindingsA.effectiveAi.hash, bindingsMissing.effectiveAi.hash);
  const configuredSnapshot = createEffectiveAiRoutingSnapshot(effective, environmentA);
  const missingSnapshot = createEffectiveAiRoutingSnapshot(effective, environmentMissing);
  assert.equal(configuredSnapshot.providers[Object.keys(effective.providers)[0]].configured, true);
  assert.equal(missingSnapshot.providers[Object.keys(effective.providers)[0]].configured, false);
  assert.equal(JSON.stringify(configuredSnapshot).includes("secret-alpha"), false);
  assert.equal(JSON.stringify(configuredSnapshot).includes(provider.apiKeyEnv), false);

  const runtimeEnvironment = {};
  for (const runtimeProvider of Object.values(effective.providers)) {
    if (runtimeProvider.apiKeyEnv && process.env[runtimeProvider.apiKeyEnv]) {
      runtimeEnvironment[runtimeProvider.apiKeyEnv] = "configured";
    }
    if (runtimeProvider.modelEnv && process.env[runtimeProvider.modelEnv]) {
      runtimeEnvironment[runtimeProvider.modelEnv] = process.env[runtimeProvider.modelEnv];
    }
  }
  const driftedEnvironment = { ...runtimeEnvironment };
  if (driftedEnvironment[provider.apiKeyEnv]) delete driftedEnvironment[provider.apiKeyEnv];
  else driftedEnvironment[provider.apiKeyEnv] = "configured";
  const runtimeBindings = await readCurrentEvaluationRuntimeBindings({
    effectiveAiConfig: effective,
    environment: runtimeEnvironment
  });
  const driftedBindings = await readCurrentEvaluationRuntimeBindings({
    effectiveAiConfig: effective,
    environment: driftedEnvironment
  });
  assert.notEqual(runtimeBindings.effectiveAi.hash, driftedBindings.effectiveAi.hash);
  await assert.rejects(
    readEvaluationSuiteConfig({
      effectiveAiConfig: effective,
      environment: driftedEnvironment
    }),
    /effectiveAi hash mismatch/u
  );

  const unsafeConfigA = structuredClone(effective);
  const unsafeConfigB = structuredClone(effective);
  unsafeConfigA.apiKey = "secret-alpha";
  unsafeConfigB.apiKey = "secret-beta";
  const providerId = Object.keys(effective.providers)[0];
  unsafeConfigA.providers[providerId].apiKey = "secret-alpha";
  unsafeConfigB.providers[providerId].apiKey = "secret-beta";
  unsafeConfigA.providers[providerId].baseUrl = "https://example.com/?token=secret-alpha";
  unsafeConfigB.providers[providerId].baseUrl = "https://example.com/?token=secret-beta";
  const unsafeBindingsA = await readCurrentEvaluationRuntimeBindings({
    aiConfig: unsafeConfigA,
    effectiveAiConfig: unsafeConfigA,
    environment: environmentA
  });
  const unsafeBindingsB = await readCurrentEvaluationRuntimeBindings({
    aiConfig: unsafeConfigB,
    effectiveAiConfig: unsafeConfigB,
    environment: environmentA
  });
  assert.equal(unsafeBindingsA.aiConfig.hash, unsafeBindingsB.aiConfig.hash);
  assert.equal(unsafeBindingsA.effectiveAi.hash, unsafeBindingsB.effectiveAi.hash);
  assert.equal(
    JSON.stringify(createSafeAiConfigSnapshot(unsafeConfigA)).includes("secret-alpha"),
    false
  );
});

test("AI 端点绑定只使用净化后的 origin/path 指纹", async () => {
  const base = JSON.parse(await readFile(aiConfigPath, "utf8"));
  const effective = await readAiConfig();
  const providerId = Object.keys(base.providers)[0];
  const endpointA = "https://user-alpha:password@example.com/v1?token=secret-alpha#frag-a";
  const endpointB = "https://user-beta:other@example.com/v1?token=secret-beta#frag-b";

  const baseA = structuredClone(base);
  const baseB = structuredClone(base);
  const effectiveA = structuredClone(effective);
  const effectiveB = structuredClone(effective);
  baseA.providers[providerId].baseUrl = endpointA;
  baseB.providers[providerId].baseUrl = endpointB;
  effectiveA.providers[providerId].baseUrl = endpointA;
  effectiveB.providers[providerId].baseUrl = endpointB;
  const bindingsA = await readCurrentEvaluationRuntimeBindings({
    aiConfig: baseA,
    effectiveAiConfig: effectiveA,
    environment: {}
  });
  const bindingsB = await readCurrentEvaluationRuntimeBindings({
    aiConfig: baseB,
    effectiveAiConfig: effectiveB,
    environment: {}
  });
  assert.equal(bindingsA.aiConfig.hash, bindingsB.aiConfig.hash);
  assert.equal(bindingsA.effectiveAi.hash, bindingsB.effectiveAi.hash);
  const snapshots = JSON.stringify({
    base: createSafeAiConfigSnapshot(baseA),
    effective: createEffectiveAiRoutingSnapshot(effectiveA, {})
  });
  for (const sensitive of ["user-alpha", "password", "secret-alpha", "token="]) {
    assert.equal(snapshots.includes(sensitive), false, `${sensitive} 不得进入端点快照`);
  }

  const originDrift = structuredClone(baseA);
  const pathDrift = structuredClone(effectiveA);
  originDrift.providers[providerId].baseUrl = "https://api.example.net/v1";
  pathDrift.providers[providerId].baseUrl = "https://example.com/v2";
  const originBindings = await readCurrentEvaluationRuntimeBindings({
    aiConfig: originDrift,
    effectiveAiConfig: effectiveA,
    environment: {}
  });
  const pathBindings = await readCurrentEvaluationRuntimeBindings({
    aiConfig: baseA,
    effectiveAiConfig: pathDrift,
    environment: {}
  });
  assert.notEqual(originBindings.aiConfig.hash, bindingsA.aiConfig.hash);
  assert.notEqual(pathBindings.effectiveAi.hash, bindingsA.effectiveAi.hash);
  await assert.rejects(
    readEvaluationSuiteConfig({
      aiConfig: originDrift,
      effectiveAiConfig: effective,
      environment: process.env
    }),
    /aiConfig hash mismatch/u
  );
  await assert.rejects(
    readEvaluationSuiteConfig({
      aiConfig: base,
      effectiveAiConfig: pathDrift,
      environment: process.env
    }),
    /effectiveAi hash mismatch/u
  );
});
