import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { inspectPcm16MonoWav } from "../src/server/production/local-media-inspection.mjs";
import { inspectFileIntegrity } from "../src/shared/integrity.mjs";
import {
  ensureInside,
  episodeOutputDirectory,
  publicRoot,
  studioOutputRoot,
  workspaceRoot
} from "../src/shared/paths.mjs";
import { readEpisode } from "../src/shared/store.mjs";
import {
  buildGoldenAssetsVoiceGateDossier,
  renderGoldenAssetsVoiceGateMarkdown
} from "../src/video/golden-assets-voice-gate-dossier.mjs";
import { GOLDEN_LOCAL_VOICE_EPISODE_ID } from "../src/video/golden-local-voice-plan.mjs";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function workspacePath(target) {
  return relative(workspaceRoot, target).replaceAll("\\", "/");
}

function relativeLink(fromDirectory, target) {
  const value = relative(fromDirectory, target).replaceAll("\\", "/");
  return value.startsWith(".") ? value : "./" + value;
}

async function latestManifestPath(outputDirectory) {
  const manifests = (await readdir(outputDirectory))
    .filter((file) => /^golden-local-voice-zm_010-v\d{3}-manifest\.json$/u.test(file))
    .sort();
  if (manifests.length === 0) {
    throw new Error("没有可供 Gate 复核的本地旁白候选");
  }
  return resolve(outputDirectory, manifests.at(-1));
}

function nextDossierVersion(files) {
  return files.reduce((highest, file) => {
    const match = /^assets-voice-gate-dossier-v(\d{3})\.(?:json|md)$/u.exec(file);
    return Math.max(highest, match ? Number(match[1]) : 0);
  }, 0) + 1;
}

export async function writeGoldenAssetsVoiceGateDossier(options = {}) {
  const episode = await (options.readEpisode ?? readEpisode)(GOLDEN_LOCAL_VOICE_EPISODE_ID);
  const outputDirectory = episodeOutputDirectory(episode.id);
  await mkdir(outputDirectory, { recursive: true });
  const manifestPath = options.manifestPath
    ? ensureInside(studioOutputRoot, resolve(workspaceRoot, options.manifestPath))
    : await latestManifestPath(outputDirectory);
  const manifestData = await readFile(manifestPath);
  const manifest = JSON.parse(manifestData.toString("utf8"));
  const audioPath = ensureInside(workspaceRoot, resolve(workspaceRoot, manifest.audio.outputPath));
  const audioData = await readFile(audioPath);
  const audioInspection = inspectPcm16MonoWav(audioData, {
    sampleRate: 24_000,
    durationSeconds: 36,
    maximumInactiveWindowRun: 4
  });
  const assetInspections = await Promise.all((episode.assets ?? []).map(async (asset) => {
    const integrity = await inspectFileIntegrity(
      ensureInside(publicRoot, resolve(publicRoot, asset.path))
    );
    return { id: asset.id, ...integrity };
  }));
  const dossier = buildGoldenAssetsVoiceGateDossier({
    episode,
    manifest,
    audioData,
    audioInspection,
    assetInspections
  });
  if (!dossier.summary.passed) {
    const error = new Error(
      "Gate 资料包机器检查失败：" + dossier.summary.failedCodes.join(", ")
    );
    error.code = "golden_assets_voice_gate_dossier_failed";
    throw error;
  }

  const version = String(nextDossierVersion(await readdir(outputDirectory))).padStart(3, "0");
  const jsonPath = resolve(outputDirectory, "assets-voice-gate-dossier-v" + version + ".json");
  const markdownPath = resolve(outputDirectory, "assets-voice-gate-dossier-v" + version + ".md");
  const markdown = renderGoldenAssetsVoiceGateMarkdown(dossier, {
    audioLink: "./" + basename(audioPath),
    assetLinks: (episode.assets ?? []).map((asset) => ({
      id: asset.id,
      link: relativeLink(outputDirectory, resolve(publicRoot, asset.path))
    }))
  });
  await writeFile(jsonPath, JSON.stringify({
    ...dossier,
    evidence: {
      voiceManifestPath: workspacePath(manifestPath),
      voiceManifestSha256: sha256(manifestData),
      dossierMarkdownPath: workspacePath(markdownPath)
    }
  }, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  try {
    await writeFile(markdownPath, markdown, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    await rm(jsonPath, { force: true });
    throw error;
  }
  return {
    dossier,
    jsonPath: workspacePath(jsonPath),
    markdownPath: workspacePath(markdownPath)
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await writeGoldenAssetsVoiceGateDossier({
    manifestPath: process.argv[2]
  });
  console.log(JSON.stringify(result, null, 2));
}
