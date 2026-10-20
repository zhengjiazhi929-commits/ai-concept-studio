import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {channel} from 'node:diagnostics_channel';
import {spawn} from 'node:child_process';
import {readFile, mkdtemp, access, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, dirname} from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {createOwnedBrowserLauncher} from '../src/server/production/owned-browser-launch.mjs';

const spawnChannel = channel('tracing:child_process.spawn:start');
const executable = '/synthetic/owned-chrome';
const profile = '/synthetic/puppeteer_dev_chrome_profile-fixture';
function fakeChild(pid) {
  const child = new EventEmitter();
  Object.assign(child, {pid, exitCode: null, signalCode: null});
  return child;
}
function publish(child, path = executable) {
  spawnChannel.publish({process: child, options: {file: path,
    args: [path, `--user-data-dir=${profile}`], detached: true}});
}
function fixture(openBrowser) {
  const signals = new EventEmitter(), killed = [], removed = [];
  const launch = createOwnedBrowserLauncher({openBrowser, signalTarget: signals,
    stopChild: async (child, {detached}) => {
      assert.equal(detached, true); killed.push(child.pid); child.exitCode = 1;
    }, removeProfile: async path => removed.push(path)});
  return {launch, signals, killed, removed};
}

test('startup timeout cleans only the captured child and its temporary profile', async () => {
  const timeout = new Error('Timed out after 25000 ms while trying to connect');
  const f = fixture(async () => { publish(fakeChild(101)); throw timeout; });
  await assert.rejects(f.launch('chrome', {browserExecutable: executable}), error => error === timeout);
  assert.deepEqual(f.killed, [101]); assert.deepEqual(f.removed, [profile]);
  assert.equal(f.signals.listenerCount('SIGTERM'), 0);
  assert.equal(f.signals.listenerCount('SIGINT'), 0);
});

test('parallel and unrelated browser starts cannot be cleaned by another invocation', async () => {
  let fail, ready;
  const waiting = new Promise(resolve => { ready = resolve; });
  const f = fixture(async () => { publish(fakeChild(102)); ready(); await new Promise((_, reject) => { fail = reject; }); });
  const pending = f.launch('chrome', {browserExecutable: executable});
  await waiting;
  publish(fakeChild(999)); // Outside this launch's AsyncLocalStorage context.
  const g = fixture(async () => { publish(fakeChild(103)); return {close: async () => {}}; });
  await g.launch('chrome', {browserExecutable: executable});
  fail(new Error('failure'));
  await assert.rejects(pending, /failure/u);
  assert.deepEqual(f.killed, [102]); assert.deepEqual(g.killed, []);
});

test('successful browser is handed off untouched to existing normal close lifecycle', async () => {
  const browser = {close: async () => {}};
  const f = fixture(async () => { publish(fakeChild(104)); return browser; });
  assert.equal(await f.launch('chrome', {browserExecutable: executable}), browser);
  assert.deepEqual(f.killed, []); assert.deepEqual(f.removed, []);
});

test('guard expiry after startup cleans acquired resources before returning a browser', async () => {
  let allowed = true;
  const f = fixture(async () => { publish(fakeChild(105)); allowed = false; return {close: async () => {}}; });
  await assert.rejects(f.launch('chrome', {browserExecutable: executable}, () => { if (!allowed) throw new Error('expired'); }), /expired/u);
  assert.deepEqual(f.killed, [105]); assert.deepEqual(f.removed, [profile]);
});

test('signals during startup stop owned browser and preserve an interruption error', async () => {
  const f = fixture(async () => { publish(fakeChild(106)); f.signals.emit('SIGTERM'); return {close: async () => {}}; });
  await assert.rejects(f.launch('chrome', {browserExecutable: executable}), error => error.code === 'owned_browser_start_interrupted');
  assert.deepEqual(f.killed, [106]);
});

test('no captured process means no broad kill or profile deletion on early rejection', async () => {
  const f = fixture(async () => { throw new Error('executable unavailable'); });
  await assert.rejects(f.launch('chrome', {browserExecutable: executable}), /unavailable/u);
  assert.deepEqual(f.killed, []); assert.deepEqual(f.removed, []);
});

