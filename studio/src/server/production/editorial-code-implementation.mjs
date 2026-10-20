import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, sep, extname } from "node:path";
import { workspaceRoot as defaultWorkspaceRoot } from "../../shared/paths.mjs";
import {inspectInstalledDependencies, installedDependencyIdentityValid} from "./installed-dependency-integrity.mjs";

export const EDITORIAL_IMPLEMENTATION_VERSION = "editorial-code-implementation-v2";
export const EDITORIAL_IMPLEMENTATION_SEEDS = Object.freeze([
  "studio/src/video/index.jsx", "studio/src/video/root.jsx",
  "studio/src/video/episode-preview.jsx", "studio/src/video/editorial-motion-preview.jsx",
  "studio/src/video/editorial-motion-render-model.mjs", "studio/src/shared/editorial-motion.mjs",
  "studio/src/shared/editorial-timing.mjs", "studio/src/video/font-system.mjs",
  "studio/src/video/load-video-fonts.jsx", "studio/src/video/glass-card-preview/material.mjs",
  "studio/src/video/components/visual-system-v1/tokens.mjs",
  "studio/src/video/components/visual-system-v1/ai-watermark.jsx",
  "studio/src/video/components/visual-system-v1/ai-watermark.mjs",
  "studio/src/video/visual-system-v1-ai-watermark-proof-plan.mjs",
  "studio/config/visual-system.json"
]);
const LOCK_FILES = ["studio/package.json", "studio/pnpm-lock.yaml", "studio/pnpm-workspace.yaml", ".node-version"];
const FONT_ROOT = "studio/node_modules/@fontsource-variable/noto-sans-sc";
const LOGO_ROOT = "studio/public/assets/visual-system-v1/ai-watermark-v013/frames";
const LOGO_MANIFEST = "studio/public/assets/visual-system-v1/ai-watermark-v013/manifest.json";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const hash = value => sha(`${JSON.stringify(value, null, 2)}\n`);
const safe = path => typeof path === "string" && path.length > 0 && !path.startsWith("/")
  && !path.includes("\\") && !path.split("/").some(part => !part || part === "." || part === "..");
