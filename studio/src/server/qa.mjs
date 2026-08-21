import { mkdir, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { getVideoMetadata } from "@remotion/renderer";
import { episodeOutputDirectory, workspaceRoot } from "../shared/paths.mjs";
import { evaluateProductionQuality } from "./production/quality.mjs";
import { inspectFileIntegrity, isSha256 } from "../shared/integrity.mjs";

function check(id, label, passed, actual, expected, ownerAgentId = "render-agent") {
  return { id, label, passed, actual, expected, ownerAgentId };
}

export function isSuccessfulQaWorkerStatus(status) {
  return status === "waiting_approval" || status === "complete";
}

export function renderIntegrityChecks(episode, actual) {
  const expectedBytes = episode.render?.bytes ?? null;
  const expectedSha256 = episode.render?.sha256 ?? null;
  return [
    check(
      "render-bytes",
      "成片字节数与渲染记录一致",
      Number.isSafeInteger(expectedBytes) && expectedBytes === actual.bytes,
      actual.bytes,
      expectedBytes
    ),
    check(
      "render-sha256",
      "成片 SHA-256 与渲染记录一致",
      isSha256(expectedSha256) && expectedSha256 === actual.sha256,
      actual.sha256,
      expectedSha256
    )
  ];
}

export function nextQaReportFileName(files, renderVersion) {
  const baseName = `preview-qa-v${renderVersion}.json`;
  let highestRevision = files.includes(baseName) ? 1 : 0;
  const revisionPattern = new RegExp(
    `^preview-qa-v${renderVersion}-r(\\d{3})\\.json$`,
    "u"
  );
  for (const file of files) {
    const match = revisionPattern.exec(file);
    if (match) highestRevision = Math.max(highestRevision, Number(match[1]));
  }
  return highestRevision === 0
    ? baseName
    : `preview-qa-v${renderVersion}-r${String(highestRevision + 1).padStart(3, "0")}.json`;
}

export async function runPreviewQa(episode) {
  if (!episode.render.outputPath) throw new Error("没有可检查的预览视频");
  const absolutePath = resolve(workspaceRoot, episode.render.outputPath);
  const [metadata, integrity] = await Promise.all([
    getVideoMetadata(absolutePath, { logLevel: "warn" }),
    inspectFileIntegrity(absolutePath)
  ]);

  const technicalChecks = [
    check("width", "竖屏宽度", metadata.width === episode.render.width, metadata.width, episode.render.width),
    check(
      "height",
      "竖屏高度",
      metadata.height === episode.render.height,
      metadata.height,
      episode.render.height
    ),
    check(
      "fps",
      "帧率",
      Math.abs(metadata.fps - episode.render.fps) < 0.1,
      metadata.fps,
      episode.render.fps
    ),
    check(
      "duration",
      "时长",
      Math.abs(metadata.durationInSeconds - episode.render.durationSeconds) < 0.35,
      metadata.durationInSeconds,
      episode.render.durationSeconds
    ),
    check("codec", "视频编码", metadata.codec === "h264", metadata.codec, "h264"),
    check("pixel-format", "像素格式", metadata.pixelFormat === "yuv420p", metadata.pixelFormat, "yuv420p"),
    check("file-size", "文件有效", integrity.bytes > 50_000, integrity.bytes, "> 50000 bytes"),
    ...renderIntegrityChecks(episode, integrity),
    check(
      "scenes",
      "场景完整",
      episode.scenes.length >= 6,
      episode.scenes.length,
      ">= 6",
      "storyboard-agent"
    )
  ];

  const quality = evaluateProductionQuality(episode, { stage: "qa" });
  const checks = [...technicalChecks, ...quality.checks];
  const passed = technicalChecks.every((item) => item.passed) && quality.passed;
  const outputDirectory = episodeOutputDirectory(episode.id);
  await mkdir(outputDirectory, { recursive: true });
  const renderVersion = /preview-v(\d{3})\.mp4$/u.exec(episode.render.outputPath)?.[1] ?? "latest";
  const reportPath = resolve(
    outputDirectory,
    nextQaReportFileName(await readdir(outputDirectory), renderVersion)
  );
  const report = {
    episodeId: episode.id,
    checkedAt: new Date().toISOString(),
    passed,
    summary: passed
      ? `技术与内容 QA 通过，质量 ${quality.score} 分（${quality.grade}）`
      : `QA 未通过：${technicalChecks.filter((item) => !item.passed).length} 项技术问题，${quality.errors.length} 项内容问题`,
    video: {
      path: episode.render.outputPath,
      bytes: integrity.bytes,
      sha256: integrity.sha256,
      metadata
    },
    checks,
    technicalChecks,
    quality
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    ...report,
    reportPath,
    relativeReportPath: relative(workspaceRoot, reportPath).replaceAll("\\", "/")
  };
}
