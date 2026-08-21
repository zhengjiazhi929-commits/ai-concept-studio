import test from "node:test";
import assert from "node:assert/strict";
import { readEpisode } from "../src/shared/store.mjs";
import { evaluateProductionQuality } from "../src/server/production/quality.mjs";

test("黄金样例通过内容质量门槛，并明确标记无旁白预览", async () => {
  const episode = await readEpisode("golden-001");
  const quality = evaluateProductionQuality(episode, { stage: "qa" });
  assert.equal(quality.passed, true);
  assert.ok(quality.score >= 90);
  assert.ok(quality.warnings.some((warning) => warning.includes("旁白")));
});

test("字幕断层和未绑定证据素材会阻止最终 QA", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  episode.subtitles[1].start += 2;
  episode.scenes.find((scene) => scene.type === "evidence").asset = null;
  const quality = evaluateProductionQuality(episode, { stage: "qa" });
  assert.equal(quality.passed, false);
  assert.equal(quality.checks.find((item) => item.id === "subtitle-timeline").passed, false);
  assert.equal(quality.checks.find((item) => item.id === "evidence-assets").passed, false);
});

test("固定字符数把字幕切在词语中间时必须退回 Storyboard Agent", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  episode.subtitles[0].text = "Agent Skil";
  episode.subtitles[1].text = "l 可以反复调用";
  const quality = evaluateProductionQuality(episode, { stage: "qa" });
  const boundaries = quality.checks.find((item) => item.id === "subtitle-boundaries");
  assert.equal(boundaries.passed, false);
  assert.equal(boundaries.ownerAgentId, "storyboard-agent");
  assert.ok(boundaries.actual >= 1);
  assert.equal(quality.passed, false);
});

test("过短尾句和字幕开头空格必须退回 Storyboard Agent", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  const first = episode.subtitles[0];
  const second = episode.subtitles[1];
  const originalBoundary = first.end;
  first.end = first.start + 0.4;
  second.start = first.end;
  second.text = ` ${second.text}`;
  episode.subtitles[2].start = second.end;
  assert.ok(originalBoundary > first.end);
  const quality = evaluateProductionQuality(episode, { stage: "storyboard" });
  assert.equal(quality.checks.find((item) => item.id === "subtitle-min-duration").passed, false);
  assert.equal(quality.checks.find((item) => item.id === "subtitle-leading-whitespace").passed, false);
  assert.equal(
    quality.checks.find((item) => item.id === "subtitle-min-duration").ownerAgentId,
    "storyboard-agent"
  );
});

test("结构完整但旁白量不足的十分钟脚本不能通过机器审核", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  const sections = Array.from({ length: 6 }, (_, index) => ({
    id: `S${String(index + 1).padStart(2, "0")}`,
    heading: `章节 ${index + 1}`,
    purpose: "验证时长",
    narration: "这是一段有来源但明显过短的旁白。",
    evidenceRefs: ["source-1"],
    visualDirection: "测试画面"
  }));
  episode.production.scriptDraft = {
    ...(episode.production.scriptDraft ?? {}),
    version: 1,
    artifactPath: "studio/data/production/episodes/golden-001/script-draft-v001.json",
    content: {
      title: "时长密度测试",
      thesis: episode.thesis,
      targetDurationSeconds: 600,
      hook: "这是开场。",
      sections,
      closing: "这是结尾。",
      factCheckNotes: []
    }
  };

  const tooShort = evaluateProductionQuality(episode, { stage: "script" });
  assert.equal(tooShort.checks.find((item) => item.id === "script-section-count").passed, true);
  assert.equal(tooShort.checks.find((item) => item.id === "script-evidence-refs").passed, true);
  assert.equal(tooShort.checks.find((item) => item.id === "script-narration-density").passed, false);
  assert.equal(tooShort.passed, false);

  for (const item of episode.production.scriptDraft.content.sections) {
    item.narration = "有证据的完整旁白".repeat(35);
  }
  const sufficient = evaluateProductionQuality(episode, { stage: "script" });
  assert.equal(sufficient.checks.find((item) => item.id === "script-narration-density").passed, true);
  assert.equal(sufficient.passed, true);
  assert.ok(sufficient.metrics.scriptNarrationCharacters >= 1500);
});

test("结构化脚本每一节都必须绑定研究证据", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  episode.production.scriptDraft = {
    ...(episode.production.scriptDraft ?? {}),
    version: 1,
    artifactPath: "studio/data/production/episodes/golden-001/script-draft-v001.json",
    content: {
      targetDurationSeconds: 600,
      hook: "有证据的完整旁白".repeat(10),
      sections: Array.from({ length: 6 }, (_, index) => ({
        narration: "有证据的完整旁白".repeat(34),
        evidenceRefs: index === 4 ? [] : ["source-1"]
      })),
      closing: "有证据的完整旁白".repeat(10)
    }
  };
  const quality = evaluateProductionQuality(episode, { stage: "script" });
  const check = quality.checks.find((item) => item.id === "script-evidence-refs");
  assert.equal(check.passed, false);
  assert.equal(check.actual, 5);
  assert.equal(check.expected, 6);
});

test("生成分镜必须达到场景规模并覆盖已批准脚本内容", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  episode.production.scriptDraft = {
    version: 2,
    artifactPath: "studio/data/production/episodes/golden-001/script-draft-v002.json",
    content: {
      targetDurationSeconds: 600,
      hook: "已批准脚本内容".repeat(10),
      sections: Array.from({ length: 6 }, () => ({
        narration: "已批准脚本内容".repeat(40),
        evidenceRefs: ["source-1"]
      })),
      closing: "已批准脚本内容".repeat(10)
    }
  };
  episode.production.storyboardDraft = {
    version: 2,
    artifactPath: "studio/data/production/episodes/golden-001/storyboard-draft-v002.json"
  };
  const quality = evaluateProductionQuality(episode, { stage: "storyboard" });
  assert.equal(quality.checks.find((item) => item.id === "scene-count").passed, false);
  const coverage = quality.checks.find((item) => item.id === "storyboard-script-coverage");
  assert.equal(coverage.passed, false);
  assert.ok(coverage.actual < 0.75);
});

test("正式旁白缺少可验证时长时不能通过素材总审", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  episode.previewMode = "production";
  episode.voice = {
    ...episode.voice,
    status: "ready",
    audioPath: "studio/public/episodes/golden-001/voice.wav",
    durationSeconds: null
  };
  const quality = evaluateProductionQuality(episode, { stage: "voice" });
  assert.equal(quality.checks.find((item) => item.id === "voice-duration").passed, false);
  assert.equal(quality.passed, false);
});
