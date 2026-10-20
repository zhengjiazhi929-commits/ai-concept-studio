import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const launcher = fileURLToPath(new URL('../启动AI视频系统.command', import.meta.url));
const shell = ['/bin/zsh', '/usr/bin/zsh'].find(existsSync);

test('Mac launcher parses without executing installation or service startup', t => {
  if (!shell) return t.skip('zsh is not installed on this host');
  const result = spawnSync(shell, ['-f', '-n', launcher], {encoding: 'utf8', timeout: 5_000});
  assert.equal(result.status, 0, result.stderr);
});

async function selectionFixture(t, {cached, pathVersion, bundled}) {
  const root = await mkdtemp(resolve(tmpdir(), 'acs-launcher-selection-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const taskHome = resolve(root, '测试用户 空格');
  const pathBin = resolve(root, 'path bin');
  const bundledPath = resolve(root, 'bundled path', 'pnpm');
  const cachedPath = resolve(taskHome, '.cache/ai-concept-studio/pnpm/11.19.0/package/bin/pnpm.cjs');
  await mkdir(pathBin, {recursive: true});
  async function executable(path, version) {
    await mkdir(dirname(path), {recursive: true});
    // This stub accepts only version discovery; install/start would fail.
    await writeFile(path, `#!/bin/sh\n[ "$#" = 1 ] && [ "$1" = --version ] || exit 99\nprintf '%s\\n' '${version}'\n`, {mode: 0o755});
  }
  if (cached) await executable(cachedPath, cached);
  if (pathVersion) await executable(resolve(pathBin, 'pnpm'), pathVersion);
  if (bundled) await executable(bundledPath, bundled);
  const source = await readFile(launcher, 'utf8');
  const start = source.indexOf('cached_pnpm=');
  const end = source.indexOf('if ! node scripts/check-locked-dependencies.mjs; then');
  assert.ok(start > 0 && end > start);
  const selection = source.slice(start, end).replaceAll('$HOME', '$ACS_LAUNCHER_TEST_HOME');
  assert.doesNotMatch(selection, /start:open|install --frozen/u);
  // Execute only the actual selection/version-check block. A task-specific
  // variable stands in for its HOME reference; real HOME is never changed.
  const script = `set -eu\nexpected_pnpm_version=11.19.0\nbundled_pnpm="$ACS_LAUNCHER_TEST_BUNDLED"\n` +
    `fail_startup() { print -u2 -- "$1"; exit 1; }\n${selection}\nprint -r -- "$studio_pnpm"\n`;
  const result = spawnSync(shell, ['-f', '-c', script], {encoding: 'utf8', timeout: 5_000,
    env: {...process.env, PATH: `${pathBin}:/usr/bin:/bin`, ACS_LAUNCHER_TEST_HOME: taskHome,
      ACS_LAUNCHER_TEST_BUNDLED: bundledPath}});
  return {result, cachedPath, pathPath: resolve(pathBin, 'pnpm'), bundledPath};
}

test('Mac launcher prefers exact cached pnpm over another PATH version with Unicode and spaces', async t => {
  if (!shell) return t.skip('zsh is not installed on this host');
  const f = await selectionFixture(t, {cached: '11.19.0', pathVersion: '11.25.0', bundled: '11.25.0'});
  assert.equal(f.result.status, 0, f.result.stderr); assert.equal(f.result.stdout.trim(), f.cachedPath);
});

test('Mac launcher rejects wrong cached version instead of starting or installing', async t => {
  if (!shell) return t.skip('zsh is not installed on this host');
  const f = await selectionFixture(t, {cached: '11.25.0', pathVersion: '11.19.0'});
  assert.equal(f.result.status, 1); assert.match(f.result.stderr, /pnpm 版本不匹配/u);
});

test('Mac launcher supports exact PATH and bundled fallback without cache', async t => {
  if (!shell) return t.skip('zsh is not installed on this host');
  for (const options of [{pathVersion: '11.19.0', bundled: '11.25.0'}, {bundled: '11.19.0'}]) {
    const f = await selectionFixture(t, options);
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.equal(f.result.stdout.trim(), options.pathVersion ? f.pathPath : f.bundledPath);
  }
});

test('Mac launcher fails clearly when no pnpm candidate exists', async t => {
  if (!shell) return t.skip('zsh is not installed on this host');
  const f = await selectionFixture(t, {});
  assert.equal(f.result.status, 1); assert.match(f.result.stderr, /没有找到项目锁定的 pnpm 11\.19\.0/u);
});
