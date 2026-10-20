import {readFile, cp, realpath, rm} from "node:fs/promises";
import {resolve, dirname, basename} from "node:path";
import {fileURLToPath} from "node:url";
import {seedEditorialImplementationFixture} from "./editorial-implementation-fixture.mjs";

const studioRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Synthetic visual code and Logo headers, plus one actual installed OFL font
// subset and its exact upstream CSS rule/license. This is byte and compilation
// evidence, not full Chinese font coverage or a rendered typography test.
// No live state/output, browser, network or image/video rendering is accessed.
export async function seedEditorialBundleImplementationFixture(root) {
  const seeded = await seedEditorialImplementationFixture(root);
  const pkg = JSON.parse(await readFile(resolve(studioRoot, "package.json"), "utf8"));
  const names = ["react", "react-dom", "remotion", "@fontsource-variable/noto-sans-sc"];
  await seeded.put("studio/package.json", JSON.stringify({type: "module", dependencies:
    Object.fromEntries(names.map(name => [name, pkg.dependencies[name]]))}));
  const font = "studio/node_modules/@fontsource-variable/noto-sans-sc";
  await rm(resolve(root, font), {recursive: true, force: true});
  const installedFont = resolve(studioRoot, "node_modules/@fontsource-variable/noto-sans-sc");
  const css = await readFile(resolve(installedFont, "wght.css"), "utf8");
  const rule = [...css.matchAll(/@font-face\s*\{[^}]+\}/gu)].at(-1)?.[0];
  const file = /url\(\.\/([^\s)]+)\)/u.exec(rule ?? "")?.[1];
  if (!file || !/^files\/[a-zA-Z0-9_-]+\.woff2$/u.test(file)) throw new Error("Pinned font fixture rule unavailable");
  for (const path of ["package.json", "LICENSE", file]) await seeded.put(`${font}/${path}`, await readFile(resolve(installedFont, path)));
  await seeded.put(`${font}/wght.css`, `${rule}\n`);
  // Copy the exact packages used by this synthetic composition. External
  // symlinks would escape the candidate's verified installed-package boundary.
  for (const name of ["react", "react-dom", "remotion", "scheduler"]) {
    const target = resolve(root, "studio/node_modules", name);
    let source;
    if (name === "scheduler") {
      const reactDom = await realpath(resolve(studioRoot, "node_modules/react-dom"));
      source = await realpath(resolve(reactDom, "../scheduler"));
    } else source = await realpath(resolve(studioRoot, "node_modules", name));
    await cp(source, target, {recursive: true, filter: path => path === source || basename(path) !== "node_modules"});
  }
  await seeded.put("studio/src/video/index.jsx", `import React from 'react';
import {registerRoot,Composition,AbsoluteFill} from 'remotion';
import '@fontsource-variable/noto-sans-sc/wght.css';
const Synthetic=()=>React.createElement(AbsoluteFill,null,'合成素材，不是实际视频');
registerRoot(()=>React.createElement(Composition,{id:'ConceptPreview',component:Synthetic,width:1920,height:1080,fps:30,durationInFrames:180}));\n`);
  return seeded;
}