const fail = () => { throw Object.assign(new Error("编辑动画实现或本地资源闭包无法验证"), {
  code: "editorial_code_implementation_invalid", statusCode: 409
}); };
const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`);
const recordValid = file => safe(file?.path) && Number.isSafeInteger(file?.bytes) && file.bytes > 0
  && /^[a-f0-9]{64}$/u.test(file?.sha256 ?? "");
const recordsValid = files => Array.isArray(files) && files.length > 0
  && files.every(recordValid) && new Set(files.map(file => file.path)).size === files.length;

// A read-only build resolves the actual static JS/JSX import graph. It writes no
// bundle, fetches nothing and does not claim a rendered frame or visual approval.
export async function inspectEditorialCodeImplementation(options = {}) {
  // The local inspection operation requires the locked development compiler;
  // simply loading server/checkpoint modules must not require a dev dependency.
  const {build, transform} = await import("esbuild");
  const root = await realpath(resolve(options.workspaceRoot ?? defaultWorkspaceRoot));
  const readBytes = options.readFile ?? readFile;
  const reads = new Map();
  const read = async (path, packageRoot = null) => {
    if (!safe(path)) fail();
    const target = resolve(root, path);
    const actual = await realpath(target);
    if (packageRoot) {
      if (!inside(packageRoot, actual)) fail();
    } else if (actual !== target) fail();
    const bytes = await readBytes(actual);
    if (bytes.length === 0) fail();
    const sha256 = sha(bytes);
    const first = reads.get(path);
    if (first && (first.actual !== actual || first.sha256 !== sha256)) fail();
    if (!first) reads.set(path, {actual, sha256});
    return {bytes, record: {path, bytes: bytes.length, sha256}};
  };
  // Local import closure and installed package bytes have independent identities.
  // Lock declarations alone cannot detect a modified package at the same version.
  const result = await build({absWorkingDir: resolve(root, "studio"),
    entryPoints: Object.fromEntries(EDITORIAL_IMPLEMENTATION_SEEDS.map((path, index) => [`entry-${index}`, resolve(root, path)])),
    bundle: true, write: false, metafile: true, packages: "external", platform: "browser",
    outdir: resolve(root, "outputs", "unused-editorial-inspection"), logLevel: "silent",
    plugins: [{name: "read-only-bound-local-sources", setup(builder) {
      builder.onLoad({filter: /.*/}, async ({path}) => {
        const relativePath = relative(root, path).replaceAll("\\", "/");
        if (!relativePath.startsWith("studio/src/") && !EDITORIAL_IMPLEMENTATION_SEEDS.includes(relativePath)) fail();
        const loader = {".jsx":"jsx", ".mjs":"js", ".js":"js", ".json":"json", ".css":"css"}[extname(path)];
        if (!loader) fail();
        const {bytes} = await read(relativePath);
        if (loader === "js" || loader === "jsx") {
          // This specific profile supports static ESM only. Normalize comments
          // before rejecting every runtime import/require, including literals
          // and concatenation; a quote prefix is not a closed dependency.
          const normalized = await transform(bytes.toString("utf8"), {loader,
            minifyWhitespace: true, legalComments: "none", logLevel: "silent"});
          if (/\b(?:import|require)\s*\(/u.test(normalized.code)) fail();
        }
        return {contents: bytes, loader, resolveDir: resolve(path, "..")};
      });
    }}]});
  const imports = Object.keys(result.metafile.inputs).map(path =>
    relative(root, resolve(root, "studio", path)).replaceAll("\\", "/"));
  if (imports.some(path => (!path.startsWith("studio/src/") && !EDITORIAL_IMPLEMENTATION_SEEDS.includes(path)) || !safe(path))) fail();
  const paths = [...new Set([...EDITORIAL_IMPLEMENTATION_SEEDS, ...imports, ...LOCK_FILES])].sort();
  const files = [];
  for (const path of paths) {
    const captured = reads.get(path)?.sha256;
    const data = await read(path);
    if (captured && captured !== data.record.sha256) fail();
    files.push(data.record);
  }
  const packageConfig = JSON.parse((await read("studio/package.json")).bytes);
  const externalImports = Object.values(result.metafile.inputs).flatMap(input => input.imports).filter(item => item.external);
  for (const item of externalImports) {
    const packageName = item.path.startsWith("@") ? item.path.split("/").slice(0,2).join("/") : item.path.split("/")[0];
    if (!/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/u.test(packageName)
      || !/^\d+\.\d+\.\d+$/u.test(packageConfig.dependencies?.[packageName] ?? "")) fail();
  }
  const fontActualRoot = await realpath(resolve(root, FONT_ROOT));
  const nodeModules = await realpath(resolve(root, "studio/node_modules"));
  if (!inside(nodeModules, fontActualRoot)) fail();
  const fontFiles = [];
  const fontPackage = JSON.parse((await read(`${FONT_ROOT}/package.json`, fontActualRoot)).bytes);
  if (fontPackage.name !== "@fontsource-variable/noto-sans-sc" || fontPackage.version !== "5.3.0"
    || packageConfig.dependencies?.[fontPackage.name] !== fontPackage.version || fontPackage.license !== "OFL-1.1") fail();
  const css = (await read(`${FONT_ROOT}/wght.css`, fontActualRoot)).bytes.toString("utf8");
  const urls = [...css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gu)].map(match => match[1]);
  if (urls.length === 0 || urls.some(url => !/^\.\/files\/[a-zA-Z0-9_-]+\.woff2$/u.test(url))) fail();
  for (const path of ["package.json", "LICENSE", "wght.css", ...new Set(urls.map(url => url.slice(2)))].sort()) {
    const data = await read(`${FONT_ROOT}/${path}`, fontActualRoot);
    if (path.endsWith(".woff2") && data.bytes.subarray(0,4).toString("ascii") !== "wOF2") fail();
    fontFiles.push(data.record);
  }
  const logoFiles = [];
  const manifestData = await read(LOGO_MANIFEST);
  const manifest = JSON.parse(manifestData.bytes);
  if (manifest.approved !== true || manifest.assetVersion !== 13 || manifest.frameCount !== 120
    || manifest.approval?.approvedProfileId !== "approved-v013-stable-footprint"
    || !manifest.frames || Object.keys(manifest.frames).length !== 120) fail();
  for (let frame = 0; frame < 120; frame += 1) {
    const data = await read(`${LOGO_ROOT}/frame-${String(frame).padStart(3, "0")}.png`);
    const b = data.bytes;
    if (b.length < 33 || !b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || b.toString("ascii",12,16) !== "IHDR" || b.readUInt32BE(16) !== 120 || b.readUInt32BE(20) !== 120) fail();
    const approvedFrame = manifest.frames[String(frame)];
    if (approvedFrame?.outputPath !== data.record.path.slice("studio/public/".length)
      || approvedFrame.outputSha256 !== data.record.sha256) fail();
    logoFiles.push(data.record);
  }
  if (new Set(logoFiles.map(file => file.sha256)).size < 2) fail();
  // Catch changes across the full inspection rather than just per-file reads.
  const dependencies = await inspectInstalledDependencies(resolve(root, "studio"));
  // Re-read local sources after the longer installed-byte inspection as well.
  for (const [path, before] of reads) {
    if (await realpath(resolve(root, path)) !== before.actual || sha(await readFile(before.actual)) !== before.sha256) fail();
  }
  const content = {schemaVersion: EDITORIAL_IMPLEMENTATION_VERSION, componentId: "EditorialMotionPreview",
    compositionId: "ConceptPreview", closurePolicy: "esbuild-local-and-installed-packages-v2", files, dependencies,
    font: {status: "packaged-files-bound", packageName: fontPackage.name, packageVersion: fontPackage.version,
      license: fontPackage.license, licensePath: `${FONT_ROOT}/LICENSE`, family: "Noto Sans SC Variable",
      portable: true, browserResolutionVerified: false, files: fontFiles},
    logo: {profile: "approved-v013-stable-footprint", cadence: "continuous", width: 120, height: 120,
      frameCount: 120, validation: "approved-manifest-sha256-and-png-header-only", manifest: manifestData.record, files: logoFiles},
    rendered: false, visualAcceptance: false};
  return {...content, sha256: hash(content)};
}

export function editorialCodeImplementationValid(value) {
  try {
    const {sha256, ...content} = value;
    return Object.keys(value).sort().join("|") === ["schemaVersion","componentId","compositionId","closurePolicy","files","dependencies","font","logo","rendered","visualAcceptance","sha256"].sort().join("|")
      && value.schemaVersion === EDITORIAL_IMPLEMENTATION_VERSION && value.componentId === "EditorialMotionPreview"
      && value.compositionId === "ConceptPreview" && value.closurePolicy === "esbuild-local-and-installed-packages-v2"
      && installedDependencyIdentityValid(value.dependencies)
      && value.rendered === false && value.visualAcceptance === false && hash(content) === sha256
      && recordsValid(value.files) && value.files.every(file => file.path.startsWith("studio/src/") || LOCK_FILES.includes(file.path) || EDITORIAL_IMPLEMENTATION_SEEDS.includes(file.path))
      && [...EDITORIAL_IMPLEMENTATION_SEEDS, ...LOCK_FILES].every(path => value.files.some(file => file.path === path))
      && value.font.status === "packaged-files-bound" && value.font.packageName === "@fontsource-variable/noto-sans-sc"
      && value.font.packageVersion === "5.3.0" && value.font.license === "OFL-1.1"
      && value.font.portable === true && value.font.browserResolutionVerified === false
      && recordsValid(value.font.files) && value.font.files.every(file => file.path.startsWith(`${FONT_ROOT}/`))
      && ["package.json","LICENSE","wght.css"].every(path => value.font.files.some(file => file.path === `${FONT_ROOT}/${path}`))
      && value.font.files.some(file => file.path.endsWith(".woff2"))
      && value.logo.profile === "approved-v013-stable-footprint" && value.logo.cadence === "continuous"
      && value.logo.width === 120 && value.logo.height === 120 && value.logo.frameCount === 120
      && value.logo.validation === "approved-manifest-sha256-and-png-header-only" && recordValid(value.logo.manifest)
      && value.logo.manifest.path === LOGO_MANIFEST && recordsValid(value.logo.files)
      && value.logo.files.length === 120 && value.logo.files.every((file,index) => file.path === `${LOGO_ROOT}/frame-${String(index).padStart(3,"0")}.png`)
      && new Set(value.logo.files.map(file => file.sha256)).size > 1;
  } catch { return false; }
}
