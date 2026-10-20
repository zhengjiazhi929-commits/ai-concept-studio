// Server-only consumption of registered bytes. This does not authorize a render.
import {mkdir, mkdtemp, rm, writeFile, realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {approvalValidForGate} from "../control/policy-engine.mjs";
import {verifyEditorialMaterializationBundle, editorialMaterializationError,
  editorialMaterializationFileSet, editorialMaterializationRegularFile,
  editorialMaterializationSame as same} from "./editorial-materialization-integrity.mjs";

export function usesEditorialMaterialization(episode) {
  return episode.production?.assetPlan?.content?.kind === "editorial-code-asset-plan-v1"
    || episode.production?.editorialMaterialization != null
    || episode.scenes?.some(scene => scene?.motionPlan != null);
}

export async function verifyRegisteredEditorialMaterialization({workspaceRoot, episode}) {
  const verified = await verifyEditorialMaterializationBundle({workspaceRoot, episode,
    receipt: episode.production?.editorialMaterialization, requireCurrentImplementation: true});
  const currentAssets = episode.assets ?? [];
  // Gate 4 changes only these acceptance fields. It may not replace technical
  // bindings, rights, membership or any bytes of the registered materialization.
  const approved = episode.control?.reviewEnabled === true && approvalValidForGate(episode, "assets");
  const normalized = currentAssets.map(asset => {
    if (approved && asset.verified === true && Number.isFinite(Date.parse(asset.verifiedAt))) {
      const {verifiedAt: _at, ...rest} = asset;
      return {...rest, verified: false};
    }
    return asset;
  });
  if (!same(normalized, verified.assetRecords)) {
    throw editorialMaterializationError("editorial_materialization_registration_changed");
  }
  return verified;
}

export async function createEditorialMaterializationSnapshotCore({workspaceRoot, episode}) {
  const root = await realpath(resolve(workspaceRoot));
  const verified = await verifyRegisteredEditorialMaterialization({workspaceRoot: root, episode});
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "acs-editorial-snapshot-")));
  try {
    const files = verified.files.filter(file => file.path.startsWith("bundle/"));
    for (const file of files) {
      const read = await editorialMaterializationRegularFile(root, `${verified.receipt.directory}/${file.path}`);
      if (!same(read.record, {path: `${verified.receipt.directory}/${file.path}`, bytes: file.bytes, sha256: file.sha256})) {
        throw editorialMaterializationError();
      }
      const destination = resolve(temporaryRoot, file.path);
      await mkdir(dirname(destination), {recursive: true});
      await writeFile(destination, read.bytes, {flag: "wx"});
    }
    const expected = files.map(({role: _role, ...file}) => file);
    if (!same(await editorialMaterializationFileSet(temporaryRoot), expected)) throw editorialMaterializationError();
    // Close the copy window against changed source/approval/resource files.
    await verifyRegisteredEditorialMaterialization({workspaceRoot: root, episode});
    let cleaned = false;
    return {serveUrl: resolve(temporaryRoot, "bundle"), temporaryRoot,
      inputProps: verified.inputProps, receipt: verified.receipt,
      rendered: false, visualAcceptance: false,
      async cleanup() {
        if (cleaned) return false;
        cleaned = true;
        await rm(temporaryRoot, {recursive: true, force: true});
        return true;
      }};
  } catch (error) {
    // Only the exact directory created by this function is removed.
    await rm(temporaryRoot, {recursive: true, force: true}).catch(() => undefined);
    throw error;
  }
}
