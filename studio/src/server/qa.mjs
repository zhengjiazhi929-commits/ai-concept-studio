import { mkdir, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { getVideoMetadata } from "@remotion/renderer";
import { episodeOutputDirectory, workspaceRoot } from "../shared/paths.mjs";

function check(id, label, passed, actual, expected) {
  return { id, label, passed, actual, expected };
}

export async function runPreviewQa(episode) {
  if (!episode.render.outputPath) throw new Error("没有可检查的预览视频");
  const absolutePath = resolve(workspaceRoot, episode.render.outputPath);
  const [metadata, details] = await Promise.all([
    getVideoMetadata(absolutePath, { logLevel: "warn" }),
    stat(absolutePath)
  ]);

  const checks = [
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
    check("file-size", "文件有效", details.size > 50_000, details.size, "> 50000 bytes"),
    check("scenes", "场景完整", episode.scenes.length >= 6, episode.scenes.length, ">= 6")
  ];

  const passed = checks.every((item) => item.passed);
  const outputDirectory = episodeOutputDirectory(episode.id);
  await mkdir(outputDirectory, { recursive: true });
  const reportPath = resolve(outputDirectory, "preview-qa.json");
  const report = {
    episodeId: episode.id,
    checkedAt: new Date().toISOString(),
    passed,
    summary: passed ? "预览视频技术 QA 全部通过" : "预览视频存在未通过的技术检查",
    video: {
      path: episode.render.outputPath,
      bytes: details.size,
      metadata
    },
    checks
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    ...report,
    reportPath,
    relativeReportPath: relative(workspaceRoot, reportPath).replaceAll("\\", "/")
  };
}
