import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { episodePublicDirectory } from "../../shared/paths.mjs";
import { appendEvent, readEpisode, writeEpisode } from "../../shared/store.mjs";
import {
  invalidateReviewForGate,
  nextAssetBundleRevision,
  resetApprovalForVersion
} from "../../shared/workflow.mjs";
import {
  assetExecutionApprovalRequired,
  assetExecutionApprovalValid,
  assertAssetExecutionAuthorized
} from "../reviews/asset-execution-checkpoint.mjs";

const supportedTypes = new Map([
  ["image/png", { extension: ".png", type: "image" }],
  ["image/jpeg", { extension: ".jpg", type: "image" }],
  ["image/webp", { extension: ".webp", type: "image" }],
  ["video/mp4", { extension: ".mp4", type: "video" }],
  ["video/quicktime", { extension: ".mov", type: "video" }],
  ["audio/mpeg", { extension: ".mp3", type: "audio" }],
  ["audio/wav", { extension: ".wav", type: "audio" }],
  ["audio/x-wav", { extension: ".wav", type: "audio" }],
  ["audio/mp4", { extension: ".m4a", type: "audio" }],
  ["audio/aac", { extension: ".aac", type: "audio" }],
  ["audio/ogg", { extension: ".ogg", type: "audio" }]
]);

export function assetFileType(contentType, fileName = "") {
  const byMime = supportedTypes.get(
    String(contentType).split(";", 1)[0].trim().toLowerCase()
  );
  if (byMime) return byMime;
  const match = /\.(png|jpe?g|webp|mp4|mov|mp3|wav|m4a|aac|ogg)$/iu.exec(fileName);
  if (!match) return null;
  const extension = match[1].toLowerCase();
  if (extension === "jpeg") return { extension: ".jpg", type: "image" };
  if (["png", "jpg", "webp"].includes(extension)) {
    return { extension: `.${extension}`, type: "image" };
  }
  if (["mp4", "mov"].includes(extension)) {
    return { extension: `.${extension}`, type: "video" };
  }
  return { extension: `.${extension}`, type: "audio" };
}

function nextFileName(files, extension) {
  const highest = files.reduce((current, file) => {
    const match = /^material-v(\d{3})\.[a-z0-9]+$/u.exec(file);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return `material-v${String(highest + 1).padStart(3, "0")}${extension}`;
}

export async function saveAssetUpload(episodeId, upload) {
  const fileType = assetFileType(upload.contentType, upload.fileName);
  if (!fileType) {
    throw new Error("素材格式不支持，请使用图片、MP4/MOV 或常见音频格式");
  }
  if (!Buffer.isBuffer(upload.data) || upload.data.length === 0) throw new Error("素材文件为空");
  const planItemId = String(upload.planItemId ?? "").trim();
  if (!planItemId) throw new Error("上传素材必须关联素材清单条目");

  const episode = await readEpisode(episodeId);
  if (assetExecutionApprovalRequired(episode) && !assetExecutionApprovalValid(episode)) {
    const error = new Error("素材执行方案尚未通过生成前机器审核与人工批准，不能登记执行产物");
    error.code = "asset_execution_approval_required";
    throw error;
  }
  const plannedItems = episode.production?.assetPlan?.content?.items ?? [];
  const plannedItem = plannedItems.find((item) => item.id === planItemId);
  if (!plannedItem) {
    throw new Error(`素材清单中不存在条目：${planItemId}`);
  }
  if (assetExecutionApprovalRequired(episode)) {
    const allowedSources = new Set([
      "human-upload",
      "human-capture",
      "licensed-stock",
      "local-code-animation"
    ]);
    const source = String(upload.source ?? "human-upload");
    if (!allowedSources.has(source)) {
      const error = new Error("素材来源不在允许登记范围内");
      error.code = "asset_execution_source_not_allowed";
      throw error;
    }
    if (source === "local-code-animation") {
      assertAssetExecutionAuthorized(episode, {
        itemId: planItemId,
        executor: plannedItem.productionMethod?.executor,
        external: false
      });
    }
  }

  const directory = resolve(episodePublicDirectory(episodeId), "materials");
  await mkdir(directory, { recursive: true });
  const fileName = nextFileName(await readdir(directory), fileType.extension);
  const destination = resolve(directory, fileName);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, upload.data);
  await rename(temporary, destination);

  const publicPath = `episodes/${episodeId}/materials/${fileName}`;
  const materialVersion = Number(/material-v(\d{3})/u.exec(fileName)?.[1] ?? 1);
  const asset = {
    id: fileName.replace(/\.[^.]+$/u, ""),
    planItemId,
    type: fileType.type,
    path: publicPath,
    source: String(upload.source ?? "human-upload"),
    originalFileName: upload.fileName || null,
    bytes: upload.data.length,
    sha256: createHash("sha256").update(upload.data).digest("hex"),
    uploadedAt: new Date().toISOString(),
    privacy: "requires-human-review",
    verified: false
  };
  episode.assets = [...(episode.assets ?? []).filter((item) => item.planItemId !== planItemId), asset];
  const sceneIds = plannedItems.find((item) => item.id === planItemId)?.sceneIds ?? [];
  episode.scenes = episode.scenes.map((scene) =>
    sceneIds.includes(scene.id)
      ? { ...scene, [fileType.type === "audio" ? "audio" : "asset"]: publicPath }
      : scene
  );
  const assetStepIndex = episode.pipeline.findIndex((step) => step.agent === "asset-agent");
  if (assetStepIndex < 0) throw new Error("这一期缺少素材 Agent 流水线步骤");
  if (assetStepIndex >= 0) {
    episode.pipeline[assetStepIndex] = {
      ...episode.pipeline[assetStepIndex],
      status: "ready",
      message: "新素材已上传，可以重新核验素材清单"
    };
  }
  for (let index = assetStepIndex + 1; index < episode.pipeline.length; index += 1) {
    episode.pipeline[index] = {
      ...episode.pipeline[index],
      status: "pending",
      progress: 0,
      requiresApproval: null,
      message: "等待新素材通过核验与审批"
    };
  }
  const assetBundleRevision = nextAssetBundleRevision(episode);
  episode.production = {
    ...(episode.production ?? {}),
    materialsVersion: Math.max(episode.production?.materialsVersion ?? 0, materialVersion),
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
  episode.render = { ...episode.render, status: "stale", progress: 0 };
  episode.qa = { ...episode.qa, status: "stale", checkedAt: new Date().toISOString() };
  episode.status = "in_production";
  episode.updatedAt = new Date().toISOString();
  episode.history.push({
    at: episode.updatedAt,
    type: "asset-upload",
    message: `${planItemId} 已上传 ${fileName}，等待素材审批`
  });
  await writeEpisode(episode);
  await appendEvent({
    type: "asset.uploaded",
    episodeId,
    agentId: "asset-agent",
    message: `${planItemId} 素材已上传，等待核验`
  });
  return { episode, asset };
}
