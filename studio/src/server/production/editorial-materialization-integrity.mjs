import {createHash} from "node:crypto";
import {lstat, readFile, readdir, realpath} from "node:fs/promises";
import {resolve, relative, sep} from "node:path";
import {integrityHash} from "../../shared/integrity.mjs";
import {canonicalJsonDocumentContentSha256 as digest} from "../../shared/durable-json-store.mjs";
import {validateEditorialAssetsMaterializeRequest} from "../../shared/editorial-assets-materialize-request.mjs";
import {assetExecutionApprovalValid, inspectAssetExecutionCandidate} from "../reviews/asset-execution-checkpoint.mjs";

export const EDITORIAL_MATERIALIZATION_KIND = "editorial-code-materialization-v1";
export const editorialMaterializationJson = value => `${JSON.stringify(value, null, 2)}\n`;
export const editorialMaterializationSha = bytes => createHash("sha256").update(bytes).digest("hex");
export const editorialMaterializationSame = (a, b) => digest(a ?? null) === digest(b ?? null);
export function editorialMaterializationError(code = "editorial_materialization_integrity_changed") {
  return Object.assign(new Error("本地编辑动画包、来源审批或递归文件完整性不再匹配"), {code, statusCode: 409});
}
export function editorialMaterializationSafePath(path) {
  return typeof path === "string" && /^[A-Za-z0-9_./@-]+$/u.test(path) && !path.startsWith("/")
    && !path.split("/").some(part => !part || part === "." || part === "..");
}
export async function editorialMaterializationRegularFile(root, path) {
  if (!editorialMaterializationSafePath(path)) throw editorialMaterializationError("editorial_materialization_path_unsafe");
  const absolute = resolve(root, path);
  let stats;
  try { stats = await lstat(absolute); } catch { throw editorialMaterializationError(); }
  if (!stats.isFile() || stats.isSymbolicLink() || await realpath(absolute) !== absolute) {
    throw editorialMaterializationError("editorial_materialization_path_unsafe");
  }
  const bytes = await readFile(absolute);
  if (!bytes.length) throw editorialMaterializationError();
  if (await realpath(absolute) !== absolute) throw editorialMaterializationError("editorial_materialization_path_unsafe");
  return {bytes, record: {path, bytes: bytes.length, sha256: editorialMaterializationSha(bytes)}};
}
export async function editorialMaterializationFileSet(directory) {
  const root = resolve(directory);
  const entries = [];
  async function walk(path) {
    const stats = await lstat(path).catch(() => { throw editorialMaterializationError(); });
    if (stats.isSymbolicLink() || await realpath(path) !== path) throw editorialMaterializationError("editorial_materialization_path_unsafe");
    if (stats.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await walk(resolve(path, name));
    } else if (stats.isFile()) {
      const local = relative(root, path).split(sep).join("/");
      entries.push((await editorialMaterializationRegularFile(root, local)).record);
    } else throw editorialMaterializationError("editorial_materialization_path_unsafe");
  }
  await walk(root);
  return entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
}
const project = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value ?? {}, key))
  .map(key => [key, structuredClone(value[key])]));

// These are precisely the data fields consumed by ConceptPreview's editorial
// branch, metadata calculator and render-model. State, providers, source research,
// approvals, receipts, absolute paths and budgets never enter browser props.
export function editorialMaterializationInputProps(episode) {
  return {episode: {
    id: episode.id, title: episode.title,
    render: project(episode.render, ["compositionId", "width", "height", "fps", "durationSeconds"]),
    scenes: (episode.scenes ?? []).map(scene => project(scene,
      ["id", "title", "startFrame", "endFrame", "narration", "motionPlan"])),
    subtitles: (episode.subtitles ?? []).map(cue => project(cue,
      ["id", "sceneId", "text", "startFrame", "endFrame"]))
  }};
}
export function editorialMaterializationDirectory(episodeId, operationId) {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/u.test(episodeId ?? "") || !/^[a-f0-9]{64}$/u.test(operationId ?? "")) {
    throw editorialMaterializationError("editorial_materialization_request_mismatch");
  }
  return `studio/public/episodes/${episodeId}/editorial-materialization/${operationId}`;
}

export async function assertEditorialMaterializationSource({workspaceRoot, episode, operationId, request}) {
  const checkedRequest = validateEditorialAssetsMaterializeRequest(request);
  if (digest(checkedRequest) !== operationId || checkedRequest.episodeId !== episode.id
    || !assetExecutionApprovalValid(episode)) throw editorialMaterializationError("editorial_materialization_approval_stale");
  const checkpoint = episode.reviewCheckpoints.assetExecution;
  const inspected = await inspectAssetExecutionCandidate(episode, {}, {workspaceRoot});
  if (!inspected.passed || !editorialMaterializationSame(inspected.candidate, checkpoint.currentCandidate)
    || checkpoint.currentCandidate.candidateHash !== checkedRequest.candidateHash
    || checkpoint.machineReview.id !== checkedRequest.machineReviewId
    || inspected.candidate.localCodeImplementation.sha256 !== checkedRequest.implementationHash
    || !Number.isFinite(Date.parse(checkpoint.humanApproval.at))) {
    throw editorialMaterializationError("editorial_materialization_approval_stale");
  }
  return {implementation: inspected.candidate.localCodeImplementation,
    sourceAssetPlan: {version: episode.production.assetPlan.version,
      candidateHash: inspected.candidate.candidateHash, machineReviewId: checkpoint.machineReview.id,
      planHash: inspected.candidate.planHash, artifact: structuredClone(inspected.candidate.artifact),
      entryHash: integrityHash(episode.production.assetPlan),
      humanApprovalHash: integrityHash(checkpoint.humanApproval), machineReviewHash: integrityHash(checkpoint.machineReview)},
    sourceStoryboard: structuredClone(inspected.plan.sourceStoryboard)};
}

