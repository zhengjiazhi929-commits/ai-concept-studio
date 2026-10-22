import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, rm, symlink, realpath} from "node:fs/promises";
import filesystem from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {resolve, dirname} from "node:path";
import {tmpdir} from "node:os";
import {inspectInstalledDependencies, installedDependencyIdentityValid, assertInstalledDependencies}
  from "../src/server/production/installed-dependency-integrity.mjs";

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "installed-identity-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const put = async (path, data) => {const target=resolve(root,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,data);};
  await put("package.json",JSON.stringify({dependencies:{sample:"1.0.0"}}));
  await put("node_modules/sample/package.json",JSON.stringify({name:"sample",version:"1.0.0",dependencies:{leaf:"^1.0.0"},optionalDependencies:{absent:"^1"}}));
  await put("node_modules/sample/index.js","module.exports = require('leaf');");
  await put("node_modules/leaf/package.json",JSON.stringify({name:"leaf",version:"1.0.0"}));
  await put("node_modules/leaf/index.js","module.exports = 1;");
  return {root,put};
}
test("identity binds transitive installed bytes and optional absences without depending on absolute root",async t=>{
  const a=await fixture(t), b=await fixture(t);
  const first=await inspectInstalledDependencies(a.root);
  assert.equal(installedDependencyIdentityValid(first),true);
  assert.deepEqual(await inspectInstalledDependencies(b.root),first);
  await a.put("node_modules/leaf/index.js","module.exports = 2;");
  await assert.rejects(assertInstalledDependencies(a.root,first),{code:"installed_dependency_integrity_invalid"});
  assert.notEqual((await inspectInstalledDependencies(a.root)).sha256,first.sha256);
});
test("package-manager links inside modules are accepted but external targets and missing required packages fail",async t=>{
  const a=await fixture(t);
  await mkdir(resolve(a.root,"node_modules/.pnpm"));
  await rm(resolve(a.root,"node_modules/leaf"),{recursive:true});
  await a.put("node_modules/.pnpm/leaf/package.json",JSON.stringify({name:"leaf",version:"1.0.0"}));
  await a.put("node_modules/.pnpm/leaf/index.js","module.exports = 1;");
  await symlink(".pnpm/leaf",resolve(a.root,"node_modules/leaf"));
  assert.equal(installedDependencyIdentityValid(await inspectInstalledDependencies(a.root)),true);
  await rm(resolve(a.root,"node_modules/leaf"));
  await assert.rejects(inspectInstalledDependencies(a.root),{code:"installed_dependency_integrity_invalid"});
  await symlink(a.root,resolve(a.root,"node_modules/leaf"));
  await assert.rejects(inspectInstalledDependencies(a.root),{code:"installed_dependency_integrity_invalid"});
});
test("new package files, changed peer implementations and forged receipts invalidate identity",async t=>{
  const a=await fixture(t);
  const first=await inspectInstalledDependencies(a.root);
  await a.put("node_modules/leaf/extra.js","export const added = true;");
  await assert.rejects(assertInstalledDependencies(a.root,first));
  const forged=structuredClone(first);forged.packages[0].fileCount++;
  assert.equal(installedDependencyIdentityValid(forged),false);
  await a.put("node_modules/sample/package.json",JSON.stringify({name:"sample",version:"1.0.0",peerDependencies:{leaf:"^1.0.0"}}));
  const peer=await inspectInstalledDependencies(a.root);
  await a.put("node_modules/leaf/index.js","module.exports = 3;");
  await assert.rejects(assertInstalledDependencies(a.root,peer));
});

test("undeclared hoisted packages are still bound because Node can resolve them",async t=>{
  const a=await fixture(t);
  await a.put("node_modules/undeclared-leaf/package.json",JSON.stringify({name:"undeclared-leaf",version:"1.0.0"}));
  await a.put("node_modules/undeclared-leaf/index.js","module.exports = 1;");
  await a.put("node_modules/sample/index.js","module.exports = require('undeclared-leaf');");
  const first=await inspectInstalledDependencies(a.root);
  assert.ok(first.packages.some(p=>p.name==="undeclared-leaf"));
  await a.put("node_modules/undeclared-leaf/index.js","module.exports = 2;");
  await assert.rejects(assertInstalledDependencies(a.root,first),{code:"installed_dependency_integrity_invalid"});
});

test("resolvable loose CommonJS files without package.json cannot evade the installation identity",async t=>{
  const a=await fixture(t);
  await a.put("node_modules/loose.js","module.exports = 1;");
  const first=await inspectInstalledDependencies(a.root);
  await a.put("node_modules/loose.js","module.exports = 2;");
  await assert.rejects(assertInstalledDependencies(a.root,first));
});

test("large legitimate bundler cache remains byte-bound without excluding cache directories",async t=>{
  const a=await fixture(t);
  const cache="node_modules/.cache/webpack/remotion-production/0.pack";
  await a.put(cache,"");
  const handle=await filesystem.open(resolve(a.root,cache),"r+");
  try { await handle.truncate(160*1024*1024); } finally { await handle.close(); }
  const first=await inspectInstalledDependencies(a.root);
  assert.equal(installedDependencyIdentityValid(first),true);
  assert.ok(first.looseFiles.some(file=>file.path===cache.slice("node_modules/".length)&&file.bytes===160*1024*1024));
  const changed=await filesystem.open(resolve(a.root,cache),"r+");
  try { await changed.write(Buffer.from([1]),0,1,159*1024*1024); } finally { await changed.close(); }
  await assert.rejects(assertInstalledDependencies(a.root,first),{code:"installed_dependency_integrity_invalid"});
});

