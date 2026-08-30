import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publicRoot } from "../src/shared/paths.mjs";
import {
  fixtureAssetFileDependencies,
  readFixtureEpisode
} from "./episode-fixture.mjs";

const STORE_MODULE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'][^"']*\/src\/shared\/store\.mjs["']/u;

function callArguments(source, callee) {
  const matches = [];
  const call = new RegExp(`\\b${callee}\\s*\\(`, "gu");
  let match;
  while ((match = call.exec(source))) {
    const start = call.lastIndex;
    let depth = 1;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    let index = start;
    for (; index < source.length && depth > 0; index += 1) {
      const character = source[index];
      const next = source[index + 1];
      if (lineComment) {
        if (character === "\n") lineComment = false;
        continue;
      }
      if (blockComment) {
        if (character === "*" && next === "/") {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }
      if (character === "/" && next === "/") {
        lineComment = true;
        index += 1;
      } else if (character === "/" && next === "*") {
        blockComment = true;
        index += 1;
      } else if (["\"", "'", "`"].includes(character)) {
        quote = character;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
      }
    }
    matches.push(source.slice(start, Math.max(start, index - 1)));
  }
  return matches;
}

function forbiddenTestDependencies(source) {
  const reasons = [];
  if (STORE_MODULE_IMPORT.test(source)) reasons.push("production-store-import");
  for (const argumentsSource of callArguments(source, "createStudioServer")) {
    if (!/\breadEpisode\s*:/u.test(argumentsSource)) {
      reasons.push("default-createStudioServer-store");
    }
  }
  return [...new Set(reasons)];
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const url = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      url.pathname = `${url.pathname}/`;
      files.push(...(await sourceFiles(url)));
    } else if (/\.(?:cjs|js|mjs)$/u.test(entry.name)) {
      files.push(url);
    }
  }
  return files;
}

test("Episode 测试夹具每次返回独立副本且不读取 live Episode", async () => {
  const first = await readFixtureEpisode();
  const originalTitle = first.title;
  first.title = "mutated-test-only-title";
  first.pipeline[0].status = "failed";

  const second = await readFixtureEpisode();
  assert.equal(second.id, "golden-001");
  assert.equal(second.title, originalTitle);
  assert.notEqual(second.pipeline[0].status, "failed");
});

test("Episode 测试夹具拒绝未知 ID", async () => {
  await assert.rejects(
    readFixtureEpisode("missing-episode"),
    /Unknown episode fixture/u
  );
});

test("Episode 素材夹具通过严格内存文件表提供存在性与完整性", async () => {
  const episode = await readFixtureEpisode();
  const dependencies = fixtureAssetFileDependencies(episode);
  const asset = episode.assets[0];
  const fixturePath = resolve(publicRoot, asset.path);

  await dependencies.access(fixturePath);
  assert.deepEqual(await dependencies.inspectFileIntegrity(fixturePath), {
    bytes: asset.bytes,
    sha256: asset.sha256
  });
  await assert.rejects(
    dependencies.access(resolve(publicRoot, "episodes/live-only/not-a-fixture.png")),
    (error) => error.code === "ENOENT"
  );
});

test("隔离 guard 覆盖 Store 读写、namespace、dynamic import 与默认 Server", () => {
  const storeCases = [
    'import { readEpisode } from "../src/shared/store.mjs";',
    'import { writeEpisode, listEpisodes } from "../src/shared/store.mjs";',
    'import * as store from "../src/shared/store.mjs";',
    'const store = await import("../src/shared/store.mjs");'
  ];
  for (const source of storeCases) {
    assert.deepEqual(forbiddenTestDependencies(source), ["production-store-import"]);
  }
  for (const source of [
    "await createStudioServer();",
    "await createStudioServer({});",
    "await createStudioServer({ recoverOnStart: false });"
  ]) {
    assert.deepEqual(
      forbiddenTestDependencies(source),
      ["default-createStudioServer-store"]
    );
  }
  assert.deepEqual(
    forbiddenTestDependencies(`await createStudioServer({
      recoverOnStart: false,
      readEpisode: async () => readFixtureEpisode()
    });`),
    []
  );
});

test("测试及其 helper 不得导入正式 Store 或启动默认 Store Server", async () => {
  const testsDirectory = new URL("./", import.meta.url);
  const currentFile = fileURLToPath(import.meta.url);
  const rootPath = fileURLToPath(testsDirectory);
  const offenders = [];

  for (const file of await sourceFiles(testsDirectory)) {
    const path = fileURLToPath(file);
    if (path === currentFile) continue;
    const source = await readFile(file, "utf8");
    for (const reason of forbiddenTestDependencies(source)) {
      offenders.push(`${relative(rootPath, path)}:${reason}`);
    }
  }

  assert.deepEqual(offenders.sort(), []);
});
