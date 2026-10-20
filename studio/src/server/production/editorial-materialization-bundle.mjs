// Local bundle compilation only. No browser, renderer, voice or network provider.
import {mkdir, mkdtemp, readFile, realpath, rename, rm, lstat, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {assertDurableStorePath} from "../../shared/durable-json-store.mjs";
import {requireSideEffectGrant} from "../security/side-effect-capability.mjs";
import {validateEditorialAssetsMaterializeRequest, editorialAssetsMaterializeCapabilitySpec,
  EDITORIAL_ASSETS_MATERIALIZE_OPERATION} from "../../shared/editorial-assets-materialize-request.mjs";
import {assertEditorialMaterializationSource, editorialMaterializationDirectory, editorialMaterializationError,
  editorialMaterializationInputProps, editorialMaterializationJson, editorialMaterializationSha,
  editorialMaterializationSame, editorialMaterializationManifest, editorialMaterializationReceipt,
  editorialMaterializationRegularFile, inspectEditorialMaterializationOutput, verifyEditorialMaterializationBundle} from "./editorial-materialization-integrity.mjs";

async function writeNew(root, path, bytes) {
  const target = resolve(root, path);
  await assertDurableStorePath(root, target);
  await mkdir(dirname(target), {recursive: true});
  await assertDurableStorePath(root, target);
  await writeFile(target, bytes, {flag: "wx"});
}
async function approvedBytes(root, file) {
  const target = resolve(root, file.path);
  const actual = await realpath(target);
  // Package-manager links are expected only for the pinned font package.
  if (!file.path.startsWith("studio/node_modules/") && actual !== target) throw editorialMaterializationError("editorial_materialization_path_unsafe");
  const bytes = await readFile(actual);
  if (bytes.length !== file.bytes || editorialMaterializationSha(bytes) !== file.sha256) throw editorialMaterializationError();
  return bytes;
}

export async function buildEditorialMaterializationBundle(input) {
  const {workspaceRoot, episode, operationId, request: rawRequest, sideEffectGrant} = input;
  const request = validateEditorialAssetsMaterializeRequest(rawRequest);
  const spec = editorialAssetsMaterializeCapabilitySpec(request);
  const grant = requireSideEffectGrant({sideEffectGrant}, spec, EDITORIAL_ASSETS_MATERIALIZE_OPERATION);
  if (grant.maxCalls !== 0 || grant.maxCostUsd !== 0
    || !editorialMaterializationSame([...grant.scopes].sort(), ["filesystem.write", "state.write"])) {
    throw editorialMaterializationError("editorial_materialization_capability_not_zero");
  }
  const root = await realpath(resolve(workspaceRoot));
  const source = await assertEditorialMaterializationSource({workspaceRoot: root, episode, operationId, request});
  const directory = editorialMaterializationDirectory(episode.id, operationId);
  const destination = resolve(root, directory);
  await assertDurableStorePath(root, destination);
  if (await lstat(destination).catch(error => { if (error.code === "ENOENT") return null; throw error; })) {
    const evidence = await editorialMaterializationRegularFile(root, `${directory}/materialization.json`);
    let manifest;
    try { manifest = JSON.parse(evidence.bytes); } catch { throw editorialMaterializationError(); }
    const verified = await verifyEditorialMaterializationBundle({workspaceRoot: root, episode,
      receipt: editorialMaterializationReceipt(manifest)});
    if (!editorialMaterializationSame(manifest.request, request)) throw editorialMaterializationError();
    return {manifest: verified.manifest, receipt: verified.receipt, assetRecords: verified.assetRecords};
  }
  await mkdir(dirname(destination), {recursive: true});
  await assertDurableStorePath(root, destination);
  const temporary = await mkdtemp(resolve(dirname(destination), ".building-"));
  const snapshot = resolve(temporary, "snapshot");
  const output = resolve(temporary, "output");
  const minimalPublic = resolve(temporary, "public");
  try {
    for (const path of [snapshot, output, minimalPublic]) await mkdir(path);
    for (const file of source.implementation.files) await writeNew(snapshot, file.path, await approvedBytes(root, file));
    for (const file of source.implementation.font.files) {
      const bytes = await approvedBytes(root, file);
      await writeNew(snapshot, file.path, bytes);
      await writeNew(output, `resources/font/${file.path.split("noto-sans-sc/")[1]}`, bytes);
    }
    for (const file of [...source.implementation.logo.files, source.implementation.logo.manifest]) {
      await writeNew(minimalPublic, file.path.slice("studio/public/".length), await approvedBytes(root, file));
    }
    await writeNew(output, "input-props.json", editorialMaterializationJson(editorialMaterializationInputProps(episode)));
    // The approved source snapshot is independent of mutable working files. The
    // package graph stays on the existing locked installation; fonts resolve to
    // the byte-checked snapshot instead of the mutable package-manager link.
    const {bundle} = await import("@remotion/bundler");
    requireSideEffectGrant({sideEffectGrant}, spec, EDITORIAL_ASSETS_MATERIALIZE_OPERATION);
    await bundle({entryPoint: resolve(snapshot, "studio/src/video/index.jsx"), rootDir: resolve(snapshot, "studio"),
      outDir: resolve(output, "bundle"), publicDir: minimalPublic, symlinkPublicDir: false,
      enableCaching: false, onProgress: () => undefined, gitSource: null,
      webpackOverride: config => ({...config, devtool: false, resolve: {...config.resolve,
        modules: [resolve(root, "studio/node_modules"), ...(config.resolve?.modules ?? ["node_modules"])],
        alias: {...config.resolve?.alias, "@fontsource-variable/noto-sans-sc": resolve(snapshot,
          "studio/node_modules/@fontsource-variable/noto-sans-sc")}}})});
    const current = await assertEditorialMaterializationSource({workspaceRoot: root, episode, operationId, request});
    if (!editorialMaterializationSame(source, current)) throw editorialMaterializationError();
    for (const file of [...source.implementation.files, ...source.implementation.font.files]) await approvedBytes(snapshot, file);
    const files = await inspectEditorialMaterializationOutput(output, source.implementation);
    const manifest = editorialMaterializationManifest({episode, operationId, request, source, files});
    const receipt = editorialMaterializationReceipt(manifest);
    await writeNew(output, "materialization.json", editorialMaterializationJson(manifest));
    requireSideEffectGrant({sideEffectGrant}, spec, EDITORIAL_ASSETS_MATERIALIZE_OPERATION);
    await assertDurableStorePath(root, destination);
    if (await lstat(destination).catch(error => { if (error.code === "ENOENT") return null; throw error; })) {
      // Another same-request producer won; do not replace any existing bytes.
      const verified = await verifyEditorialMaterializationBundle({workspaceRoot: root, episode, receipt});
      return {manifest: verified.manifest, receipt: verified.receipt, assetRecords: verified.assetRecords};
    }
    await rename(output, destination);
    const verified = await verifyEditorialMaterializationBundle({workspaceRoot: root, episode, receipt});
    return {manifest: verified.manifest, receipt: verified.receipt, assetRecords: verified.assetRecords};
  } finally {
    // This exact mkdtemp-owned tree is never user data or a workspace root.
    await rm(temporary, {recursive: true, force: true});
  }
}
