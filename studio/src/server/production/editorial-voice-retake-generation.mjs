// Local IO adapters for the sealed retake service. Never registers an Episode.
import {writeFile, realpath, lstat} from "node:fs/promises";
import {resolve} from "node:path";
import {spawn} from "node:child_process";
import {workspaceRoot as fixedWorkspaceRoot} from "../../shared/paths.mjs";
import {readEpisode} from "../../shared/store.mjs";
import {readReviewConfig} from "../reviews/coordinator.mjs";
import {createEditorialVoiceRetakeService} from "./editorial-voice-retake-core.mjs";
import {canonicalJsonDocumentContentSha256 as digest} from "../../shared/durable-json-store.mjs";
import {buildEditorialVoiceRetakeTiming} from "../../shared/editorial-voice-retakes.mjs";
import {serializeEditorialVoiceSrt} from "../../shared/editorial-voice-timing.mjs";
import {editorialVoiceRetakeCapabilitySpec, validateEditorialVoiceRetakeRequest,
  editorialVoiceRetakeInput, EDITORIAL_VOICE_RETAKE_OPERATION} from "../../shared/editorial-voice-retake-request.mjs";
import {requireSideEffectGrant} from "../security/side-effect-capability.mjs";
import {editorialVoicePin, verifyEditorialVoiceInputs} from "./editorial-voice-inputs.mjs";
import {createEditorialVoiceDirectory, inspectEditorialVoicePcm, verifyEditorialVoicePcmAssembly,
  editorialVoiceIntegrityError, inspectEditorialVoiceRetakeBase, inspectEditorialVoiceCandidate} from "./editorial-voice-integrity.mjs";
import {editorialMaterializationRegularFile as readRegular, editorialMaterializationFileSet as fileSet,
  editorialMaterializationSha as sha, editorialMaterializationJson as json} from "./editorial-materialization-integrity.mjs";

const same = (a, b) => digest(a ?? null) === digest(b ?? null);
function need(value, code = "editorial_voice_retake_integrity_changed") {if (!value) throw editorialVoiceIntegrityError(code);}
function grant(request, sideEffectGrant) {
  const claims = requireSideEffectGrant({sideEffectGrant}, editorialVoiceRetakeCapabilitySpec(request), EDITORIAL_VOICE_RETAKE_OPERATION);
  need(claims.maxCalls === 0 && claims.maxCostUsd === 0
    && same([...claims.scopes].sort(), ["filesystem.write", "local-inference"]), "editorial_voice_retake_capability_not_zero");
}
async function readEditorialVoiceRepairPlan({workspaceRoot, path}) {
  const file = await readRegular(workspaceRoot, path); need(file.bytes.length <= 4 * 1024 * 1024);
  return {value: JSON.parse(file.bytes.toString("utf8")), record: file.record};
}
async function verifyDriver(root, driver) {
  await verifyEditorialVoiceInputs(root, {plan: driver.basePlan, model: driver.model,
    pinnedFiles: driver.pinnedFiles, runtimeLock: driver.runtimeLock});
  need(driver.retakeDriverPin.path === resolve(root, "studio/scripts/retake-editorial-local-voice.py")
    && same(driver.retakeDriverPin, await editorialVoicePin(driver.retakeDriverPin.path)));
}
async function prepareEditorialVoiceRetakeDriver({workspaceRoot, base, repairPlan, retakePlan}) {
  const root = await realpath(resolve(workspaceRoot));
  const {model, pinnedFiles, runtimeLock} = base.driverRequest;
  const driver = {basePlan: base.basePlan, baseTiming: base.timing, repairPlan, retakePlan,
    baseMedia: {path: resolve(root, base.directory, "media"), files: base.result.segments.map(segment => ({
      id: segment.id, file: segment.file, bytes: segment.bytes, sha256: segment.sha256, sampleCount: segment.sampleCount}))},
    model, pinnedFiles, runtimeLock, retakeDriverPin: await editorialVoicePin(resolve(root, "studio/scripts/retake-editorial-local-voice.py"))};
  await verifyDriver(root, driver); return structuredClone(driver);
}

