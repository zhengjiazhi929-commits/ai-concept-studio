import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ensureInside,
  publicRoot,
  resolveExistingPathInside,
  workspaceRoot
} from "../../../shared/paths.mjs";
import {
  inspectFileIntegrity,
  matchesFileIntegrity
} from "../../../shared/integrity.mjs";
import { progressiveTechnicalFlowPlanReview } from
  "../../../shared/technical-diagram-contract.mjs";
import { verifyRegisteredLocalOfflineVoiceForAssets } from
  "../../production/local-offline-voice.mjs";
import { reviewCheck } from "../checks.mjs";
import {
  validateApprovedExternalAssetBinding,
  validateApprovedExternalAssetReceipt,
  validateAssetRights
} from "../../../shared/asset-rights.mjs";

export async function verifyApprovedExternalAssetReceiptForReview(
  episode,
  asset,
  options = {}
) {
  const binding = validateApprovedExternalAssetBinding(episode, asset);
  if (!binding.valid) return { valid: false, errors: binding.errors };
  const resolveExisting = options.resolveExistingPathInside ?? resolveExistingPathInside;
  const inspect = options.inspectFileIntegrity ?? inspectFileIntegrity;
  const readReceipt = options.readFile ?? readFile;
  try {
    const receiptCandidate = ensureInside(
      publicRoot,
      resolve(publicRoot, binding.expectedReceiptPath)
    );
    const mediaCandidate = ensureInside(publicRoot, resolve(publicRoot, binding.expectedPath));
    const [receiptPath, mediaPath] = await Promise.all([
      resolveExisting(publicRoot, receiptCandidate),
      resolveExisting(publicRoot, mediaCandidate)
    ]);
    const receiptBefore = await inspect(receiptPath);
    if (receiptBefore.bytes <= 0 || receiptBefore.bytes > 1024 * 1024) {
      return { valid: false, errors: ["receipt size is invalid"] };
    }
    const raw = await readReceipt(receiptPath, "utf8");
    const receiptAfter = await inspect(receiptPath);
    if (!matchesFileIntegrity(receiptBefore, receiptAfter)) {
      return { valid: false, errors: ["receipt changed during verification"] };
    }
    let receipt;
    try {
      receipt = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
    } catch {
      return { valid: false, errors: ["receipt is not valid JSON"] };
    }
    const receiptValidation = validateApprovedExternalAssetReceipt(
      episode,
      asset,
      receipt
    );
    const mediaIntegrity = await inspect(mediaPath);
    if (
      mediaIntegrity.bytes !== asset.bytes ||
      mediaIntegrity.sha256 !== asset.sha256
    ) {
      receiptValidation.errors.push("media file does not match receipt asset snapshot");
    }
    return {
      valid: receiptValidation.errors.length === 0,
      errors: receiptValidation.errors,
      receiptPath: binding.expectedReceiptPath,
      mediaPath: binding.expectedPath
    };
  } catch (error) {
    return {
      valid: false,
      errors: [error?.code ?? "external asset receipt or media is unavailable"]
    };
  }
}

