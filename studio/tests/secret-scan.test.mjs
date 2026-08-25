import test from "node:test";
import assert from "node:assert/strict";
import {
  findHighConfidenceSecrets,
  runTrackedSecretScan
} from "../scripts/scan-tracked-secrets.mjs";

test("tracked secret scan ignores explicit synthetic placeholders", () => {
  const placeholders = [
    "OPENAI_API_KEY=sk-test-placeholder",
    "AWS_ACCESS_KEY_ID=AKIAEXAMPLE",
    "GITHUB_TOKEN=ghp_fixture_value",
    "SLACK_TOKEN=xoxb-placeholder",
    "GOOGLE_API_KEY=AIzaEXAMPLE"
  ].join("\n");

  assert.deepEqual(findHighConfidenceSecrets(placeholders), []);
});

test("tracked secret scan recognizes provider formats without returning values", async () => {
  const syntheticTokens = [
    `AK${"IA"}${"A".repeat(16)}`,
    `gh${"p_"}${"B".repeat(36)}`,
    `sk-${"proj-"}${"C".repeat(40)}`,
    `xo${"xb-"}${"1".repeat(20)}`,
    `AI${"za"}${"D".repeat(35)}`
  ].join("\n");
  const result = await runTrackedSecretScan({
    cwd: "/fixture",
    execFileImpl: async () => ({ stdout: Buffer.from("fixture.env\0") }),
    lstatImpl: async () => ({ isFile: () => true }),
    readFileImpl: async () => Buffer.from(syntheticTokens)
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.findings.map(({ id }) => id),
    ["aws-access-key", "github-token", "openai-api-key", "slack-token", "google-api-key"]
  );
  assert.equal(JSON.stringify(result).includes(syntheticTokens), false);
  assert.deepEqual(
    Object.keys(result.findings[0]).sort(),
    ["id", "line", "path"]
  );
});
