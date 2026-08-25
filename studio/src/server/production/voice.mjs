import { createHash } from "node:crypto";
import {
  episodePublicDirectory as defaultEpisodePublicDirectory,
  publicRoot,
  workspaceRelativePath as defaultWorkspaceRelativePath
} from "../../shared/paths.mjs";
import { appendEvent, readEpisode, writeEpisode } from "../../shared/store.mjs";
import {
  invalidateReviewForGate,
  nextAssetBundleRevision,
  resetApprovalForVersion
} from "../../shared/workflow.mjs";
import { assetExecutionApprovalRequired, assetExecutionApprovalValid } from "../reviews/asset-execution-checkpoint.mjs";
import {
  pendingUploadTransactionRoot,
  stageExclusiveVersionedUpload
} from "./upload-transaction.mjs";
import { inspectSupportedMedia } from "./media-signatures.mjs";

const supportedTypes = new Map([
  ["audio/mpeg", ".mp3"],
  ["audio/mp3", ".mp3"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/mp4", ".m4a"],
  ["audio/aac", ".aac"],
  ["audio/ogg", ".ogg"]
]);

export function voiceExtension(contentType, fileName = "") {
  const normalizedType = String(contentType).split(";", 1)[0].trim().toLowerCase();
  const mapped = supportedTypes.get(normalizedType);
  if (mapped) return mapped;
  const match = /\.(mp3|wav|m4a|aac|ogg)$/iu.exec(fileName);
  return match ? `.${match[1].toLowerCase()}` : null;
}

export function wavDurationSeconds(data) {
  if (!Buffer.isBuffer(data) || data.length < 44) {
    throw new Error("WAV 文件无效或不完整");
  }
  if (data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("WAV 文件缺少 RIFF/WAVE 标识");
  }
  let byteRate = 0;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= data.length;) {
    const chunkId = data.toString("ascii", offset, offset + 4);
    const chunkSize = data.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > data.length) throw new Error("WAV 数据块超出文件范围");
    if (chunkId === "fmt ") {
      if (chunkSize < 16) throw new Error("WAV fmt 数据块无效");
      const audioFormat = data.readUInt16LE(chunkStart);
      if (![1, 3].includes(audioFormat)) throw new Error("WAV 编码暂不支持，请使用 PCM WAV");
      byteRate = data.readUInt32LE(chunkStart + 8);
    }
    if (chunkId === "data") dataSize = chunkSize;
    offset = chunkEnd + (chunkSize % 2);
  }
  const durationSeconds = byteRate > 0 && dataSize > 0 ? dataSize / byteRate : Number.NaN;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("无法从 WAV 文件读取有效时长");
  }
  return Number(durationSeconds.toFixed(3));
}

export function voiceStepAfterUpload(step, assetsComplete) {
  return {
    ...step,
    status: assetsComplete ? "ready" : "pending",
    progress: 0,
    message: assetsComplete
      ? "旁白文件已上传，可以由旁白 Agent 提交机器审核"
      : "旁白文件已上传，等待素材清单先完成核验",
    requiresApproval: null,
    requiresHuman: false
  };
}

