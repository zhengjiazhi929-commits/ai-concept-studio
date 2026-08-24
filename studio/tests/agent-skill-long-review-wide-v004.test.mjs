import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { studioRoot } from "../src/shared/paths.mjs";
import {
  PROTECTED_WIDE_V004_BASELINES,
  REVIEW_WIDE_V004_PATHS,
  REVIEW_WIDE_V004_RENDER_CONTRACT,
  assertWideV004Composition,
  assertWideV004InputsChanged,
  assertWideV004Media,
  parseMp4AudioSampleRate
} from "../scripts/render-agent-skill-long-review-wide-v004.mjs";

const ROOT_PATH = resolve(studioRoot, "src", "video", "agent-skill-long-review-root.jsx");
const RENDER_PATH = resolve(
  studioRoot,
  "scripts",
  "render-agent-skill-long-review-wide-v004.mjs"
);

test("横版 v004 渲染合同固定为 1920x1080、30fps、18000 帧和 H264/AAC/yuv420p/48kHz", () => {
  assert.deepEqual(
    {
      compositionId: REVIEW_WIDE_V004_RENDER_CONTRACT.compositionId,
      width: REVIEW_WIDE_V004_RENDER_CONTRACT.width,
      height: REVIEW_WIDE_V004_RENDER_CONTRACT.height,
      fps: REVIEW_WIDE_V004_RENDER_CONTRACT.fps,
      durationInFrames: REVIEW_WIDE_V004_RENDER_CONTRACT.durationInFrames,
      codec: REVIEW_WIDE_V004_RENDER_CONTRACT.codec,
      audioCodec: REVIEW_WIDE_V004_RENDER_CONTRACT.audioCodec,
      pixelFormat: REVIEW_WIDE_V004_RENDER_CONTRACT.pixelFormat,
      sampleRate: REVIEW_WIDE_V004_RENDER_CONTRACT.sampleRate
    },
    {
      compositionId: "AgentSkillLongReview",
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 18_000,
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      sampleRate: 48_000
    }
  );
  assert.equal(REVIEW_WIDE_V004_RENDER_CONTRACT.durationSeconds, 600);
  assert.equal(REVIEW_WIDE_V004_RENDER_CONTRACT.candidateVersion, 4);
});

test("横版 v004 只允许新的专用候选目录和文件", () => {
  assert.equal(
    REVIEW_WIDE_V004_PATHS.candidateDirectoryRelative,
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v004"
  );
  assert.equal(
    REVIEW_WIDE_V004_PATHS.outputPathRelative,
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v004/review-10m.mp4"
  );
  assert.equal(
    REVIEW_WIDE_V004_PATHS.manifestPathRelative,
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v004/review-manifest.json"
  );
});

test("横版 Composition 合同拒绝旧 540x960 规格", () => {
  const valid = {
    id: "AgentSkillLongReview",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 18_000
  };
  assert.doesNotThrow(() => assertWideV004Composition(valid));
  assert.throws(
    () => assertWideV004Composition({ ...valid, width: 540, height: 960 }),
    /不符合固定合同/u
  );
});

test("媒体合同同时检查 48kHz 实际采样率", () => {
  const metadata = {
    width: 1920,
    height: 1080,
    fps: 30,
    durationInSeconds: 600.042,
    codec: "h264",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    canPlayInVideoTag: true,
    supportsSeeking: true
  };
  const integrity = { bytes: 80_000, sha256: "a".repeat(64) };
  assert.doesNotThrow(() => assertWideV004Media(metadata, integrity, 48_000));
  assert.throws(
    () => assertWideV004Media(metadata, integrity, 44_100),
    /sampleRate=44100/u
  );
});

test("MP4 mp4a sample entry 可以解析 16.16 格式采样率", () => {
  const mp4a = Buffer.alloc(40);
  mp4a.writeUInt32BE(40, 0);
  mp4a.write("mp4a", 4, "ascii");
  mp4a.writeUInt16BE(2, 24);
  mp4a.writeUInt16BE(16, 26);
  mp4a.writeUInt32BE(48_000 * 65_536, 32);
  assert.equal(parseMp4AudioSampleRate(mp4a), 48_000);
  assert.throws(() => parseMp4AudioSampleRate(Buffer.from("not-an-mp4")), /无法从 MP4/u);
});

test("v004 不允许只改候选目录名，必须存在相对 v003 的真实源变化", () => {
  const unchanged = {
    "studio/src/video/agent-skill-long-review-root.jsx": {
      sha256: "878fcd51cc75a443735c3c2e28c5e3b24ed9f7594b02e736f48b026b09072537"
    },
    "studio/src/video/agent-skill-long-review.jsx": {
      sha256: "ecf6308c261b359a3756f9d68714a03bf52aacdca01237ee83a17e091b993672"
    },
    "studio/src/video/agent-skill-long-review-plan.mjs": {
      sha256: "5c2721823d086f0ca174dc9684ceb1714e36286720304668646d11946284ea21"
    }
  };
  assert.throws(() => assertWideV004InputsChanged(unchanged), /拒绝只更换候选目录名/u);
  const changed = structuredClone(unchanged);
  changed["studio/src/video/agent-skill-long-review-root.jsx"].sha256 = "b".repeat(64);
  assert.deepEqual(
    assertWideV004InputsChanged(changed),
    ["studio/src/video/agent-skill-long-review-root.jsx"]
  );
});

test("v001-v003 候选与全部正式 preview 核心文件都在保护表中", () => {
  const ids = new Set(PROTECTED_WIDE_V004_BASELINES.map((item) => item.id));
  for (const version of [1, 2, 3]) {
    const suffix = String(version).padStart(3, "0");
    assert.equal(ids.has(`review-v${suffix}-video`), true);
    assert.equal(ids.has(`review-v${suffix}-manifest`), true);
    assert.equal(ids.has(`review-v${suffix}-qa-summary`), true);
  }
  for (const version of [1, 2, 3, 4, 5]) {
    const suffix = String(version).padStart(3, "0");
    assert.equal(ids.has(`formal-preview-v${suffix}-video`), true);
    assert.equal(ids.has(`formal-preview-v${suffix}-qa`), true);
  }
  assert.equal(ids.has("episode"), true);
  assert.equal(ids.has("temporary-system-voice-v001"), true);
});

test("当前 AgentSkillLongReview 根节点已经迁移到横版，脚本使用本机 Chrome、外网阻断和原子无覆盖发布", async () => {
  const [rootSource, renderSource] = await Promise.all([
    readFile(ROOT_PATH, "utf8"),
    readFile(RENDER_PATH, "utf8")
  ]);
  assert.match(rootSource, /id="AgentSkillLongReview"/u);
  assert.match(rootSource, /width=\{1920\}/u);
  assert.match(rootSource, /height=\{1080\}/u);
  assert.match(renderSource, /\/Applications\/Google Chrome\.app\/Contents\/MacOS\/Google Chrome/u);
  assert.equal(
    (renderSource.match(/chromeMode: "chrome-for-testing"/gu) ?? []).length,
    3,
    "selectComposition、renderMedia 与 manifest 必须都固定 chrome-for-testing"
  );
  assert.match(renderSource, /onBrowserDownload: denyBrowserDownload/u);
  assert.match(renderSource, /onDownload: localOnlyAssetDownloadTracker/u);
  assert.match(renderSource, /overwrite: false/u);
  assert.match(renderSource, /await link\(temporaryPath, finalPath\)/u);
  assert.match(renderSource, /flag: "wx"/u);
  assert.doesNotMatch(renderSource, /writeFile\([^\n]*episode\.json/u);
});
