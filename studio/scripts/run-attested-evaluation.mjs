import { createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  dataRoot,
  ensureInside,
  studioRoot
} from "../src/shared/paths.mjs";
import {
  appendEvaluationEvidence,
  createEvaluationAttestation,
  evaluationEvidenceInfrastructureStatus,
  readEvaluationEvidenceLedger
} from "../src/server/control/evaluation-evidence-store.mjs";
import {
  readEvaluationSuiteConfig,
  runFormalEvaluationCase
} from "../src/server/control/evaluation-suite.mjs";

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

function trustedKeyMap(config) {
  if (config?.schemaVersion !== 1 || !Array.isArray(config.keys)) {
    throw new Error("evaluation trust config 无效");
  }
  return new Map(config.keys
    .filter((item) => item?.status === "trusted")
    .map((item) => {
      if (
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/u.test(String(item.keyId ?? ""))
        || !String(item.publicKeyPem ?? "").includes("BEGIN PUBLIC KEY")
      ) {
        throw new Error("evaluation trust key 无效");
      }
      return [item.keyId, item.publicKeyPem];
    }));
}

const keyId = requiredEnvironment("AI_CONCEPT_STUDIO_EVAL_KEY_ID");
const runnerInstanceId = requiredEnvironment("AI_CONCEPT_STUDIO_EVAL_RUNNER_INSTANCE_ID");
const privateKeyPath = resolve(requiredEnvironment("AI_CONCEPT_STUDIO_EVAL_PRIVATE_KEY_PATH"));
const trustConfigPath = resolve(
  process.env.AI_CONCEPT_STUDIO_EVAL_TRUST_CONFIG_PATH?.trim()
    || resolve(studioRoot, "config", "evaluation-trust.local.json")
);
const ledgerPath = ensureInside(
  dataRoot,
  resolve(
    process.env.AI_CONCEPT_STUDIO_EVAL_LEDGER_PATH?.trim()
      || resolve(dataRoot, "evaluations", "attested-ledger.json")
  )
);
const runPrefix = String(
  process.env.AI_CONCEPT_STUDIO_EVAL_RUN_ID
    || `local-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}`
).replaceAll(/[^a-zA-Z0-9._:-]/gu, "-").slice(0, 48);

const [privateKey, trustConfig, suite] = await Promise.all([
  readFile(privateKeyPath, "utf8"),
  readFile(trustConfigPath, "utf8").then(JSON.parse),
  readEvaluationSuiteConfig()
]);
const trustedKeys = trustedKeyMap(trustConfig);
const trustedPublicKey = trustedKeys.get(keyId);
if (!trustedPublicKey) throw new Error(`keyId ${keyId} 不在本地信任配置中`);
const derivedPublicKey = createPublicKey(privateKey).export({
  type: "spki",
  format: "pem"
}).toString();
if (derivedPublicKey.trim() !== String(trustedPublicKey).trim()) {
  throw new Error("评测私钥与信任配置中的公钥不匹配");
}

for (const [index, definition] of suite.cases.entries()) {
  const evidence = await runFormalEvaluationCase({
    caseId: definition.caseId,
    runId: `${runPrefix}-${index + 1}`
  }, suite);
  const envelope = createEvaluationAttestation(evidence, {
    privateKey,
    keyId,
    runnerInstanceId
  });
  await appendEvaluationEvidence(ledgerPath, envelope, {
    suite,
    trustedKeys
  });
}

const ledger = await readEvaluationEvidenceLedger(ledgerPath, {
  suite,
  trustedKeys
});
const status = evaluationEvidenceInfrastructureStatus(ledger, {
  suite,
  trustedKeys
});
console.log(JSON.stringify({
  ledgerPath,
  keyId,
  runnerInstanceId,
  suiteId: suite.id,
  suiteVersion: suite.version,
  ...status
}, null, 2));
