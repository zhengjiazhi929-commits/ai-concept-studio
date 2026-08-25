import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CI_RENDER_SMOKE_COMPOSITION,
  CI_RENDER_SMOKE_CHROME_MODE,
  CI_RENDER_SMOKE_FRAME,
  CI_RENDER_SMOKE_TIMEOUT_MS,
  runCiRenderSmoke
} from "../scripts/ci-render-smoke.mjs";
import { studioRoot, workspaceRoot } from "../src/shared/paths.mjs";

test("CI render smoke 只渲染固定本地 Composition 并清理临时目录", async () => {
  const calls = [];
  const temporaryRoot = "/tmp/acs-ci-render-fixture";
  const result = await runCiRenderSmoke({
    dependencies: {
      mkdtemp: async () => temporaryRoot,
      resolveBrowserExecutable: async () => "/usr/bin/fixture-chrome",
      bundle: async (options) => {
        calls.push({ type: "bundle", options });
        return "http://127.0.0.1:3000";
      },
      selectComposition: async (options) => {
        calls.push({ type: "select", options });
        return { id: options.id, width: 540, height: 960, fps: 15, durationInFrames: 540 };
      },
      renderStill: async (options) => {
        calls.push({ type: "render", options });
      },
      stat: async () => ({ isFile: () => true, size: 1234 }),
      rm: async (path, options) => {
        calls.push({ type: "cleanup", path, options });
      }
    }
  });

  assert.deepEqual(result, {
    compositionId: "ConceptPreview",
    frame: 0,
    bytes: 1234,
    externalCalls: 0,
    liveEpisodesRead: 0
  });
  assert.equal(CI_RENDER_SMOKE_COMPOSITION, "ConceptPreview");
  assert.equal(CI_RENDER_SMOKE_CHROME_MODE, "chrome-for-testing");
  assert.equal(CI_RENDER_SMOKE_FRAME, 0);
  assert.equal(CI_RENDER_SMOKE_TIMEOUT_MS, 120_000);
  assert.equal(calls.find((call) => call.type === "select").options.id, "ConceptPreview");
  assert.equal(calls.find((call) => call.type === "render").options.frame, 0);
  assert.equal(
    calls.find((call) => call.type === "select").options.timeoutInMilliseconds,
    120_000
  );
  assert.equal(
    calls.find((call) => call.type === "select").options.chromeMode,
    "chrome-for-testing"
  );
  assert.equal(
    calls.find((call) => call.type === "render").options.timeoutInMilliseconds,
    120_000
  );
  assert.equal(
    calls.find((call) => call.type === "render").options.chromeMode,
    "chrome-for-testing"
  );
  assert.equal(
    calls.find((call) => call.type === "render").options.browserExecutable,
    "/usr/bin/fixture-chrome"
  );
  assert.deepEqual(calls.at(-1), {
    type: "cleanup",
    path: temporaryRoot,
    options: { recursive: true, force: true }
  });
});

