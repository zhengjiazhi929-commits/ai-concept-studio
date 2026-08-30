import { createHash } from "node:crypto";

import {
  buildGoldenLocalVoicePlan,
  GOLDEN_LOCAL_VOICE_DURATION_SECONDS,
  GOLDEN_LOCAL_VOICE_EPISODE_ID,
  GOLDEN_LOCAL_VOICE_ID
} from "./golden-local-voice-plan.mjs";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function check(code, label, passed, evidence) {
  return { code, label, passed: Boolean(passed), evidence };
}

function sameNumber(left, right, tolerance = 0.001) {
  return Number.isFinite(left)
    && Number.isFinite(right)
    && Math.abs(left - right) <= tolerance;
}

function assetEvidence(episode, inspections) {
  return (episode.assets ?? []).map((asset) => {
    const actual = inspections.find((item) => item.id === asset.id);
    return {
      id: asset.id,
      path: asset.path,
      source: asset.source ?? null,
      privacy: asset.privacy ?? null,
      expectedBytes: asset.bytes,
      actualBytes: actual?.bytes ?? null,
      expectedSha256: asset.sha256,
      actualSha256: actual?.sha256 ?? null,
      passed: Boolean(
        actual
        && actual.bytes === asset.bytes
        && actual.sha256 === asset.sha256
      )
    };
  });
}

export function buildGoldenAssetsVoiceGateDossier(input) {
  const { episode, manifest, audioData, audioInspection, assetInspections } = input;
  if (episode?.id !== GOLDEN_LOCAL_VOICE_EPISODE_ID) {
    throw new Error("Gate 资料包只允许 " + GOLDEN_LOCAL_VOICE_EPISODE_ID);
  }
  const currentPlan = buildGoldenLocalVoicePlan(episode);
  const assets = assetEvidence(episode, assetInspections ?? []);
  const audioHash = sha256(audioData);
  const checks = [
    check(
      "current-approved-inputs",
      "候选仍绑定当前研究、脚本和分镜批准版本",
      manifest?.source?.sourceBindingHash === currentPlan.sourceBindingHash,
      {
        currentSourceBindingHash: currentPlan.sourceBindingHash,
        candidateSourceBindingHash: manifest?.source?.sourceBindingHash ?? null
      }
    ),
    check(
      "current-assets",
      "四项素材当前字节仍与 Episode 登记一致",
      assets.length >= 4 && assets.every((item) => item.passed),
      assets
    ),
    check(
      "audio-integrity",
      "旁白文件字节、摘要和格式检查一致",
      manifest?.audio?.bytes === audioData.length
        && manifest?.audio?.sha256 === audioHash
        && sameNumber(audioInspection.durationSeconds, GOLDEN_LOCAL_VOICE_DURATION_SECONDS)
        && audioInspection.sampleRate === 24_000
        && audioInspection.channels === 1
        && audioInspection.bitsPerSample === 16,
      {
        expectedBytes: manifest?.audio?.bytes ?? null,
        actualBytes: audioData.length,
        expectedSha256: manifest?.audio?.sha256 ?? null,
        actualSha256: audioHash,
        durationSeconds: audioInspection.durationSeconds,
        sampleRate: audioInspection.sampleRate,
        channels: audioInspection.channels,
        bitsPerSample: audioInspection.bitsPerSample
      }
    ),
    check(
      "audio-coverage",
      "旁白有足够语音覆盖，没有异常长静音",
      audioInspection.activeWindowRatio >= 0.35
        && audioInspection.longestInactiveWindowRun <= 4,
      {
        activeWindowRatio: audioInspection.activeWindowRatio,
        longestInactiveWindowRun: audioInspection.longestInactiveWindowRun,
        rootMeanSquareAmplitude: audioInspection.rootMeanSquareAmplitude,
        peakAmplitude: audioInspection.peakAmplitude
      }
    ),
    check(
      "local-offline-generation",
      "旁白使用固定本地模型，生成进程阻断 Python socket，且未配置外部或付费调用",
      manifest?.model?.license === "Apache-2.0"
        && manifest?.voice?.id === GOLDEN_LOCAL_VOICE_ID
        && manifest?.generation?.mode === "local-offline-kokoro"
        && manifest?.generation?.offlineEnvironmentVerified === true
        && manifest?.generation?.networkPolicy === "python-socket-api-deny"
        && manifest?.generation?.networkGuardScope
          === "generator-process-python-socket-apis"
        && manifest?.generation?.osLevelNetworkAttestation === false
        && manifest?.generation?.configuredPaidApiCalls === 0
        && manifest?.generation?.configuredExternalInferenceCalls === 0
        && manifest?.generation?.configuredModelDownloadCallsDuringGeneration === 0
        && manifest?.generation?.configuredTextUploadCalls === 0
        && manifest?.runtime?.fingerprint?.schemaVersion === 1
        && /^[a-f0-9]{64}$/u.test(String(manifest?.runtime?.lockSha256 ?? "")),
      {
        modelRevision: manifest?.model?.revision ?? null,
        modelSha256: manifest?.model?.verifiedSha256 ?? null,
        modelLicense: manifest?.model?.license ?? null,
        voiceId: manifest?.voice?.id ?? null,
        generation: manifest?.generation ?? null
      }
    ),
    check(
      "voice-license-boundary",
      "音色包仅限本地内部评审，许可独立复核前禁止公开发布",
      manifest?.voice?.licenseReviewStatus
        === "voice-package-license-not-independently-verified"
        && manifest?.voice?.useBoundary === "local-internal-review-only"
        && manifest?.voice?.releaseEligible === false,
      {
        licenseReviewStatus: manifest?.voice?.licenseReviewStatus ?? null,
        useBoundary: manifest?.voice?.useBoundary ?? null,
        releaseEligible: manifest?.voice?.releaseEligible ?? null
      }
    ),
    check(
      "human-gate-not-bypassed",
      "候选尚未写入 Episode，也没有自动批准素材/声音 Gate",
      episode.voice?.status !== "ready"
        && episode.approvals?.assets?.status === "pending"
        && manifest?.status === "human-review-candidate",
      {
        episodeVoiceStatus: episode.voice?.status ?? null,
        assetsGateStatus: episode.approvals?.assets?.status ?? null,
        candidateStatus: manifest?.status ?? null
      }
    )
  ];
  const failed = checks.filter((item) => !item.passed);
  return {
    schemaVersion: 1,
    id: manifest.id + "-assets-voice-gate-dossier",
    episodeId: episode.id,
    candidateId: manifest.id,
    generatedAt: new Date().toISOString(),
    status: failed.length === 0 ? "ready-for-human-listen" : "machine-check-failed",
    decisionBoundary: {
      current: "human_voice_direction_selection",
      nextIfAccepted: "securely_register_voice_then_run_assets_machine_review",
      forbidden: [
        "mutate_episode_before_human_selection",
        "approve_assets_gate_automatically",
        "render_before_assets_gate",
        "public_release_before_voice_license_review"
      ]
    },
    candidate: {
      audioPath: manifest.audio.outputPath,
      audioBytes: audioData.length,
      audioSha256: audioHash,
      durationSeconds: audioInspection.durationSeconds,
      voiceId: manifest.voice.id,
      sourceBindingHash: manifest.source.sourceBindingHash,
      manifestId: manifest.id
    },
    checks,
    summary: {
      passed: failed.length === 0,
      passedCount: checks.length - failed.length,
      failedCount: failed.length,
      failedCodes: failed.map((item) => item.code)
    }
  };
}

