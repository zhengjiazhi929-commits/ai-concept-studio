import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';
import {canonicalJsonDocumentContentSha256 as digest} from '../src/shared/durable-json-store.mjs';

// All callers supply tracked-fixture-derived temporary stores. No wall-clock
// sleeps, production episodes, providers or global clock mutations are used.
export async function assertProductionExpiry(t, {setup, createService, capabilitySpec, method, expireAt}) {
  const f = await setup(t);
  const before = await readFile(f.episodePath, 'utf8');
  const filesBefore = (await readdir(f.root, {recursive: true})).sort();
  const eventsBefore = f.events.length;
  let now = Date.parse('2026-01-01T00:00:00Z');
  const authority = createCapabilityAuthority({secret: 'synthetic-expiry-boundary-00000000000000000000', now: () => now});
  const options = {sideEffectGrant: authority.authorize(capabilitySpec(f.request))};
  let reads = 0;
  let writes = 0;
  const service = createService({...f.deps,
    readEpisode: async (...args) => {
      const value = await f.deps.readEpisode(...args);
      reads += 1;
      if (reads === expireAt) now += 300_001;
      return value;
    },
    writeEpisode: async (...args) => { writes += 1; return f.deps.writeEpisode(...args); }
  });
  await assert.rejects(service[method](f.request, options), error => error.code === 'side_effect_capability_expired');
  assert.equal(writes, 0, 'expired authority must not reach the authoritative writer');
  assert.equal(await readFile(f.episodePath, 'utf8'), before, 'all gates and authoritative bytes are preserved');
  assert.equal(f.events.length, eventsBefore, 'expired operation must not append a success event');
  if (expireAt === 1) assert.deepEqual((await readdir(f.root, {recursive: true})).sort(), filesBefore, 'no files before first write');
  // Rejection must release the operation lock; a freshly authorized retry may
  // adopt verified immutable orphan files, without relaxing any human gate.
  const fresh = {sideEffectGrant: authority.authorize(capabilitySpec(f.request))};
  const result = await f.service[method](f.request, fresh);
  assert.equal(result.status, 'committed');
}

export async function assertProductionAuditExpiry(t, {setup, createService, capabilitySpec, method}) {
  const f = await setup(t);
  const eventsBefore = f.events.length;
  let now = Date.parse('2026-01-01T00:00:00Z');
  let retry = false;
  const authority = createCapabilityAuthority({secret: 'synthetic-audit-expiry-00000000000000000000000', now: () => now});
  const fresh = () => ({sideEffectGrant: authority.authorize(capabilitySpec(f.request))});
  const service = createService({...f.deps,
    readEpisode: async (...args) => {const value = await f.deps.readEpisode(...args); if (retry) now += 300_001; return value;},
    writeEpisode: async (...args) => {const value = await f.deps.writeEpisode(...args); now += 300_001; return value;}
  });
  const result = await service[method](f.request, fresh());
  assert.equal(result.status, 'committed_with_warning', 'expiry after CAS must not falsely report rollback');
  assert.equal(result.audit.status, 'pending');
  assert.equal(result.audit.errorCode, 'side_effect_capability_expired');
  assert.equal(f.events.length, eventsBefore, 'expired grant cannot append an audit event');
  const committed = await readFile(f.episodePath, 'utf8');
  retry = true;
  await assert.rejects(service[method](f.request, fresh()), error => error.code === 'side_effect_capability_expired');
  assert.equal(await readFile(f.episodePath, 'utf8'), committed);
  assert.equal(f.events.length, eventsBefore);
  const recovered = await f.service[method](f.request, fresh());
  assert.equal(recovered.status, 'already_committed');
  assert.equal(await readFile(f.episodePath, 'utf8'), committed, 'audit repair does not duplicate state commit');
}

export async function assertProductionManifestExpiry(t, {setup, capabilitySpec, method, directory, artifactName, manifestName}) {
  const f = await setup(t);
  const before = await readFile(f.episodePath, 'utf8');
  const base = resolve(f.root, 'studio/data/production/episodes', f.request.episodeId, directory, digest(f.request));
  const artifact = resolve(base, artifactName), manifest = resolve(base, manifestName);
  const now = Date.parse('2026-01-01T00:00:00Z');
  const authority = createCapabilityAuthority({secret: 'synthetic-manifest-expiry-000000000000000000000',
    now: () => now + (existsSync(artifact) ? 300_001 : 0)});
  await assert.rejects(f.service[method](f.request, {sideEffectGrant: authority.authorize(capabilitySpec(f.request))}),
    error => error.code === 'side_effect_capability_expired');
  assert.equal(existsSync(artifact), true, 'authorized first immutable artifact is retained');
  assert.equal(existsSync(manifest), false, 'expiry blocks the next immutable write');
  assert.equal(await readFile(f.episodePath, 'utf8'), before);
  const retry = await f.service[method](f.request, {sideEffectGrant: authority.authorize(capabilitySpec(f.request))});
  assert.equal(retry.status, 'committed', 'fresh grant can recover the immutable orphan');
}

export async function assertProductionNullAudit(t, {setup, createService, capabilitySpec, method}) {
  for (const rejected of [null, undefined]) {
    const f = await setup(t);
    const authority = createCapabilityAuthority({secret: 'synthetic-null-audit-000000000000000000000000'});
    const service = createService({...f.deps, appendEvent: async () => {throw rejected;}});
    const result = await service[method](f.request, {sideEffectGrant: authority.authorize(capabilitySpec(f.request))});
    assert.equal(result.status, 'committed_with_warning');
    assert.equal(result.audit.status, 'pending');
    assert.match(result.audit.errorCode, /_audit_pending$/u);
    const committed = await readFile(f.episodePath, 'utf8');
    const recovered = await f.service[method](f.request, {sideEffectGrant: authority.authorize(capabilitySpec(f.request))});
    assert.equal(recovered.status, 'already_committed');
    assert.equal(await readFile(f.episodePath, 'utf8'), committed);
  }
}
