import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { inspectEditorialCodeImplementation, editorialCodeImplementationValid }
  from "../src/server/production/editorial-code-implementation.mjs";
import { seedEditorialImplementationFixture } from "./editorial-implementation-fixture.mjs";

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "synthetic-editorial-assets-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const {put} = await seedEditorialImplementationFixture(root);
  return {root,put};
}

test("read-only implementation binds complete local source graph, all logo frames and actual packaged font files", async t => {
  const f = await fixture(t);
  const first = await inspectEditorialCodeImplementation({workspaceRoot:f.root});
  assert.equal(editorialCodeImplementationValid(first),true);
  assert.equal(first.logo.files.length,120);
  assert.equal(first.font.status,"packaged-files-bound");
  assert.ok(first.font.files.some(file=>file.path.endsWith("synthetic.woff2")));
  assert.ok(first.files.some(file=>file.path.endsWith("synthetic-transitive.mjs")));
  assert.deepEqual(await inspectEditorialCodeImplementation({workspaceRoot:f.root}),first);
  await f.put("studio/src/video/synthetic-transitive.mjs","export const sample = 2;\n");
  const changed = await inspectEditorialCodeImplementation({workspaceRoot:f.root});
  assert.notEqual(changed.sha256,first.sha256);
  changed.font.files[0].path="../escape";
  assert.equal(editorialCodeImplementationValid(changed),false);
});

test("missing, replaced or remote resources and symlink source escapes fail closed", async t => {
  const f = await fixture(t);
  const logo="studio/public/assets/visual-system-v1/ai-watermark-v013/frames/frame-119.png";
  const original=await readFile(resolve(f.root,logo));
  await f.put(logo,Buffer.from("not a PNG"));
  await assert.rejects(inspectEditorialCodeImplementation({workspaceRoot:f.root}));
  await f.put(logo,original);
  await f.put("studio/node_modules/@fontsource-variable/noto-sans-sc/wght.css",'src:url(https://example.invalid/font.woff2)');
  await assert.rejects(inspectEditorialCodeImplementation({workspaceRoot:f.root}));
  await f.put("studio/node_modules/@fontsource-variable/noto-sans-sc/wght.css",'src:url(./files/synthetic.woff2)');
  await rm(resolve(f.root,"studio/src/video/synthetic-transitive.mjs"));
  await symlink(resolve(f.root,".node-version"),resolve(f.root,"studio/src/video/synthetic-transitive.mjs"));
  await assert.rejects(inspectEditorialCodeImplementation({workspaceRoot:f.root}));
});

test("a font CSS change between dependency discovery and second binding read cannot replace the first snapshot", async t => {
  const f=await fixture(t); let cssReads=0;
  await assert.rejects(inspectEditorialCodeImplementation({workspaceRoot:f.root,
    readFile:async path=>{
      if (path.endsWith("/wght.css") && ++cssReads===2) {
        await f.put("studio/node_modules/@fontsource-variable/noto-sans-sc/files/changed.woff2",Buffer.from("wOF2replacement"));
        await f.put("studio/node_modules/@fontsource-variable/noto-sans-sc/wght.css",'src:url(./files/changed.woff2)');
      }
      return readFile(path);
    }}),{code:"editorial_code_implementation_invalid"});
});

test("transitive TS sources cannot bypass bounded reads or introduce unknown runtime imports", async t => {
  const f=await fixture(t);
  await f.put("studio/src/video/synthetic-transitive.mjs",'export {lookup} from "./dynamic.ts";\n');
  await f.put("studio/src/video/dynamic.ts",'export const lookup = (name: string) => import(name);\n');
  await assert.rejects(inspectEditorialCodeImplementation({workspaceRoot:f.root}));
});

test("concatenated or commented dynamic imports cannot masquerade as a literal closed dependency", async t => {
  const f=await fixture(t);
  for (const expression of ['import("unregistered-package/" + name)', 'import /* comment */ (name)']) {
    await f.put("studio/src/video/synthetic-transitive.mjs",`export const lookup = name => ${expression};\n`);
    await assert.rejects(inspectEditorialCodeImplementation({workspaceRoot:f.root}));
  }
});

test("a still-valid PNG header cannot replace a frame named by the existing approved manifest", async t => {
  const f=await fixture(t);
  const path="studio/public/assets/visual-system-v1/ai-watermark-v013/frames/frame-042.png";
  const bytes=await readFile(resolve(f.root,path)); bytes[63]=200;
  await f.put(path,bytes);
  await assert.rejects(inspectEditorialCodeImplementation({workspaceRoot:f.root}),{code:"editorial_code_implementation_invalid"});
});

test("logo manifest must retain its approved version, profile and exact frame inventory", async t => {
  const f=await fixture(t);
  const path="studio/public/assets/visual-system-v1/ai-watermark-v013/manifest.json";
  const original=JSON.parse(await readFile(resolve(f.root,path),"utf8"));
  for (const mutate of [m=>m.approved=false,m=>m.assetVersion=14,m=>m.frameCount=119,
    m=>m.approval.approvedProfileId="unapproved",m=>delete m.frames["0"],
    m=>m.frames["0"].outputPath="assets/other/frame-000.png"]) {
    const changed=structuredClone(original); mutate(changed);
    await f.put(path,JSON.stringify(changed));
    await assert.rejects(inspectEditorialCodeImplementation({workspaceRoot:f.root}),{code:"editorial_code_implementation_invalid"});
  }
});

test("installed dependency bytes at the same declared version change the approved implementation identity", async t => {
  const f = await fixture(t);
  await f.put("studio/package.json", JSON.stringify({dependencies: {
    "@fontsource-variable/noto-sans-sc": "5.3.0", react: "19.2.8"
  }}));
  await f.put("studio/node_modules/react/package.json", JSON.stringify({name: "react", version: "19.2.8", main: "index.js"}));
  await f.put("studio/node_modules/react/index.js", "exports.version = 'implementation-one';\n");
  const first = await inspectEditorialCodeImplementation({workspaceRoot: f.root});
  await f.put("studio/node_modules/react/index.js", "exports.version = 'implementation-two';\n");
  const second = await inspectEditorialCodeImplementation({workspaceRoot: f.root});
  assert.notEqual(second.sha256, first.sha256);
  assert.equal(editorialCodeImplementationValid(second), true);
});
