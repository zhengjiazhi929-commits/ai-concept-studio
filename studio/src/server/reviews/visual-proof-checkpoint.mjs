import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import {
  inspectFileIntegrity,
  integrityHash,
  matchesFileIntegrity
} from "../../shared/integrity.mjs";
import {
  episodeOutputDirectory,
  ensureInside,
  workspaceRelativePath,
  workspaceRoot
} from "../../shared/paths.mjs";
import {
  appendEvent,
  readEpisode,
  writeEpisode
} from "../../shared/store.mjs";

const VISUAL_PROOF_CHECKPOINT_VERSION = 1;

function timestamp(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

function reviewCheck(id, label, passed, actual, expected) {
  return { id, label, passed, actual, expected };
}

function checkpointState(initial = {}) {
  return {
    schemaVersion: VISUAL_PROOF_CHECKPOINT_VERSION,
    status: initial.status ?? "not_started",
    currentCandidate: initial.currentCandidate ?? null,
    machineReview: initial.machineReview ?? null,
    humanApproval: initial.humanApproval ?? null,
    history: Array.isArray(initial.history) ? initial.history : []
  };
}

function artifactPath(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(`${label}路径不能为空`);
    error.code = "invalid_visual_proof_path";
    throw error;
  }
  return workspaceRelativePath(value);
}

async function readStableText(relativePath, options = {}) {
  const inspect = options.inspectFileIntegrity ?? inspectFileIntegrity;
  const readText = options.readFile ?? readFile;
  const absolutePath = ensureInside(workspaceRoot, `${workspaceRoot}/${relativePath}`);
  const before = await inspect(absolutePath);
  const content = await readText(absolutePath, "utf8");
  const after = await inspect(absolutePath);
  if (!matchesFileIntegrity(before, after)) {
    const error = new Error("审核证据在读取期间发生变化，请重新检查");
    error.code = "visual_proof_evidence_changed";
    throw error;
  }
  return {
    text: typeof content === "string" ? content : content.toString("utf8"),
    integrity: after
  };
}

function generationUsesOnlyLocalResources(generation = {}) {
  return [
    "paidApiCalls",
    "externalInferenceCalls",
    "generatedImageCalls",
    "generatedVideoCalls",
    "textUploadCalls"
  ].every((field) => generation[field] === 0);
}

function outputPathBelongsToEpisode(episodeId, value) {
  try {
    const relativePath = workspaceRelativePath(value);
    const absolutePath = ensureInside(workspaceRoot, `${workspaceRoot}/${relativePath}`);
    ensureInside(episodeOutputDirectory(episodeId), absolutePath);
    return true;
  } catch {
    return false;
  }
}