export function editorialMaterializationManifest({episode, operationId, request, source, files}) {
  return {schemaVersion: EDITORIAL_MATERIALIZATION_KIND, episodeId: episode.id, version: 1,
    operationId, request: structuredClone(request), sourceAssetPlan: source.sourceAssetPlan,
    sourceStoryboard: source.sourceStoryboard, implementationSha256: source.implementation.sha256,
    renderer: {componentId: "EditorialMotionPreview", compositionId: "ConceptPreview",
      bundleRoot: "bundle", entryPoint: "bundle/index.html", inputPropsPath: "input-props.json",
      inputPropsSha256: editorialMaterializationSha(editorialMaterializationJson(editorialMaterializationInputProps(episode)))},
    files: structuredClone(files),
    sceneBindings: episode.production.assetPlan.content.items.map(item => ({planItemId: item.id,
      sceneId: item.binding.sceneId, motionPlanSha256: item.binding.motionPlanSha256,
      captionSha256: item.binding.captionSha256})),
    voice: {status: "deferred", audioAligned: false}, rendered: false, visualAcceptance: false,
    assurance: "compiled-local-bundle-and-recursive-bytes-not-browser-or-pixel-acceptance",
    externalApiCalls: 0, maximumPaidCostUsd: 0};
}
export function editorialMaterializationReceipt(manifest) {
  const directory = editorialMaterializationDirectory(manifest.episodeId, manifest.operationId);
  const serialized = editorialMaterializationJson(manifest);
  return {schemaVersion: "editorial-materialization-receipt-v1", episodeId: manifest.episodeId,
    operationId: manifest.operationId, request: structuredClone(manifest.request), version: 1, directory,
    manifestPath: `${directory}/materialization.json`, manifestBytes: Buffer.byteLength(serialized),
    manifestSha256: editorialMaterializationSha(serialized), bundlePath: `${directory}/bundle`,
    inputPropsPath: `${directory}/input-props.json`, inputPropsSha256: manifest.renderer.inputPropsSha256,
    candidateHash: manifest.sourceAssetPlan.candidateHash, machineReviewId: manifest.sourceAssetPlan.machineReviewId,
    assetPlanVersion: manifest.sourceAssetPlan.version, implementationSha256: manifest.implementationSha256,
    rendered: false, voiceStatus: "deferred", externalApiCalls: 0, maximumPaidCostUsd: 0};
}
export function editorialMaterializationAssetRecords(episode, manifest, receipt) {
  const file = manifest.files.find(item => item.path === "bundle/index.html");
  if (!file) throw editorialMaterializationError();
  const at = episode.reviewCheckpoints.assetExecution.humanApproval.at;
  return episode.production.assetPlan.content.items.map(item => ({id: `editorial-${item.id}-v1`,
    planItemId: item.id, version: 1, type: "code-animation", path: `${receipt.bundlePath.slice("studio/public/".length)}/index.html`,
    source: "local-code-animation", executor: "EditorialMotionPreview", componentId: "EditorialMotionPreview",
    implementationSha256: manifest.implementationSha256, assetPlanVersion: manifest.sourceAssetPlan.version,
    candidateHash: manifest.sourceAssetPlan.candidateHash,
    materialization: {schemaVersion: "editorial-materialization-asset-binding-v1", operationId: manifest.operationId,
      manifestPath: receipt.manifestPath, manifestSha256: receipt.manifestSha256, bundlePath: receipt.bundlePath,
      inputPropsSha256: manifest.renderer.inputPropsSha256},
    bytes: file.bytes, sha256: file.sha256, createdAt: at, privacy: "project-original", verified: false,
    technicalVerification: "recursive-byte-integrity",
    rights: {schemaVersion: 1, authorOrSource: "AI Concept Studio approved local code and brand resources", sourceUrl: null,
      acquiredAt: at, license: "project-original-private-use; Noto Sans SC OFL-1.1", allowedUse: "private-internal-review",
      attributionRequirements: "Preserve bundled font license", privacyPortraitStatus: "project-original",
      verifiedBy: "machine:editorial-materialization-v1"}, externalApiCalls: 0, maximumPaidCostUsd: 0,
    rendered: false, visualAcceptance: false}));
}