async function runDriver({root, directory, driver, requestSha256, request, sideEffectGrant}) {
  await verifyDriver(root, driver);
  const read = await readRegular(root, `${directory}/driver-request.json`);
  need(read.record.sha256 === requestSha256);
  await verifyCurrentRequest(request);
  grant(request, sideEffectGrant);
  return new Promise((accept, reject) => {
    const child = spawn(driver.pinnedFiles.python.path, [driver.retakeDriverPin.path, "--request",
      resolve(root, directory, "driver-request.json"), "--request-sha256", requestSha256,
      "--output", resolve(root, directory, "media")], {cwd: root, stdio: ["ignore", "pipe", "pipe"], env: {
      PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, PYTHONDONTWRITEBYTECODE: "1",
      PYTHONNOUSERSITE: "1", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1",
      TOKENIZERS_PARALLELISM: "false", PYTORCH_ENABLE_MPS_FALLBACK: "1"}});
    let stdout = "", stderr = "", limited = false;
    const timer = setTimeout(() => {limited = true; child.kill("SIGKILL");}, 30 * 60 * 1000);
    const capture = stream => chunk => {
      if (stream === "stdout") stdout += chunk; else stderr += chunk;
      if (stdout.length > 2 * 1024 * 1024 || stderr.length > 2 * 1024 * 1024) {
        limited = true; child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", capture("stdout")); child.stderr.on("data", capture("stderr"));
    child.on("error", error => {clearTimeout(timer); reject(error);});
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0 && !limited) accept({stdout, stderr});
      else reject(Object.assign(editorialVoiceIntegrityError("editorial_voice_retake_synthesis_failed"), {exitCode: code}));
    });
  });
}

async function generateEditorialVoiceRetakeCandidate({workspaceRoot, preview, request: rawRequest, sideEffectGrant}) {
  const request = validateEditorialVoiceRetakeRequest(rawRequest); grant(request, sideEffectGrant);
  const root = await realpath(resolve(workspaceRoot));
  need(request.snapshotHash === preview.snapshotHash && request.sourceHash === digest(preview.source)
    && request.implementationHash === preview.implementationHash);
  await verifyDriver(root, preview.driverRequest);
  const generationRequest = {schemaVersion: "editorial-voice-retake-generation-request-v1", episodeId: request.episodeId,
    source: preview.source, implementationHash: preview.implementationHash, plan: preview.base.basePlan,
    retakePlan: preview.retakePlan, episodeSnapshotHash: request.snapshotHash,
    driverRequestSha256: sha(json(preview.driverRequest)),
    baseCandidate: {path: request.baseCandidatePath, sha256: request.baseCandidateSha256}, repairPlan: preview.repair.record,
    executionRequest: request, authorization: {actor: "human:Zhengjiazhi", scope: "local-full-narration-and-caption-registration",
      paidApiCalls: 0, render: false, assetsVoiceAccepted: false, release: false}};
  const generationRequestHash = sha(json(generationRequest));
  const directory = `outputs/studio/${request.episodeId}/editorial-voice-candidates/${generationRequestHash}`;
  const absolute = resolve(root, directory);
  const write = async (path, bytes) => {
    need(/^[A-Za-z0-9_.-]+$/u.test(path));
    need(await realpath(absolute) === absolute && !(await lstat(absolute)).isSymbolicLink(), "editorial_voice_path_unsafe");
    grant(request, sideEffectGrant); await writeFile(resolve(absolute, path), bytes, {flag: "wx"});
  };
  await verifyCurrentRequest(request);
  grant(request, sideEffectGrant); await createEditorialVoiceDirectory(root, directory, {exclusive: true});
  grant(request, sideEffectGrant); await createEditorialVoiceDirectory(root, `${directory}/media`, {exclusive: true});
  const baseManifest = await readRegular(root, request.baseCandidatePath);
  const repair = await readRegular(root, request.repairPlanPath);
  need(baseManifest.record.sha256 === request.baseCandidateSha256 && same(repair.record, preview.repair.record));
  await write("base-candidate.json", baseManifest.bytes); await write("repair-plan.json", repair.bytes);
  await write("request.json", json(generationRequest)); await write("driver-request.json", json(preview.driverRequest));
  const execution = await runDriver({root, directory, driver: preview.driverRequest,
    requestSha256: generationRequest.driverRequestSha256, request, sideEffectGrant});
  await write("execution.json", json(execution));
  const resultFile = await readRegular(root, `${directory}/media/result.json`); need(resultFile.bytes.length < 16 * 1024 * 1024);
  const result = JSON.parse(resultFile.bytes.toString("utf8"));
  need(result.schemaVersion === "editorial-local-voice-retake-result-v1"
    && result.requestSha256 === generationRequest.driverRequestSha256
    && result.segments?.length === preview.retakePlan.parents.length);
  const measurements = [], pieces = [];
  for (const [index, parent] of preview.retakePlan.parents.entries()) {
    const measured = result.segments[index];
    need(measured.id === parent.id && measured.file === `${parent.id}.wav` && measured.mode === parent.mode);
    const pcm = await readRegular(root, `${directory}/media/${parent.id}.wav`);
    const info = inspectEditorialVoicePcm(pcm.bytes);
    need(measured.sampleCount === info.sampleCount && measured.sha256 === pcm.record.sha256 && measured.bytes === pcm.record.bytes);
    const children = [], bytes = [];
    need(Array.isArray(measured.parts) && measured.parts.length === parent.parts.length);
    for (const [partIndex, part] of parent.parts.entries()) {
      const item = measured.parts[partIndex]; need(item.id === part.id && item.file === `${part.id}.wav`);
      const file = await readRegular(root, `${directory}/media/${part.id}.wav`); const child = inspectEditorialVoicePcm(file.bytes);
      need(item.sampleCount === child.sampleCount && item.sha256 === file.record.sha256 && item.bytes === file.record.bytes);
      children.push({id: part.id, sampleCount: child.sampleCount}); bytes.push(file.bytes.subarray(44));
    }
    if (parent.mode === "retake") need(Buffer.concat(bytes).equals(pcm.bytes.subarray(44)));
    else {
      const original = await readRegular(root, `${preview.base.directory}/media/${parent.id}.wav`);
      const bound = preview.base.result.segments[index];
      need(bound.id === parent.id && bound.sha256 === original.record.sha256 && bound.bytes === original.record.bytes
        && bound.sampleCount === info.sampleCount && original.bytes.equals(pcm.bytes));
    }
    measurements.push({id: parent.id, sampleCount: info.sampleCount, parts: children});
    pieces.push({bytes: pcm.bytes, pauseAfterSamples: parent.pauseAfterSamples});
  }
  const timing = buildEditorialVoiceRetakeTiming(preview.base.basePlan, preview.repair.value, measurements);
  const voice = await readRegular(root, `${directory}/media/voice.wav`);
  need(verifyEditorialVoicePcmAssembly(voice.bytes, pieces).sampleCount === timing.totalSamples);
  await write("timing.json", json(timing)); await write("captions.json", json(timing.captions));
  await write("captions.srt", serializeEditorialVoiceSrt(timing.captions));
  const files = await fileSet(absolute); const record = path => files.find(file => file.path === path);
  const manifest = {schemaVersion: "editorial-local-voice-retake-candidate-v1", episodeId: request.episodeId,
    generationRequestHash, source: preview.source, implementationHash: preview.implementationHash,
    synthesis: structuredClone(preview.base.manifest.synthesis),
    audio: {...record("media/voice.wav"), totalSamples: timing.totalSamples, durationSeconds: timing.durationSeconds,
      sampleRate: 24000, channels: 1, bitsPerSample: 16},
    captions: {...record("captions.json"), count: timing.captions.length}, timing: record("timing.json"), files,
    alignmentMethod: timing.alignmentMethod, captionAligned: true, motionAligned: false, renderReady: false,
    externalApiCalls: 0, maximumPaidCostUsd: 0, releaseEligible: false,
    baseCandidate: generationRequest.baseCandidate, repairPlan: generationRequest.repairPlan};
  await verifyDriver(root, preview.driverRequest); await verifyCurrentRequest(request);
  await write("voice-manifest.json", json(manifest));
  return {candidatePath: `${directory}/voice-manifest.json`, candidateSha256: sha(json(manifest)),
    durationSeconds: timing.durationSeconds, captionCount: timing.captions.length,
    captionDurationIssues: timing.captionDurationIssues, registered: false, rendered: false};
}