export async function inspectVisualProofCandidate(episodeId, input, options = {}) {
  const manifestPath = artifactPath(input?.manifestPath, "视觉样片清单");
  const qaReportPath = artifactPath(input?.qaReportPath, "设计 QA 报告");
  const comparisonPath = artifactPath(input?.comparisonPath, "设计对比图");
  const versionMatch = /^visual-proof-v(\d{3})-manifest\.json$/u.exec(basename(manifestPath));
  if (!versionMatch) {
    const error = new Error("视觉样片清单必须使用 visual-proof-vNNN-manifest.json 版本名");
    error.code = "invalid_visual_proof_manifest_name";
    throw error;
  }
  const version = Number(versionMatch[1]);
  const manifestEvidence = await readStableText(manifestPath, options);
  let manifest;
  try {
    manifest = JSON.parse(manifestEvidence.text);
  } catch {
    const error = new Error("视觉样片清单不是有效 JSON");
    error.code = "invalid_visual_proof_manifest";
    throw error;
  }
  const outputPath = artifactPath(manifest.outputPath, "视觉样片视频");
  const inspect = options.inspectFileIntegrity ?? inspectFileIntegrity;
  const outputIntegrity = await inspect(
    ensureInside(workspaceRoot, `${workspaceRoot}/${outputPath}`)
  );
  const qaEvidence = await readStableText(qaReportPath, options);
  const comparisonIntegrity = await inspect(
    ensureInside(workspaceRoot, `${workspaceRoot}/${comparisonPath}`)
  );
  const versionLabel = String(version).padStart(3, "0");
  const expectedIdSuffix = `visual-proof-v${versionLabel}`;
  const expectedOutputName = `visual-proof-v${versionLabel}.mp4`;
  const stills = Array.isArray(manifest.stills) ? manifest.stills : [];
  const checks = [
    reviewCheck(
      "episode-binding",
      "样片清单绑定当前 Episode",
      manifest.episodeId === episodeId,
      manifest.episodeId ?? null,
      episodeId
    ),
    reviewCheck(
      "version-binding",
      "文件名、清单 ID 与样片版本一致",
      typeof manifest.id === "string"
        && manifest.id.endsWith(expectedIdSuffix)
        && basename(outputPath) === expectedOutputName,
      { id: manifest.id ?? null, output: basename(outputPath) },
      { idSuffix: expectedIdSuffix, output: expectedOutputName }
    ),
    reviewCheck(
      "output-boundary",
      "样片与证据保留在当前 Episode 输出目录",
      outputPathBelongsToEpisode(episodeId, outputPath)
        && outputPathBelongsToEpisode(episodeId, manifestPath)
        && outputPathBelongsToEpisode(episodeId, qaReportPath)
        && outputPathBelongsToEpisode(episodeId, comparisonPath),
      { outputPath, manifestPath, qaReportPath, comparisonPath },
      `outputs/studio/${episodeId}/`
    ),
    reviewCheck(
      "video-integrity",
      "样片字节数与 SHA-256 匹配清单",
      matchesFileIntegrity(
        { bytes: manifest.bytes, sha256: manifest.sha256 },
        outputIntegrity
      ) && outputIntegrity.bytes > 50_000,
      outputIntegrity,
      { bytes: manifest.bytes ?? null, sha256: manifest.sha256 ?? null }
    ),
    reviewCheck(
      "render-contract",
      "样片渲染参数符合 60 秒竖屏视觉证明契约",
      manifest.durationSeconds === 60
        && manifest.fps === 30
        && manifest.width === 540
        && manifest.height === 960
        && Number.isInteger(manifest.sourceRenderVersion)
        && manifest.sourceRenderVersion > 0,
      {
        durationSeconds: manifest.durationSeconds ?? null,
        fps: manifest.fps ?? null,
        width: manifest.width ?? null,
        height: manifest.height ?? null,
        sourceRenderVersion: manifest.sourceRenderVersion ?? null
      },
      { durationSeconds: 60, fps: 30, width: 540, height: 960 }
    ),
    reviewCheck(
      "local-generation",
      "样片没有付费 API、外部推理或内容上传调用",
      manifest.generation?.mode === "local-code-motion"
        && generationUsesOnlyLocalResources(manifest.generation),
      manifest.generation ?? null,
      "local-code-motion and all external call counters equal 0"
    ),
    reviewCheck(
      "qa-result",
      "设计 QA 明确通过并引用当前样片",
      /^final result: passed$/mu.test(qaEvidence.text)
        && qaEvidence.text.includes(outputPath)
        && qaEvidence.text.includes(comparisonPath),
      /^final result: passed$/mu.test(qaEvidence.text) ? "passed" : "missing",
      `passed and references ${expectedOutputName}`
    ),
    reviewCheck(
      "stills-evidence",
      "清单保留足够的逐帧审核证据",
      stills.length >= 6
        && stills.every((path) => outputPathBelongsToEpisode(episodeId, path)),
      stills.length,
      ">= 6 workspace-safe stills"
    )
  ];
  const candidate = {
    episodeId,
    version,
    sourceRenderVersion: manifest.sourceRenderVersion ?? null,
    manifest: { path: manifestPath, ...manifestEvidence.integrity },
    video: { path: outputPath, ...outputIntegrity },
    qa: { path: qaReportPath, result: /^final result: passed$/mu.test(qaEvidence.text) ? "passed" : "blocked", ...qaEvidence.integrity },
    comparison: { path: comparisonPath, ...comparisonIntegrity }
  };
  candidate.candidateHash = integrityHash(candidate);
  return {
    candidate,
    checks,
    passed: checks.every((check) => check.passed)
  };
}

