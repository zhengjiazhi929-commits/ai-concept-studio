// Remotion 4.0.504 installs its own close handlers only after the WebSocket
// handshake. Capture ownership before spawn so that failed handshakes do not
// leak Chrome. This does not patch dependencies or scan/kill existing browsers.
import {AsyncLocalStorage} from 'node:async_hooks';
import {channel} from 'node:diagnostics_channel';
import {lstat, realpath, rm} from 'node:fs/promises';
import {basename, dirname} from 'node:path';
import {tmpdir} from 'node:os';

const spawnChannel = channel('tracing:child_process.spawn:start');
const launchContext = new AsyncLocalStorage();
const failure = code => Object.assign(new Error('Owned browser startup did not complete'), {code});

async function removeOwnedProfile(profile) {
  // Only the exact private profile passed to this captured child is eligible.
  // A substituted symlink, parent directory or unrelated path is never removed.
  if (!/^puppeteer_dev_chrome_profile-[a-zA-Z0-9]+$/u.test(basename(profile))) return;
  const [info, parent, temporary] = await Promise.all([
    lstat(profile).catch(error => {if (error.code === 'ENOENT') return null; throw error;}),
    realpath(dirname(profile)), realpath(tmpdir())
  ]);
  if (!info || !info.isDirectory() || info.isSymbolicLink() || parent !== temporary) return;
  const target = await realpath(profile);
  if (dirname(target) !== temporary || basename(target) !== basename(profile)) return;
  await rm(target, {recursive: true, force: true});
}

async function stopOwnedChild(child, {detached}) {
  // exitCode/signalCode belong to the captured ChildProcess, preventing a stale
  // PID from a finished child from being used to signal an unrelated process.
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  let timer;
  const closed = new Promise((yes, no) => {
    child.once('close', yes);
    timer = setTimeout(() => no(failure('owned_browser_cleanup_timeout')), 5_000);
  });
  try {
    try {
      if (detached && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') child.kill('SIGKILL');
    }
    await closed;
  } finally { clearTimeout(timer); }
}

// Dependency seam is for immutable synthetic tests, never accepted from a
// production render request. The sealed export below fixes the actual runtime.
export function createOwnedBrowserLauncher({openBrowser, signalTarget = process,
  stopChild = stopOwnedChild, removeProfile = removeOwnedProfile}) {
  return async function launch(browserName, options, guard = () => {}) {
    guard();
    const owner = {}, children = new Map();
    let interrupted = null, browser = null;
    const stop = entry => entry.stopping ??= Promise.resolve().then(() => stopChild(entry.child, entry));
    const capture = ({process: child, options: spawned}) => {
      if (launchContext.getStore() !== owner || !child || !Array.isArray(spawned?.args)) return;
      const args = spawned.args;
      if (spawned.file !== options.browserExecutable && !args.includes(options.browserExecutable)) return;
      const profiles = args.filter(arg => typeof arg === 'string' && arg.startsWith('--user-data-dir='));
      if (profiles.length !== 1) return;
      const entry = {child, detached: spawned.detached === true, profile: profiles[0].slice('--user-data-dir='.length)};
      children.set(child, entry);
      if (interrupted) void stop(entry).catch(() => {});
    };
    const interrupt = () => {
      interrupted ??= failure('owned_browser_start_interrupted');
      for (const entry of children.values()) void stop(entry).catch(() => {});
    };
    spawnChannel.subscribe(capture);
    signalTarget.once('SIGINT', interrupt); signalTarget.once('SIGTERM', interrupt);
    try {
      browser = await launchContext.run(owner, () => openBrowser(browserName, options));
      if (interrupted) throw interrupted;
      guard();
      return browser; // Existing Remotion close() owns the successful lifecycle.
    } catch (error) {
      const cleanupErrors = [];
      // A guard can fail just after acquisition. Let the successful Remotion
      // instance remove its own handlers too, then retain the owned fallback.
      if (browser?.close) {
        try { await browser.close({silent: true}); }
        catch (cleanupError) { cleanupErrors.push(cleanupError); }
      }
      for (const entry of children.values()) {
        try { await stop(entry); await removeProfile(entry.profile); }
        catch (cleanupError) { cleanupErrors.push(cleanupError); }
      }
      if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors],
        'Browser startup failed and owned-resource cleanup was incomplete', {cause: error});
      throw interrupted ?? error;
    } finally {
      spawnChannel.unsubscribe(capture);
      signalTarget.off('SIGINT', interrupt); signalTarget.off('SIGTERM', interrupt);
    }
  };
}

export async function openOwnedBrowser(browserName, options, guard) {
  const {openBrowser} = await import('@remotion/renderer');
  return createOwnedBrowserLauncher({openBrowser})(browserName, options, guard);
}
