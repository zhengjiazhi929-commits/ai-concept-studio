import { resolve } from "node:path";
import { inspectFileIntegrity, integrityHash, matchesFileIntegrity } from
  "../../shared/integrity.mjs";
import {
  ensureInside,
  publicRoot,
  workspaceRoot
} from "../../shared/paths.mjs";
import {
  currentGateArtifactHash,
  currentGateVersion
} from "../../shared/workflow.mjs";

function integrityError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  error.details = details;
  return error;
}

function recordedFile(record, path) {
  return {
    path,
    bytes: record?.bytes,
    sha256: record?.sha256
  };
}

async function verifyFile(record, absolutePath, inspect, details = {}) {
  let actual;
  try {
    actual = await inspect(absolutePath);
  } catch (error) {
    throw integrityError(
      "素材或旁白文件无法完成当前字节校验",
      "asset_bundle_integrity_unavailable",
      { ...details, causeCode: error?.code ?? "file_read_failed" }
    );
  }
  if (!matchesFileIntegrity(record, actual)) {
    throw integrityError(
      "素材或旁白文件已在机器审核后发生变化，必须重新登记和审核",
      "asset_bundle_integrity_mismatch",
      {
        ...details,
        recorded: { bytes: record?.bytes ?? null, sha256: record?.sha256 ?? null },
        actual
      }
    );
  }
  return actual;
}

export async function assertCurrentAssetBundleIntegrity(episode, options = {}) {
  const inspect = options.inspectFileIntegrity ?? inspectFileIntegrity;
  const assets = [];
  for (const asset of episode.assets ?? []) {
    const path = String(asset?.path ?? "");
    if (!path) {
      throw integrityError(
        "登记素材缺少文件路径",
        "asset_bundle_integrity_unavailable",
        { assetId: asset?.id ?? null }
      );
    }
    const actual = await verifyFile(
      recordedFile(asset, path),
      ensureInside(publicRoot, resolve(publicRoot, path)),
      inspect,
      { kind: "asset", assetId: asset.id ?? null, path }
    );
    assets.push({
      id: asset.id ?? null,
      planItemId: asset.planItemId ?? null,
      path,
      bytes: actual.bytes,
      sha256: actual.sha256
    });
  }

  let voice = null;
  const voicePath = String(episode.voice?.audioPath ?? "");
  const voiceReady = episode.voice?.status === "ready" && Boolean(voicePath);
  if (episode.previewMode !== "visual-proof" && !voiceReady) {
    throw integrityError(
      "旁白尚未登记为可审核文件",
      "asset_bundle_integrity_unavailable",
      { kind: "voice" }
    );
  }
  if (voiceReady) {
    if (
      !Number.isSafeInteger(episode.voice?.bytes)
      || episode.voice.bytes <= 0
      || !/^[a-f0-9]{64}$/u.test(String(episode.voice?.sha256 ?? ""))
    ) {
      throw integrityError(
        "旁白缺少可复核的字节数或 SHA-256",
        "asset_bundle_integrity_unavailable",
        { kind: "voice" }
      );
    }
    const actual = await verifyFile(
      recordedFile(episode.voice, voicePath),
      ensureInside(workspaceRoot, resolve(workspaceRoot, voicePath)),
      inspect,
      { kind: "voice", path: voicePath }
    );
    voice = {
      path: voicePath,
      version: episode.voice.version ?? null,
      bytes: actual.bytes,
      sha256: actual.sha256
    };
  }

  const binding = {
    artifactVersion: currentGateVersion(episode, "assets"),
    artifactHash: currentGateArtifactHash(episode, "assets"),
    reviewReportId: episode.reviews?.assets?.latestReportId ?? null,
    assets,
    voice
  };
  return {
    ...binding,
    bindingHash: integrityHash(binding)
  };
}