export async function reviewVisualProofCandidate(episodeId, input, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const sourceEpisode = await readState(episodeId);
  const inspected = await inspectVisualProofCandidate(episodeId, input, options);
  const previous = checkpointState(sourceEpisode.reviewCheckpoints?.visualProof);
  if (
    previous.status === "approved"
    && previous.currentCandidate?.candidateHash === inspected.candidate.candidateHash
    && inspected.passed
  ) {
    return { episode: sourceEpisode, checkpoint: previous, unchanged: true };
  }
  const at = timestamp(options.now);
  const reviewId = `visual-proof-review-v${String(inspected.candidate.version).padStart(3, "0")}-${at.replaceAll(/[:.]/gu, "-")}`;
  const machineReview = {
    id: reviewId,
    status: inspected.passed ? "passed" : "blocked",
    checkedAt: at,
    candidateHash: inspected.candidate.candidateHash,
    checks: inspected.checks
  };
  const checkpoint = {
    schemaVersion: VISUAL_PROOF_CHECKPOINT_VERSION,
    status: inspected.passed ? "waiting_approval" : "blocked",
    currentCandidate: inspected.candidate,
    machineReview,
    humanApproval: null,
    history: [
      ...previous.history,
      {
        type: "machine-review",
        at,
        version: inspected.candidate.version,
        candidateHash: inspected.candidate.candidateHash,
        reviewId,
        status: machineReview.status
      }
    ]
  };
  const episode = structuredClone(sourceEpisode);
  episode.reviewCheckpoints = {
    ...(episode.reviewCheckpoints ?? {}),
    visualProof: checkpoint
  };
  episode.updatedAt = at;
  episode.history = [
    ...(episode.history ?? []),
    {
      at,
      type: "visual-proof-machine-review",
      status: machineReview.status,
      version: inspected.candidate.version,
      candidateHash: inspected.candidate.candidateHash,
      message: inspected.passed
        ? `视觉样片 v${inspected.candidate.version} 机器检查通过，等待人工审批`
        : `视觉样片 v${inspected.candidate.version} 机器检查未通过`
    }
  ];
  await writeState(episode);
  await recordEvent({
    type: "visual-proof.reviewed",
    episodeId,
    version: inspected.candidate.version,
    candidateHash: inspected.candidate.candidateHash,
    status: machineReview.status,
    idempotencyKey: `visual-proof.reviewed:${episodeId}:${inspected.candidate.candidateHash}`
  });
  return { episode, checkpoint, unchanged: false };
}