export function renderGoldenAssetsVoiceGateMarkdown(dossier, options = {}) {
  const status = dossier.summary.passed
    ? "机器检查通过，等待 Zhengjiazhi 试听"
    : "机器检查未通过";
  const audioLink = options.audioLink ?? dossier.candidate.audioPath;
  const lines = [
    "# " + dossier.episodeId + " 素材/声音 Gate 试听资料",
    "",
    "生成时间：" + dossier.generatedAt,
    "",
    "当前结论：**" + status + "**。这不是人工批准，也没有触发渲染。",
    "",
    "## 试听候选",
    "",
    "- 音色：" + dossier.candidate.voiceId,
    "- 时长：" + dossier.candidate.durationSeconds + " 秒",
    "- 音频：[" + audioLink + "](" + audioLink + ")",
    "- SHA-256：" + dossier.candidate.audioSha256,
    "",
    "## 机器检查",
    "",
    "| 检查 | 结果 |",
    "|---|---|",
    ...dossier.checks.map((item) => "| " + item.label + " | " + (item.passed ? "通过" : "失败") + " |"),
    "",
    "## 决策边界",
    "",
    "- 接受：安全登记当前精确 WAV，随后运行素材/声音机器审核，再由 Zhengjiazhi 进行正式 Gate 批准。",
    "- 驳回：保留本候选作为审计证据，生成一个新版本；不覆盖旧文件。",
    "- 当前禁止：自动批准素材 Gate、提前渲染、调用外部或付费语音服务。",
    ""
  ];
  if (Array.isArray(options.assetLinks) && options.assetLinks.length > 0) {
    lines.push("## 当前素材", "");
    for (const asset of options.assetLinks) {
      lines.push("- " + asset.id + "：[查看素材](" + asset.link + ")");
    }
    lines.push("");
  }
  return lines.join("\n");
}
