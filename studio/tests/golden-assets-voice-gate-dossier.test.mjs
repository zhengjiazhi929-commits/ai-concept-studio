import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { inspectPcm16MonoWav } from "../src/server/production/local-media-inspection.mjs";
import {
  buildGoldenAssetsVoiceGateDossier,
  renderGoldenAssetsVoiceGateMarkdown
} from "../src/video/golden-assets-voice-gate-dossier.mjs";
import { buildGoldenLocalVoicePlan } from "../src/video/golden-local-voice-plan.mjs";

async function episodeFixture() {
  return JSON.parse(
    await readFile(new URL("./fixtures/episodes/golden-001.json", import.meta.url), "utf8")
  );
}

function pcmWav(seconds = 36, sampleRate = 24_000) {
  const sampleCount = seconds * sampleRate;
  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(index % 16_000 < 8_000 ? 1200 : -1200, 44 + index * 2);
  }
  return buffer;
}

function candidateManifest(episode, audioData) {
  return {
    id: "golden-local-voice-zm_010-v001",
    status: "human-review-candidate",
    source: {
      sourceBindingHash: buildGoldenLocalVoicePlan(episode).sourceBindingHash
    },
    model: {
      revision: "fixture",
      verifiedSha256: "a".repeat(64),
      license: "Apache-2.0"
    },
    voice: {
      id: "zm_010",
      licenseReviewStatus: "voice-package-license-not-independently-verified",
      useBoundary: "local-internal-review-only",
      releaseEligible: false
    },
    runtime: {
      lockSha256: "b".repeat(64),
      fingerprint: { schemaVersion: 1 }
    },
    audio: {
      outputPath: "outputs/studio/golden-001/fixture.wav",
      bytes: audioData.length,
      sha256: createHash("sha256").update(audioData).digest("hex")
    },
    generation: {
      mode: "local-offline-kokoro",
      offlineEnvironmentVerified: true,
      networkPolicy: "python-socket-api-deny",
      networkGuardScope: "generator-process-python-socket-apis",
      osLevelNetworkAttestation: false,
      configuredPaidApiCalls: 0,
      configuredExternalInferenceCalls: 0,
      configuredModelDownloadCallsDuringGeneration: 0,
      configuredTextUploadCalls: 0
    }
  };
}

function assetInspections(episode) {
  return episode.assets.map((asset) => ({
    id: asset.id,
    bytes: asset.bytes,
    sha256: asset.sha256
  }));
}

test("Gate dossier binds current approvals, assets, offline generation and audio", async () => {
  const episode = await episodeFixture();
  const audioData = pcmWav();
  const dossier = buildGoldenAssetsVoiceGateDossier({
    episode,
    manifest: candidateManifest(episode, audioData),
    audioData,
    audioInspection: inspectPcm16MonoWav(audioData),
    assetInspections: assetInspections(episode)
  });
  assert.equal(dossier.summary.passed, true);
  assert.equal(dossier.status, "ready-for-human-listen");
  assert.match(renderGoldenAssetsVoiceGateMarkdown(dossier), /不是人工批准/u);
});

test("Gate dossier fails closed when the source binding changes", async () => {
  const episode = await episodeFixture();
  const audioData = pcmWav();
  const manifest = candidateManifest(episode, audioData);
  manifest.source.sourceBindingHash = "0".repeat(64);
  const dossier = buildGoldenAssetsVoiceGateDossier({
    episode,
    manifest,
    audioData,
    audioInspection: inspectPcm16MonoWav(audioData),
    assetInspections: assetInspections(episode)
  });
  assert.equal(dossier.summary.passed, false);
  assert.ok(dossier.summary.failedCodes.includes("current-approved-inputs"));
});