export async function approveVisualProofCandidate(episodeId, input = {}, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const sourceEpisode = await readState(episodeId);
  const previous = checkpointState(sourceEpisode.reviewCheckpoints?.visualProof);
  if (!previous.currentCandidate || !previous.machineReview) {
    const error = new Error("当前没有经过机器检查的视觉样片候选");
    error.code = "visual_proof_review_missing";
    error.statusCode = 409;
    throw error;
  }
  const expectedCandidateHash = String(input.candidateHash ?? "");
  const machineReviewId = String(input.machineReviewId ?? "");
  if (
    !expectedCandidateHash
    || !machineReviewId
    || expectedCandidateHash !== previous.currentCandidate.candidateHash
    || machineReviewId !== previous.machineReview.id
  ) {
    const error = new Error("人工审批没有精确绑定当前视觉样片候选和机器审核报告");
    error.code = "visual_proof_review_conflict";
    error.statusCode = 409;
    throw error;
  }
  const inspected = await inspectVisualProofCandidate(episodeId, {
    manifestPath: previous.currentCandidate.manifest.path,
    qaReportPath: previous.currentCandidate.qa.path,
    comparisonPath: previous.currentCandidate.comparison.path
  }, options);
  if (
    !inspected.passed
    || inspected.candidate.candidateHash !== expectedCandidateHash
    || previous.machineReview.status !== "passed"
    || previous.machineReview.candidateHash !== expectedCandidateHash
  ) {
    const error = new Error("视觉样片证据已变化或机器检查未通过，必须重新审核");
    error.code = "visual_proof_review_stale";
    error.statusCode = 409;
    throw error;
  }
  if (
    previous.status === "approved"
    && previous.humanApproval?.candidateHash === expectedCandidateHash
  ) {
    return { episode: sourceEpisode, checkpoint: previous, unchanged: true };
  }
  if (previous.status !== "waiting_approval") {
    const error = new Error("视觉样片当前不在等待人工审批状态");
    error.code = "visual_proof_not_waiting_approval";
    error.statusCode = 409;
    throw error;
  }
  const at = timestamp(options.now);
  const note = String(input.note ?? "").trim();
  const actor = typeof options.actor === "string" ? options.actor.slice(0, 128) : null;
  const humanApproval = {
    decision: "approved",
    at,
    note,
    version: inspected.candidate.version,
    candidateHash: expectedCandidateHash,
    machineReviewId: previous.machineReview.id,
    ...(actor ? { actor } : {})
  };
  const checkpoint = {
    ...previous,
    status: "approved",
    currentCandidate: inspected.candidate,
    humanApproval,
    history: [
      ...previous.history,
      {
        type: "human-approval",
        at,
        version: inspected.candidate.version,
        candidateHash: expectedCandidateHash,
        machineReviewId: previous.machineReview.id,
        decision: "approved",
        note,
        ...(actor ? { actor } : {})
      }
    ]
  };
  const episode = structuredClone(sourceEpisode);
  episode.reviewCheckpoints = {
    ...(episode.reviewCheckpoints ?? {}),
    visualProof: checkpoint
  };
  episode.updatedAt = at;
  episode.history = [
    ...(episode.history ?? []),
    {
      at,
      type: "visual-proof-human-approval",
      status: "approved",
      version: inspected.candidate.version,
      candidateHash: expectedCandidateHash,
      ...(actor ? { actor } : {}),
      message: note || `人工操作者已批准视觉样片 v${inspected.candidate.version}`
    }
  ];
  await writeState(episode);
  await recordEvent({
    type: "visual-proof.approved",
    episodeId,
    version: inspected.candidate.version,
    candidateHash: expectedCandidateHash,
    actor,
    message: note || `视觉样片 v${inspected.candidate.version} 已通过人工审批`,
    idempotencyKey: `visual-proof.approved:${episodeId}:${expectedCandidateHash}`
  });
  return { episode, checkpoint, unchanged: false };
}

export async function verifyVisualProofApproval(episodeId, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const episode = await readState(episodeId);
  const checkpoint = checkpointState(episode.reviewCheckpoints?.visualProof);
  if (!checkpoint.currentCandidate) {
    return {
      valid: false,
      status: "not_started",
      checkpoint,
      checks: [reviewCheck("candidate", "视觉样片候选已登记", false, null, "registered")]
    };
  }
  let inspected;
  try {
    inspected = await inspectVisualProofCandidate(episodeId, {
      manifestPath: checkpoint.currentCandidate.manifest.path,
      qaReportPath: checkpoint.currentCandidate.qa.path,
      comparisonPath: checkpoint.currentCandidate.comparison.path
    }, options);
  } catch (error) {
    return {
      valid: false,
      status: "stale",
      checkpoint,
      checks: [
        reviewCheck(
          "evidence-readable",
          "视觉样片审批证据仍可读取",
          false,
          error?.code ?? "evidence_error",
          "readable"
        )
      ]
    };
  }
  const approvalChecks = [
    ...inspected.checks,
    reviewCheck(
      "candidate-hash",
      "当前证据仍匹配机器审核候选哈希",
      inspected.candidate.candidateHash === checkpoint.currentCandidate.candidateHash
        && checkpoint.machineReview?.candidateHash === checkpoint.currentCandidate.candidateHash,
      inspected.candidate.candidateHash,
      checkpoint.currentCandidate.candidateHash
    ),
    reviewCheck(
      "human-approval",
      "人工审批绑定当前候选与机器审核",
      checkpoint.status === "approved"
        && checkpoint.machineReview?.status === "passed"
        && checkpoint.humanApproval?.decision === "approved"
        && checkpoint.humanApproval?.candidateHash === checkpoint.currentCandidate.candidateHash
        && checkpoint.humanApproval?.machineReviewId === checkpoint.machineReview?.id,
      checkpoint.humanApproval?.decision ?? null,
      "approved"
    )
  ];
  return {
    valid: approvalChecks.every((check) => check.passed),
    status: checkpoint.status,
    checkpoint,
    checks: approvalChecks
  };
}
