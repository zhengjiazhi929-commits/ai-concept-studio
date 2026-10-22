import test from 'node:test';
import assert from 'node:assert/strict';
import {currentGateArtifactHash, gateArtifactPayload} from '../src/shared/workflow.mjs';

const fixture=()=>({production:{assetBundleRevision:1,assetPlan:{version:1,content:{kind:'editorial-code-asset-plan-v1'}},
  editorialMaterialization:{manifestSha256:'a'.repeat(64),bundlePath:'synthetic/bundle'}},
  assets:[{id:'synthetic-asset',type:'code-animation',path:'synthetic/bundle/index.html',
    materialization:{manifestSha256:'a'.repeat(64),inputPropsSha256:'b'.repeat(64)}}],scenes:[]});

test('Gate 4 binds the whole editorial receipt and per-item bundle binding, not only index.html',()=>{
  const e=fixture();const hash=currentGateArtifactHash(e,'assets');assert.match(hash,/^[a-f0-9]{64}$/u);
  const receipt=structuredClone(e);receipt.production.editorialMaterialization.manifestSha256='c'.repeat(64);
  assert.notEqual(currentGateArtifactHash(receipt,'assets'),hash);
  const asset=structuredClone(e);asset.assets[0].materialization.inputPropsSha256='d'.repeat(64);
  assert.notEqual(currentGateArtifactHash(asset,'assets'),hash);
  assert.deepEqual(gateArtifactPayload(e,'assets').editorialMaterialization,e.production.editorialMaterialization);
});

test('legacy Gate 4 payload shape remains unchanged when editorial materialization is absent',()=>{
  const payload=gateArtifactPayload({production:{},assets:[{id:'legacy'}]},'assets');
  assert.equal(Object.hasOwn(payload,'editorialMaterialization'),false);
  assert.equal(Object.hasOwn(payload.assets[0],'materialization'),false);
});