export function editorialMaterializationFileRole(path) {
  if (/^bundle\/public\/assets\/visual-system-v1\/ai-watermark-v013\/frames\/frame-\d{3}\.png$/u.test(path)) return "approved-logo-frame";
  if (path === "bundle/public/assets/visual-system-v1/ai-watermark-v013/manifest.json") return "approved-logo-manifest";
  if (path === "resources/font/LICENSE") return "font-license";
  if (path.startsWith("resources/font/")) return "font-resource";
  if (path === "input-props.json") return "renderer-input";
  if (path.startsWith("bundle/")) return "compiled-renderer";
  throw editorialMaterializationError();
}
export async function inspectEditorialMaterializationOutput(directory, implementation) {
  const files = (await editorialMaterializationFileSet(directory)).filter(file => file.path !== "materialization.json")
    .map(file => ({...file, role: editorialMaterializationFileRole(file.path)}));
  const contains = (path, original) => files.some(file => file.path === path && file.bytes === original.bytes && file.sha256 === original.sha256);
  for (const file of [...implementation.logo.files, implementation.logo.manifest]) {
    if (!contains(`bundle/public/${file.path.slice("studio/public/".length)}`, file)) throw editorialMaterializationError();
  }
  if (files.filter(file => file.path.startsWith("bundle/public/")).length !== 121) throw editorialMaterializationError();
  const fontPrefix = "studio/node_modules/@fontsource-variable/noto-sans-sc/";
  for (const file of implementation.font.files) {
    if (!contains(`resources/font/${file.path.slice(fontPrefix.length)}`, file)) throw editorialMaterializationError();
    if (file.path.endsWith(".woff2") && !files.some(output => output.path.startsWith("bundle/")
      && output.path.endsWith(".woff2") && output.bytes === file.bytes && output.sha256 === file.sha256)) throw editorialMaterializationError();
  }
  if (files.filter(file => file.path.startsWith("resources/font/")).length !== implementation.font.files.length
    || !files.some(file => file.path === "bundle/index.html")
    || !files.some(file => /^bundle\/.+\.js$/u.test(file.path) && file.bytes > 1000)
    || !files.some(file => file.path === "input-props.json")) throw editorialMaterializationError();
  return files;
}

export async function verifyEditorialMaterializationBundle({workspaceRoot, episode, receipt, requireCurrentImplementation = true}) {
  if (requireCurrentImplementation !== true || !receipt) throw editorialMaterializationError();
  const root = await realpath(resolve(workspaceRoot));
  const directory = editorialMaterializationDirectory(episode.id, receipt.operationId);
  if (receipt.directory !== directory || receipt.manifestPath !== `${directory}/materialization.json`) throw editorialMaterializationError();
  const before = await editorialMaterializationRegularFile(root, receipt.manifestPath);
  if (before.record.bytes !== receipt.manifestBytes || before.record.sha256 !== receipt.manifestSha256
    || before.bytes.length > 8 * 1024 * 1024) throw editorialMaterializationError();
  let manifest;
  try { manifest = JSON.parse(before.bytes); } catch { throw editorialMaterializationError(); }
  const source = await assertEditorialMaterializationSource({workspaceRoot: root, episode,
    operationId: receipt.operationId, request: receipt.request});
  const files = await inspectEditorialMaterializationOutput(resolve(root, directory), source.implementation);
  const expected = editorialMaterializationManifest({episode, operationId: receipt.operationId,
    request: receipt.request, source, files});
  const expectedReceipt = editorialMaterializationReceipt(expected);
  if (!editorialMaterializationSame(expected, manifest) || !editorialMaterializationSame(expectedReceipt, receipt)) {
    throw editorialMaterializationError();
  }
  const input = await editorialMaterializationRegularFile(root, receipt.inputPropsPath);
  const inputProps = editorialMaterializationInputProps(episode);
  if (input.record.sha256 !== receipt.inputPropsSha256
    || input.bytes.toString("utf8") !== editorialMaterializationJson(inputProps)) throw editorialMaterializationError();
  const after = await editorialMaterializationRegularFile(root, receipt.manifestPath);
  if (!editorialMaterializationSame(before.record, after.record)) throw editorialMaterializationError();
  const finalFiles = await editorialMaterializationFileSet(resolve(root, directory));
  const expectedFiles = [...files.map(({role: _role, ...file}) => file), {path: "materialization.json", bytes: receipt.manifestBytes,
    sha256: receipt.manifestSha256}].sort((a, b) => a.path.localeCompare(b.path, "en"));
  if (!editorialMaterializationSame(finalFiles, expectedFiles)) throw editorialMaterializationError();
  const finalSource = await assertEditorialMaterializationSource({workspaceRoot: root, episode,
    operationId: receipt.operationId, request: receipt.request});
  if (!editorialMaterializationSame(source, finalSource)) throw editorialMaterializationError();
  return {manifest, receipt: expectedReceipt, assetRecords: editorialMaterializationAssetRecords(episode, manifest, receipt),
    inputProps, bundleDirectory: resolve(root, receipt.bundlePath), files};
}