// The process sink and every IO adapter remain module-private. Only this fixed
// production assembly can provide the fully inspected context to synthesis.
const service = createEditorialVoiceRetakeService({workspaceRoot: fixedWorkspaceRoot, readEpisode, readReviewConfig,
  inspectBase: inspectEditorialVoiceRetakeBase, readRepairPlan: readEditorialVoiceRepairPlan,
  prepareDriver: prepareEditorialVoiceRetakeDriver, generateCandidate: generateEditorialVoiceRetakeCandidate,
  verifyCandidate: inspectEditorialVoiceCandidate});
async function verifyCurrentRequest(request) {
  const current = await service.previewEditorialVoiceRetake(editorialVoiceRetakeInput(request));
  need(current.snapshotHash === request.snapshotHash && current.sourceHash === request.sourceHash
    && current.implementationHash === request.implementationHash, "editorial_voice_retake_snapshot_changed");
}
export function previewEditorialVoiceRetake(input) {
  if (arguments.length !== 1) throw new TypeError("Editorial retake preview does not accept overrides");
  return service.previewEditorialVoiceRetake(input);
}
export function retakeEditorialVoice(request, options = {}) {
  if (arguments.length > 2) throw new TypeError("Editorial retake does not accept overrides");
  return service.retakeEditorialVoice(request, options);
}
