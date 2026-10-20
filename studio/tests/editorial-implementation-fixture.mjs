import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { EDITORIAL_IMPLEMENTATION_SEEDS } from "../src/server/production/editorial-code-implementation.mjs";

// Deliberately synthetic byte/header fixtures. They prove binding behavior, not
// valid rendered image pixels, typography, real font licensing or acceptance.
export async function seedEditorialImplementationFixture(root) {
  const put = async (path, bytes) => {
    const target = resolve(root, path);
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, bytes);
  };
  for (const path of EDITORIAL_IMPLEMENTATION_SEEDS) await put(path,
    path.endsWith(".json") ? "{}\n" : "export const synthetic = true;\n");
  await put("studio/src/video/index.jsx", "import './editorial-motion-preview.jsx';\n");
  await put("studio/src/video/editorial-motion-preview.jsx", "import './synthetic-transitive.mjs';\n");
  await put("studio/src/video/synthetic-transitive.mjs", "export const sample = 1;\n");
  await put("studio/package.json", JSON.stringify({dependencies:{"@fontsource-variable/noto-sans-sc":"5.3.0"}}));
  await put("studio/pnpm-lock.yaml", "synthetic lock\n");
  await put("studio/pnpm-workspace.yaml", "synthetic workspace\n");
  await put(".node-version", "24.19.0\n");
  const font = "studio/node_modules/@fontsource-variable/noto-sans-sc";
  await put(`${font}/package.json`, JSON.stringify({name:"@fontsource-variable/noto-sans-sc",version:"5.3.0",license:"OFL-1.1"}));
  await put(`${font}/LICENSE`, "Synthetic license evidence; not an actual font license.\n");
  await put(`${font}/wght.css`, '@font-face{font-family:"Noto Sans SC Variable";src:url(./files/synthetic.woff2) format("woff2")}');
  await put(`${font}/files/synthetic.woff2`, Buffer.from("wOF2synthetic local font"));
  const frames = {};
  for (let frame = 0; frame < 120; frame += 1) {
    const bytes = Buffer.alloc(64);
    Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
    bytes.writeUInt32BE(13,8); bytes.write("IHDR",12);
    bytes.writeUInt32BE(120,16); bytes.writeUInt32BE(120,20); bytes[63] = frame;
    const outputPath=`assets/visual-system-v1/ai-watermark-v013/frames/frame-${String(frame).padStart(3,"0")}.png`;
    await put(`studio/public/${outputPath}`,bytes);
    frames[String(frame)]={outputPath,outputSha256:createHash("sha256").update(bytes).digest("hex")};
  }
  await put("studio/public/assets/visual-system-v1/ai-watermark-v013/manifest.json",JSON.stringify({
    syntheticTestOnly:true,approved:true,assetVersion:13,frameCount:120,
    approval:{approvedBy:"synthetic-test-operator",approvedProfileId:"approved-v013-stable-footprint"},frames}));
  return {put};
}