test("individual installed files above the bounded 256 MiB budget still fail closed",async t=>{
  const a=await fixture(t);
  await a.put("node_modules/oversized.pack","");
  const handle=await filesystem.open(resolve(a.root,"node_modules/oversized.pack"),"r+");
  try { await handle.truncate(256*1024*1024+1); } finally { await handle.close(); }
  await assert.rejects(inspectInstalledDependencies(a.root),{code:"installed_dependency_integrity_invalid"});
});

test("final revalidation rejects a grown file before allocating another file buffer",async t=>{
  const a=await fixture(t);
  await a.put("node_modules/growing.pack","a");
  const watched=await realpath(resolve(a.root,"node_modules/growing.pack"));
  const original=filesystem.readFile;
  let reads=0;
  t.mock.method(filesystem,"readFile",async (path,...options)=>{
    const bytes=await original(path,...options);
    if (String(path)===watched && ++reads===1) {
      const handle=await filesystem.open(watched,"r+");
      try { await handle.truncate(256*1024*1024+1); } finally { await handle.close(); }
    }
    return bytes;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(inspectInstalledDependencies(a.root),{code:"installed_dependency_integrity_invalid"});
    assert.equal(reads,1,"grown file must be rejected before the final readFile call");
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("retargeting an undeclared hoisted alias between existing packages changes the identity",async t=>{
  const a=await fixture(t);
  for (const name of ["one","two"]) {
    await a.put(`node_modules/.pnpm/${name}/package.json`,JSON.stringify({name,version:"1.0.0"}));
    await a.put(`node_modules/.pnpm/${name}/index.js`,`module.exports = '${name}';`);
  }
  const link=resolve(a.root,"node_modules/undeclared-alias");
  await symlink(".pnpm/one",link);
  const first=await inspectInstalledDependencies(a.root);
  await rm(link);await symlink(".pnpm/two",link);
  await assert.rejects(assertInstalledDependencies(a.root,first));
});

test("nested node_modules aliases bind their logical path and contained target",async t=>{
  const a=await fixture(t);
  await a.put("node_modules/sample/package.json",JSON.stringify({name:"sample",version:"1.0.0"}));
  for (const name of ["one","two"]) {
    await a.put(`node_modules/.pnpm/nest-${name}/node_modules/leaf/package.json`,JSON.stringify({name:"leaf",version:"1.0.0"}));
    await a.put(`node_modules/.pnpm/nest-${name}/node_modules/leaf/index.js`,`module.exports = '${name}';`);
  }
  const link=resolve(a.root,"node_modules/sample/node_modules");
  await symlink("../.pnpm/nest-one/node_modules",link);
  const first=await inspectInstalledDependencies(a.root);
  assert.ok(first.links.some(item=>item.path==="sample/node_modules"&&item.target===".pnpm/nest-one/node_modules"));
  await rm(link);await symlink("../.pnpm/nest-two/node_modules",link);
  await assert.rejects(assertInstalledDependencies(a.root,first),{code:"installed_dependency_integrity_invalid"});
});

test("a nested alias to the installation root is bounded and external nested targets fail closed",async t=>{
  const a=await fixture(t);
  const link=resolve(a.root,"node_modules/sample/node_modules");
  await symlink("..",link);
  const first=await inspectInstalledDependencies(a.root);
  assert.equal(installedDependencyIdentityValid(first),true);
  assert.ok(first.links.some(item=>item.path==="sample/node_modules"&&item.target==="."));
  await rm(link);await symlink(a.root,link);
  await assert.rejects(inspectInstalledDependencies(a.root),{code:"installed_dependency_integrity_invalid"});
});

test("node_modules is not an ignored filename when it is an ordinary package file",async t=>{
  const a=await fixture(t);
  await a.put("node_modules/sample/package.json",JSON.stringify({name:"sample",version:"1.0.0"}));
  await a.put("node_modules/sample/node_modules","module.exports = 1;");
  const first=await inspectInstalledDependencies(a.root);
  await a.put("node_modules/sample/node_modules","module.exports = 2;");
  await assert.rejects(assertInstalledDependencies(a.root,first),{code:"installed_dependency_integrity_invalid"});
});

test("a new member added after a package subdirectory was listed fails the same inspection",async t=>{
  const a=await fixture(t);
  await a.put("node_modules/sample/lib/stable.js","module.exports = 1;");
  const watched=await realpath(resolve(a.root,"node_modules/sample/lib"));
  const original=filesystem.readdir;
  let inserted=false;
  t.mock.method(filesystem,"readdir",async (path, options)=>{
    const entries=await original(path,options);
    if (!inserted && String(path)===watched) {
      inserted=true;
      await a.put("node_modules/sample/lib/late.js","module.exports = 2;");
    }
    return entries;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(inspectInstalledDependencies(a.root),{code:"installed_dependency_integrity_invalid"});
    assert.equal(inserted,true);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