test('cleanup failure preserves the startup cause and does not delete a live process profile', async () => {
  const startup = new Error('handshake rejected');
  const signals = new EventEmitter(); let removed = false;
  const launch = createOwnedBrowserLauncher({signalTarget: signals,
    openBrowser: async () => {publish(fakeChild(108)); throw startup;},
    stopChild: async () => {throw new Error('cannot stop owned child');},
    removeProfile: async () => {removed = true;}
  });
  await assert.rejects(launch('chrome', {browserExecutable: executable}), error =>
    error instanceof AggregateError && error.cause === startup && error.errors.length === 2);
  assert.equal(removed, false); assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('Node runtime publishes actual child spawn ownership before the child starts', async () => {
  let observed;
  const listener = event => { if (event.options.file === process.execPath) observed = event; };
  spawnChannel.subscribe(listener);
  try {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {stdio: 'ignore'});
    assert.equal(observed.process, child); assert.equal(observed.options.detached, false);
    await new Promise((yes, no) => { child.once('error', no); child.once('close', code => code === 0 ? yes() : no(new Error('child failed'))); });
  } finally { spawnChannel.unsubscribe(listener); }
});

test('all three affected render paths use the owned startup lifecycle', async () => {
  for (const file of ['../scripts/render-explainer-full-revision.mjs',
    '../src/server/production/editorial-full-review.mjs', '../src/server/production/editorial-av-review.mjs']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /await openOwnedBrowser\(/u, file);
    assert.doesNotMatch(source, /await openBrowser\(/u, file);
  }
});

test('default cleanup kills a real owned Node subprocess and deletes only its private profile', async t => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'puppeteer_dev_chrome_profile-'));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  let owned;
  const launch = createOwnedBrowserLauncher({openBrowser: async () => {
    owned = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${temporary}`],
      {detached: process.platform !== 'win32', stdio: 'ignore'});
    t.after(() => {if (owned.exitCode === null && owned.signalCode === null) owned.kill('SIGKILL');});
    await new Promise(yes => owned.once('spawn', yes));
    throw new Error('synthetic handshake failure');
  }});
  await assert.rejects(launch('chrome', {browserExecutable: process.execPath}), /synthetic handshake failure/u);
  assert.equal(owned.signalCode, 'SIGKILL');
  await assert.rejects(access(temporary), error => error.code === 'ENOENT');
});

test('actual locked Remotion startup timeout is covered without spawning Chrome', async () => {
  const require = createRequire(import.meta.url);
  const dist = dirname(require.resolve('@remotion/renderer'));
  const manifest = JSON.parse(await readFile(resolve(dist, '../package.json'), 'utf8'));
  assert.equal(manifest.version, '4.0.504');
  const source = await readFile(resolve(dist, 'browser/BrowserRunner.js'), 'utf8');
  const child = fakeChild(107); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const fakeProcess = new EventEmitter(); Object.assign(fakeProcess, {platform: 'darwin', env: {}});
  const imports = {
    'node:child_process': {spawn: (path, args, options) => {
      spawnChannel.publish({process: child, options: {...options, file: path, args}}); return child;
    }},
    'node:path': {join: (...parts) => parts.join('/')},
    '../delete-directory': {deleteDirectory: () => assert.fail('upstream cleanup should not have started')},
    '../linux/wrap-with-setpriv': {wrapExecutableWithSetprivIfAvailable: x => ({executablePath: x.executablePath, args: x.args})},
    '../log-level': {isEqualOrBelowLogLevel: () => false},
    '../logger': {Log: {verbose: () => {}, error: () => {}}}, '../truthy': {truthy: Boolean},
    './assert': {assert: (value, message) => assert.ok(value, message)},
    './Connection': {}, './Errors': {TimeoutError: class TimeoutError extends Error {}},
    './NodeWebSocketTransport': {}, './should-log-message': {},
    './util': {addEventListener: (obj, event, fn) => {obj.on(event, fn); return () => obj.off(event, fn);},
      removeEventListeners: entries => entries.forEach(fn => fn()), isErrnoException: () => false}
  };
  const exported = {};
  vm.runInNewContext(source, {exports: exported, require: name => {
    assert.ok(Object.hasOwn(imports, name), name); return imports[name];
  }, process: fakeProcess, setTimeout, clearTimeout}, {filename: 'locked-BrowserRunner.js'});
  const f = fixture(() => exported.makeBrowserRunner({executablePath: executable,
    processArguments: [`--user-data-dir=${profile}`], userDataDir: profile, logLevel: 'error', indent: false, timeout: 5}));
  await assert.rejects(f.launch('chrome', {browserExecutable: executable}), error => error.constructor.name === 'TimeoutError');
  assert.deepEqual(f.killed, [107]); assert.deepEqual(f.removed, [profile]);
});