test("CI 与本地 package 共享精确 Node 和 pnpm 版本", async () => {
  const packageDocument = JSON.parse(
    await readFile(resolve(studioRoot, "package.json"), "utf8")
  );
  const nodeVersion = (
    await readFile(resolve(workspaceRoot, ".node-version"), "utf8")
  ).trim();
  const workflow = await readFile(
    resolve(workspaceRoot, ".github", "workflows", "verify.yml"),
    "utf8"
  );
  const pnpmWorkspace = await readFile(
    resolve(studioRoot, "pnpm-workspace.yaml"),
    "utf8"
  );
  const lockfile = await readFile(resolve(studioRoot, "pnpm-lock.yaml"), "utf8");
  const macLauncher = await readFile(
    resolve(studioRoot, "启动AI视频系统.command"),
    "utf8"
  );
  const windowsLauncher = await readFile(
    resolve(studioRoot, "启动AI视频系统.cmd"),
    "utf8"
  );

  assert.equal(nodeVersion, "24.19.0");
  assert.equal(packageDocument.engines.node, nodeVersion);
  assert.equal(packageDocument.engines.pnpm, "11.19.0");
  assert.equal(packageDocument.packageManager, "pnpm@11.19.0");
  assert.equal(packageDocument.scripts["ci:render-smoke"], "node scripts/ci-render-smoke.mjs");
  assert.equal(
    packageDocument.scripts["scan:secrets"],
    "node scripts/scan-tracked-secrets.mjs"
  );
  assert.equal(packageDocument.scripts.check, "node scripts/check-syntax.mjs");
  assert.equal(
    packageDocument.scripts.verify,
    "pnpm scan:secrets && pnpm check && pnpm motion:check && pnpm test && pnpm rehearse:rollback && pnpm ci:render-smoke && pnpm diff:check"
  );
  assert.equal(
    packageDocument.scripts["diff:check"],
    "git diff --check && git diff --cached --check"
  );
  assert.equal(packageDocument.devDependencies.esbuild, "0.28.1");
  assert.equal(packageDocument.dependencies["@phosphor-icons/react"], "2.1.10");
  assert.equal(
    packageDocument.scripts["build:golden-local-voice"],
    "node scripts/build-golden-local-voice-candidate.mjs"
  );
  assert.equal(
    packageDocument.scripts["build:golden-gate-dossier"],
    "node scripts/build-golden-assets-voice-gate-dossier.mjs"
  );
  assert.equal(
    packageDocument.scripts["eval:attested"],
    "node scripts/run-attested-evaluation.mjs"
  );
  assert.equal(
    packageDocument.scripts["rehearse:rollback"],
    "node scripts/rehearse-remediation-rollback.mjs"
  );
  assert.equal(packageDocument.pnpm, undefined);
  assert.match(pnpmWorkspace, /overrides:\n  nanoid: 3\.3\.18/u);
  assert.match(lockfile, /nanoid@3\.3\.18/u);
  assert.doesNotMatch(lockfile, /nanoid@3\.3\.16/u);
  assert.match(workflow, /pnpm install --frozen-lockfile/u);
  assert.match(workflow, /pnpm audit --prod --audit-level high/u);
  assert.match(workflow, /pnpm verify/u);
  assert.match(workflow, /permissions:\n  contents: read/u);
  assert.match(
    workflow,
    /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\.4\.0/u
  );
  assert.match(
    workflow,
    /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4\.4\.0/u
  );
  assert.doesNotMatch(workflow, /uses: actions\/(?:checkout|setup-node)@v\d/u);
  assert.match(workflow, /node scripts\/scan-tracked-secrets\.mjs/u);
  assert.doesNotMatch(workflow, /STUDIO_|OPENAI_|ANTHROPIC_|API_KEY/u);
  assert.match(macLauncher, /expected_node_version="\$\(<\.\.\/\.node-version\)"/u);
  assert.match(macLauncher, /actual_node_version="\$\(node -p 'process\.versions\.node'\)"/u);
  assert.doesNotMatch(macLauncher, /Node\.js 20|node_major >= 20/u);
  assert.match(windowsLauncher, /STUDIO_EXPECTED_NODE/u);
  assert.match(windowsLauncher, /process\.versions\.node/u);
  assert.doesNotMatch(windowsLauncher, /Node\.js 20/u);
});

test("黄金样例文档与运行时保持五道人审 Gate", async () => {
  const processDocument = await readFile(
    resolve(workspaceRoot, "docs", "04-golden-sample-process.md"),
    "utf8"
  );
  for (const gate of [
    "Gate 1（研究）",
    "Gate 2（脚本）",
    "Gate 3（分镜）",
    "Gate 4（素材/声音）",
    "Gate 5（最终成片）"
  ]) {
    assert.match(processDocument, new RegExp(gate.replace(/[()]/gu, "\\$&"), "u"));
  }
  assert.match(processDocument, /五道 Gate/u);
  assert.doesNotMatch(processDocument, /四个审批点/u);
});