function nextVoiceFileName(files, extension) {
  const highest = files.reduce((current, file) => {
    const match = /^voice-v(\d{3})\.[a-z0-9]+$/u.exec(file);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return `voice-v${String(highest + 1).padStart(3, "0")}${extension}`;
}

export async function saveVoiceUpload(episodeId, upload, options = {}) {
  const extension = voiceExtension(upload.contentType, upload.fileName);
  if (!extension) throw new Error("旁白文件格式不支持，请使用 MP3、WAV、M4A、AAC 或 OGG");
  if (!Buffer.isBuffer(upload.data) || upload.data.length === 0) throw new Error("旁白文件为空");
  await (options.inspectMedia ?? inspectSupportedMedia)(upload.data, extension);
  const durationSeconds = extension === ".wav" ? wavDurationSeconds(upload.data) : null;

  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const episode = await readState(episodeId);
  if (assetExecutionApprovalRequired(episode) && !assetExecutionApprovalValid(episode)) {
    const error = new Error("素材执行方案尚未通过生成前机器审核与人工批准，不能登记旁白执行产物");
    error.code = "asset_execution_approval_required";
    throw error;
  }
  const stepIndex = episode.pipeline.findIndex((step) => step.agent === "voice-agent");
  if (stepIndex < 0) throw new Error("这一期缺少旁白 Agent 流水线步骤");
  const episodeDirectory = options.episodePublicDirectory ?? defaultEpisodePublicDirectory;
  const relativePath = options.workspaceRelativePath ?? defaultWorkspaceRelativePath;
  const staged = await stageExclusiveVersionedUpload({
    allowedRoot: options.uploadRoot ?? publicRoot,
    directory: episodeDirectory(episodeId),
    data: upload.data,
    nextFileName: (files) => nextVoiceFileName(files, extension),
    transaction: {
      markerRoot: options.uploadTransactionRoot ?? pendingUploadTransactionRoot,
      episodeId,
      kind: "voice",
      publicPathForFileName: (fileName) => `episodes/${episodeId}/${fileName}`
    }
  });
  const { fileName, destination } = staged;
  let publicPath;
  try {
    publicPath = `episodes/${episodeId}/${fileName}`;
    const version = Number(/voice-v(\d{3})/u.exec(fileName)?.[1] ?? 1);
    episode.voice = {
    ...episode.voice,
    status: "ready",
    version,
    mode: "uploaded-recording",
    audioPath: relativePath(destination),
    publicPath,
    bytes: upload.data.length,
    durationSeconds,
    sha256: createHash("sha256").update(upload.data).digest("hex"),
    uploadedAt: new Date().toISOString(),
    originalFileName: upload.fileName || null,
    note: "旁白文件已上传，等待人工素材与声音审批。",
    needsRevision: false
  };
  const assetBundleRevision = nextAssetBundleRevision(episode);
  episode.production = {
    ...(episode.production ?? {}),
    assetBundleRevision
  };
  episode.approvals.assets = resetApprovalForVersion(
    episode.approvals.assets,
    assetBundleRevision
  );
  episode.approvals.final = resetApprovalForVersion(
    episode.approvals.final,
    episode.render?.version ?? null
  );
  invalidateReviewForGate(episode, "assets");
  invalidateReviewForGate(episode, "final");
  const assetStepIndex = episode.pipeline.findIndex((step) => step.agent === "asset-agent");
  const assetsComplete = episode.pipeline[assetStepIndex]?.status === "complete";
  episode.pipeline[stepIndex] = voiceStepAfterUpload(
    episode.pipeline[stepIndex],
    assetsComplete
  );
  for (let index = stepIndex + 1; index < episode.pipeline.length; index += 1) {
    episode.pipeline[index] = {
      ...episode.pipeline[index],
      status: "pending",
      progress: 0,
      requiresApproval: null,
      message: "等待新旁白通过素材总审"
    };
  }
  episode.render = { ...episode.render, status: "stale", progress: 0 };
  episode.qa = { ...episode.qa, status: "stale", checkedAt: new Date().toISOString() };
  episode.status = "in_production";
  episode.updatedAt = new Date().toISOString();
  episode.history.push({
    at: episode.updatedAt,
    type: "voice-upload",
    message: `${fileName} 已登记，等待声音审批`
  });
    await writeState(episode);
  } catch (error) {
    await staged.rollback().catch(() => undefined);
    throw error;
  }
  await staged.commit();
  await recordEvent({
    type: "voice.uploaded",
    episodeId,
    message: assetsComplete
      ? "旁白文件已上传，等待旁白 Agent 和机器审核"
      : "旁白文件已上传，等待素材核验"
  });
  return { episode, publicPath, bytes: upload.data.length };
}
