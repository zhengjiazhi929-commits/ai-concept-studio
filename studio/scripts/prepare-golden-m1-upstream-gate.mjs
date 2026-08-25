import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { approvalValidForGate, reviewPassedForGate } from
  "../src/server/control/policy-engine.mjs";
import { prepareGoldenM1UpstreamGate } from
  "../src/server/production/golden-m1-gate-preparation.mjs";
import { getHumanApprovalView } from
  "../src/server/reviews/human-approval-view.mjs";
import { readReviewConfig } from "../src/server/reviews/coordinator.mjs";
import { recheckGateReview } from "../src/server/orchestrator.mjs";
import {
  episodeOutputDirectory,
  workspaceRoot
} from "../src/shared/paths.mjs";
import { appendEvent, readEpisode, writeEpisode } from "../src/shared/store.mjs";

function nextVersion(files, gate) {
  const pattern = new RegExp(`^upstream-${gate}-gate-dossier-v(\\d{3})\\.(?:json|md)$`, "u");
  return files.reduce((highest, file) => {
    const match = pattern.exec(file);
    return Math.max(highest, match ? Number(match[1]) : 0);
  }, 0) + 1;
}

function markdownCell(value) {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function markdownFor(dossier) {
  const view = dossier.review;
  const lines = [
    `# ${dossier.episodeId} ${dossier.gate} Gate 资料包`,
    "",
    `生成时间：${dossier.generatedAt}`,
    "",
    "当前结论：**机器检查已通过，等待 Zhengjiazhi 人工决定**。这不是人工批准，也没有触发旁白、渲染或发布。",
    "",
    "## 精确绑定",
    "",
    `- 产物版本：${view.binding.artifactVersion}`,
    `- 当前 SHA-256：${view.binding.artifactHash}`,
    `- 机器报告：${view.binding.reviewReportId}`,
    `- 旧批准 SHA-256：${dossier.previousBinding.artifactHash ?? "无"}`,
    "",
    "## 机器检查",
    "",
    `- 结论：${view.machineReview?.decision ?? "missing"}`,
    `- 检查项：${view.machineReview?.checks?.length ?? 0}`,
    `- 阻断项：${view.machineReview?.blockingIssues?.length ?? 0}`,
    ""
  ];
  if (dossier.gate === "research") {
    const claims = dossier.content.research.content?.claims ?? [];
    const sources = dossier.content.research.content?.sources ?? [];
    lines.push(
      "## 固定研究证据",
      "",
      `- 已登记来源：${dossier.content.sourceDocs.length}`,
      `- 支持主张：${dossier.content.research.readiness.supportedClaimCount}`,
      `- 研究台账：${dossier.content.research.evidenceSource}`,
      "",
      "| 文件 | bytes | SHA-256 |",
      "|---|---:|---|",
      ...dossier.content.sourceDocs.map((source) =>
        `| ${source.path} | ${source.bytes ?? "—"} | ${source.sha256 ?? "—"} |`
      ),
      "",
      "## 本片将使用的六项结论",
      "",
      "| ID | 结论 | 使用边界 | 支持来源 |",
      "|---|---|---|---|",
      ...claims.map((claim) =>
        `| ${markdownCell(claim.id)} | ${markdownCell(claim.text)} | ${markdownCell(claim.boundary)} | ${markdownCell((claim.sourceIds ?? []).join("、"))} |`
      ),
      "",
      "## 结论引用的一手来源",
      "",
      "| ID | 来源 | 发布方 | 链接 |",
      "|---|---|---|---|",
      ...sources.map((source) =>
        `| ${markdownCell(source.id)} | ${markdownCell(source.label)} | ${markdownCell(source.publisher)} | ${markdownCell(source.url)} |`
      ),
      ""
    );
  } else if (dossier.gate === "script") {
    lines.push(
      "## 36 秒短脚本",
      "",
      "| 时间 | 旁白 | 证据 |",
      "|---|---|---|",
      ...dossier.content.sections.map((section) =>
        `| ${section.start}–${section.end}s | ${section.narration} | ${section.evidenceRefs.join("、")} |`
      ),
      ""
    );
  } else if (dossier.gate === "storyboard") {
    lines.push(
      "## 36 秒六镜分镜",
      "",
      "| 场景 | 时间 | 画面主旨 | 逻辑证据 |",
      "|---|---|---|---|",
      ...dossier.content.scenes.map((scene) =>
        `| ${scene.id} | ${scene.start}–${scene.end}s | ${(scene.title ?? scene.statement ?? "").replaceAll("\n", " / ")} | ${scene.evidenceRef ?? scene.assetHint ?? "—"} |`
      ),
      ""
    );
  }
  lines.push(
    "## 决策边界",
    "",
    "- 批准：只批准上面版本、哈希和机器报告精确绑定的当前内容。",
    "- 驳回：填写修改意见，回到对应生产阶段；不会覆盖历史版本。",
    "- 当前不会发生：自动批准后续 Gate、生成外部内容、调用付费 API、渲染、合并 main 或发布。",
    ""
  );
  return lines.join("\n");
}

export async function prepareAndWriteGoldenM1UpstreamGate(options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const recheck = options.recheckGateReview ?? recheckGateReview;
  const buildView = options.getHumanApprovalView ?? getHumanApprovalView;
  const readReviewRules = options.readReviewConfig ?? readReviewConfig;
  const source = await readState("golden-001");
  const prepared = prepareGoldenM1UpstreamGate(source, { now: options.now });
  if (!prepared.nextGate) {
    const error = new Error("research、script、storyboard 三道上游 Gate 均已与当前内容匹配");
    error.code = "golden_m1_upstream_gates_already_valid";
    throw error;
  }
  if (prepared.changed) {
    await writeState(prepared.episode);
    await recordEvent({
      type: "golden.upstream_binding_prepared",
      episodeId: prepared.episode.id,
      gate: prepared.nextGate,
      actor: "system:golden-m1-gate-preparation",
      message: `当前 ${prepared.nextGate} 候选已按新绑定规则准备，等待机器审核与人工决定`
    });
  }

  let episode = await readState("golden-001");
  const reviewConfig = await readReviewRules(options.reviewOptions ?? {});
  const reviewState = episode.reviews?.[prepared.nextGate] ?? {};
  const currentReport = reviewState.reports?.find(
    (report) => report.id === reviewState.latestReportId
  ) ?? null;
  const reviewMatchesCurrentRules = reviewPassedForGate(episode, prepared.nextGate)
    && currentReport?.reviewConfigVersion === reviewConfig.version
    && currentReport?.rubricVersion === reviewConfig.stages?.[prepared.nextGate]?.version;
  if (!reviewMatchesCurrentRules) {
    const result = await recheck("golden-001", prepared.nextGate, options.recheckOptions ?? {});
    episode = result.episode;
  }
  if (approvalValidForGate(episode, prepared.nextGate)) {
    const error = new Error("准备脚本不得自动产生有效人工批准");
    error.code = "golden_m1_gate_auto_approval_forbidden";
    throw error;
  }
  const review = await buildView("golden-001", prepared.nextGate, options.viewOptions ?? {});
  if (
    review.status?.readyForHumanApproval !== true
    || review.machineReview?.decision !== "pass"
    || review.binding?.artifactHash !== prepared.hashes[prepared.nextGate]
  ) {
    const error = new Error("当前上游 Gate 尚未形成可供人工决定的精确机器证据");
    error.code = "golden_m1_gate_dossier_not_ready";
    throw error;
  }

  const invalidation = [...(episode.history ?? [])].reverse().find(
    (entry) => entry.type === "approval-binding-invalidated"
      && entry.gate === prepared.nextGate
      && entry.artifactHash === review.binding.artifactHash
  );
  const generatedAtValue = typeof options.now === "function"
    ? options.now()
    : options.now ?? Date.now();
  const dossier = {
    schemaVersion: 1,
    id: `golden-001-${prepared.nextGate}-gate-dossier`,
    episodeId: "golden-001",
    gate: prepared.nextGate,
    generatedAt: new Date(generatedAtValue).toISOString(),
    status: "ready-for-human-approval",
    previousBinding: {
      version: invalidation?.previousVersion ?? null,
      artifactHash: invalidation?.previousArtifactHash ?? null
    },
    currentBinding: structuredClone(review.binding),
    content: prepared.nextGate === "research"
      ? {
          research: structuredClone(episode.research),
          sourceDocs: structuredClone(episode.sourceDocs ?? [])
        }
      : prepared.nextGate === "script"
        ? structuredClone(episode.production.scriptDraft.content)
        : {
          scenes: structuredClone(review.content.scenes),
          subtitles: structuredClone(review.content.subtitles),
          renderSpecification: structuredClone(review.content.renderSpecification)
        },
    decisionBoundary: {
      humanDecisionRequired: true,
      nextIfApproved: prepared.nextGate === "research"
        ? "prepare_script_gate"
        : prepared.nextGate === "script"
          ? "prepare_storyboard_gate"
          : "generate_local_internal_voice_candidate",
      forbidden: [
        "auto_approve_current_or_downstream_gate",
        "call_external_or_paid_generation_api",
        "render_before_assets_gate",
        "merge_or_publish"
      ]
    },
    review
  };

  const outputDirectory = resolve(
    options.outputDirectory ?? episodeOutputDirectory("golden-001")
  );
  await mkdir(outputDirectory, { recursive: true });
  const version = String(nextVersion(await readdir(outputDirectory), prepared.nextGate))
    .padStart(3, "0");
  const baseName = `upstream-${prepared.nextGate}-gate-dossier-v${version}`;
  const jsonPath = resolve(outputDirectory, `${baseName}.json`);
  const markdownPath = resolve(outputDirectory, `${baseName}.md`);
  await writeFile(jsonPath, `${JSON.stringify(dossier, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
  try {
    await writeFile(markdownPath, markdownFor(dossier), {
      encoding: "utf8",
      flag: "wx"
    });
  } catch (error) {
    await rm(jsonPath, { force: true });
    throw error;
  }
  return {
    gate: prepared.nextGate,
    artifactHash: review.binding.artifactHash,
    reviewReportId: review.binding.reviewReportId,
    jsonPath: relative(workspaceRoot, jsonPath).replaceAll("\\", "/"),
    markdownPath: relative(workspaceRoot, markdownPath).replaceAll("\\", "/")
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(JSON.stringify(await prepareAndWriteGoldenM1UpstreamGate(), null, 2));
}