export async function validateAssetsForReview(episode, options = {}) {
  const canAccess = options.access ?? access;
  const assets = episode.assets ?? [];
  const progressiveMotion = progressiveTechnicalFlowPlanReview(
    episode.production?.assetPlan?.content
  );
  const rightsValidation = assets.map((asset) => ({
    assetId: asset?.id ?? null,
    ...validateAssetRights(asset)
  }));
  const uploadedVoice = episode.voice?.mode === "uploaded-recording";
  const voiceRightsValidation = uploadedVoice
    ? validateAssetRights({
        id: `voice-v${episode.voice?.version ?? "unknown"}`,
        path: episode.voice?.publicPath ?? episode.voice?.audioPath,
        source: "human-uploaded-recording",
        bytes: episode.voice?.bytes,
        sha256: episode.voice?.sha256,
        rights: episode.voice?.rights
      })
    : { valid: true, errors: [] };
  const externalReceiptReviews = await Promise.all(
    assets
      .filter((asset) => asset?.source === "approved-external-generation")
      .map(async (asset) => ({
        assetId: asset.id,
        ...(await (
          options.verifyApprovedExternalAssetReceipt ??
          verifyApprovedExternalAssetReceiptForReview
        )(episode, asset, options))
      }))
  );
  const checks = [
    reviewCheck("asset-count", "已登记素材", assets.length > 0, {
      actual: assets.length,
      expected: "> 0",
      ownerAgentId: "asset-agent"
    }),
    reviewCheck(
      "asset-rights-registry",
      "素材许可证与隐私台账完整",
      assets.length > 0 && rightsValidation.every((item) => item.valid),
      {
        actual: {
          checkedAssets: rightsValidation.length,
          invalidAssets: rightsValidation.filter((item) => !item.valid)
        },
        expected:
          "每项素材绑定路径、bytes、SHA-256、作者/来源、获得时间、许可证、允许用途、署名、隐私/肖像状态和验证人",
        ownerAgentId: "asset-agent",
        suggestedFix: "补齐并核验素材许可证台账；缺任一关键授权字段时禁止进入素材 Gate"
      }
    ),
    reviewCheck(
      "voice-rights-registry",
      "上传旁白许可证与声音授权台账完整",
      voiceRightsValidation.valid,
      {
        actual: uploadedVoice
          ? { applicable: true, errors: voiceRightsValidation.errors }
          : { applicable: false, mode: episode.voice?.mode ?? null },
        expected: uploadedVoice
          ? "上传旁白绑定录音者/来源、许可证、允许用途、署名、声音授权状态和验证人"
          : "当前旁白模式不适用，按 N/A 通过",
        ownerAgentId: "voice-agent",
        suggestedFix: "补齐上传旁白的权利与声音授权台账后重新机器审核"
      }
    ),
    reviewCheck(
      "external-asset-receipts",
      "外部生成素材绑定当前批准调用、权利声明、可信收据和媒体哈希",
      externalReceiptReviews.every((item) => item.valid),
      {
        actual: {
          applicable: externalReceiptReviews.length > 0,
          invalidAssets: externalReceiptReviews.filter((item) => !item.valid)
        },
        expected: externalReceiptReviews.length > 0
          ? "每项外部生成素材与当前候选、调用合同、权利声明、完成收据和真实媒体文件完全一致"
          : "当前素材没有外部生成项，按 N/A 通过",
        ownerAgentId: "asset-agent",
        suggestedFix: "重新从当前批准候选的受控执行器生成素材；禁止手工补写 rights 或 receipt 字段"
      }
    ),
    reviewCheck(
      "progressive-technical-explanation",
      "技术图按获批知识逻辑逐步推导",
      progressiveMotion.passed,
      {
        actual: progressiveMotion,
        expected: progressiveMotion.required
          ? "每个本地或外部技术图从最小状态分阶段建立全部节点与连线，并保留最终完整图"
          : "当前素材方案没有需要渐进式审核的技术图",
        ownerAgentId: "asset-agent",
        suggestedFix:
          "退回 Asset Agent，补齐逐步推导时间轴、节点显现顺序、连线激活顺序和最终停留阶段"
      }
    )
  ];
  for (const asset of assets) {
    let exists = false;
    try {
      const path = ensureInside(publicRoot, resolve(publicRoot, asset.path));
      await canAccess(path);
      exists = true;
    } catch {
      exists = false;
    }
    checks.push(
      reviewCheck(`asset-file-${asset.id}`, `素材文件 ${asset.id}`, exists, {
        actual: asset.path,
        expected: "文件存在且位于 public 目录",
        ownerAgentId: "asset-agent"
      })
    );
    const assetRights = validateAssetRights(asset);
    checks.push(reviewCheck(
      `asset-rights-${asset.id}`,
      `素材授权 ${asset.id}`,
      assetRights.valid,
      {
        actual: { source: asset.source ?? null, errors: assetRights.errors },
        expected: "符合 docs/licensing.md 的最小登记字段",
        ownerAgentId: "asset-agent",
        suggestedFix: "由操作者补齐来源、许可证、用途、署名、隐私和验证记录"
      }
    ));
  }
  let voiceFileExists = episode.previewMode === "visual-proof";
  if (episode.voice?.status === "ready" && episode.voice.audioPath) {
    try {
      const path = ensureInside(workspaceRoot, resolve(workspaceRoot, episode.voice.audioPath));
      await canAccess(path);
      voiceFileExists = true;
    } catch {
      voiceFileExists = false;
    }
  }
  checks.push(
    reviewCheck("voice-file-exists", "旁白文件真实存在", voiceFileExists, {
      actual: episode.voice?.audioPath ?? null,
      expected: episode.previewMode === "visual-proof"
        ? "允许无旁白视觉验证"
        : "文件存在且位于工作区",
      ownerAgentId: "voice-agent"
    })
  );
  const isLocalOfflineVoice = episode.voice?.mode === "local-offline-tts";
  let localOfflineVoiceReview = null;
  let localOfflineVoiceError = null;
  if (isLocalOfflineVoice) {
    try {
      localOfflineVoiceReview = await (
        options.verifyLocalOfflineVoice ?? verifyRegisteredLocalOfflineVoiceForAssets
      )(episode, options);
    } catch (error) {
      localOfflineVoiceError = error?.code ?? "local_tts_assets_verification_failed";
    }
  }
  const localOfflinePassed = !isLocalOfflineVoice || Boolean(localOfflineVoiceReview);
  const localOfflineActual = isLocalOfflineVoice
    ? (localOfflineVoiceReview
      ? {
          candidateHash: localOfflineVoiceReview.candidateHash,
          machineVerificationId: localOfflineVoiceReview.machineVerificationId,
          machineVerificationHash: localOfflineVoiceReview.machineVerificationHash,
          verificationId: localOfflineVoiceReview.verificationId,
          bytes: localOfflineVoiceReview.bytes,
          sha256: localOfflineVoiceReview.sha256,
          reuseAttestation: localOfflineVoiceReview.reuseAttestation
        }
      : { errorCode: localOfflineVoiceError })
    : { mode: episode.voice?.mode ?? null, applicable: false };
  for (const [code, label, expected] of [
    [
      "voice-local-offline-provenance",
      "本地离线旁白来源、模型、代码版本与许可证可复算",
      "候选、模型、配置、代码版本、音色和零外部调用证明均与当前来源一致"
    ],
    [
      "voice-local-offline-integrity",
      "本地离线旁白候选和公共 WAV 完整性通过",
      "非符号链接的 60 秒 PCM WAV，字节数和 SHA-256 与 v002 一致"
    ],
    [
      "voice-local-offline-authorization",
      "本地离线旁白绑定精确机器验证与 Zhengjiazhi 人工选择",
      "candidateHash、machineVerification 与 human verificationId 可重新验证"
    ]
  ]) {
    checks.push(reviewCheck(code, label, localOfflinePassed, {
      actual: localOfflineActual,
      expected: isLocalOfflineVoice ? expected : "当前声音模式不适用，按 N/A 通过",
      ownerAgentId: "voice-agent",
      suggestedFix: "退回 Voice Agent，重新执行只读候选验证并取得 Zhengjiazhi 对精确哈希的批准"
    }));
  }
  return checks;
}
