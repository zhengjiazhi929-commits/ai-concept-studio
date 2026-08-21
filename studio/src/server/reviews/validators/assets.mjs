import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureInside, publicRoot, workspaceRoot } from "../../../shared/paths.mjs";
import { progressiveTechnicalFlowPlanReview } from
  "../../../shared/technical-diagram-contract.mjs";
import { verifyRegisteredLocalOfflineVoiceForAssets } from
  "../../production/local-offline-voice.mjs";
import { reviewCheck } from "../checks.mjs";

export async function validateAssetsForReview(episode, options = {}) {
  const canAccess = options.access ?? access;
  const assets = episode.assets ?? [];
  const progressiveMotion = progressiveTechnicalFlowPlanReview(
    episode.production?.assetPlan?.content
  );
  const checks = [
    reviewCheck("asset-count", "已登记素材", assets.length > 0, {
      actual: assets.length,
      expected: "> 0",
      ownerAgentId: "asset-agent"
    }),
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
    checks.push(
      reviewCheck(`asset-source-${asset.id}`, `素材来源 ${asset.id}`, Boolean(asset.source), {
        severity: "warning",
        actual: asset.source ?? null,
        expected: "可追溯来源",
        ownerAgentId: "asset-agent"
      })
    );
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
