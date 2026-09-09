import test from "node:test";
import assert from "node:assert/strict";
import { readFixtureEpisode } from "./episode-fixture.mjs";
import {
  evaluateProductionQuality,
  subtitleBoundaryIssues,
  subtitleDurationIssues,
  SUBTITLE_QA_MAXIMUM_CUE_DURATION_SECONDS
} from "../src/server/production/quality.mjs";

test("旧黄金样例的6–7秒字幕在新节奏合同下必须过期", async () => {
  const episode = await readFixtureEpisode();
  const quality = evaluateProductionQuality(episode, { stage: "qa" });
  assert.equal(quality.passed, false);
  assert.equal(
    quality.checks.find((item) => item.id === "subtitle-max-duration").passed,
    false
  );
  assert.ok(quality.warnings.some((warning) => warning.includes("旁白")));
});

test("字幕非法时间值不能绕过连续时间轴门禁", async () => {
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, null, "0"]) {
    const episode = structuredClone(await readFixtureEpisode());
    episode.subtitles[0].start = invalid;
    const quality = evaluateProductionQuality(episode, {stage: "qa"});
    assert.equal(quality.checks.find((item) => item.id === "subtitle-timeline").passed, false);
    assert.equal(quality.passed, false);
  }
});

test("字幕断层和未绑定证据素材会阻止最终 QA", async () => {
  const episode = structuredClone(await readFixtureEpisode());
  episode.subtitles[1].start += 2;
  episode.scenes.find((scene) => scene.type === "evidence").asset = null;
  const quality = evaluateProductionQuality(episode, { stage: "qa" });
  assert.equal(quality.passed, false);
  assert.equal(quality.checks.find((item) => item.id === "subtitle-timeline").passed, false);
  assert.equal(quality.checks.find((item) => item.id === "evidence-assets").passed, false);
});

test("固定字符数把字幕切在词语中间时必须退回 Storyboard Agent", async () => {
  const episode = structuredClone(await readFixtureEpisode());
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
  const episode = structuredClone(await readFixtureEpisode());
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

test("字幕节奏的5.5秒边界通过但超过0.1毫秒即退回", async () => {
  assert.equal(SUBTITLE_QA_MAXIMUM_CUE_DURATION_SECONDS, 5.5);
  assert.deepEqual(
    subtitleDurationIssues([
      {text: "5.5秒合同边界", start: 0, end: 5.5},
      {text: "提前显示过长后文", start: 6, end: 11.5001}
    ]),
    [{index: 1, durationSeconds: 5.5001, reasons: ["too-long"]}]
  );

  const episode = structuredClone(await readFixtureEpisode());
  episode.subtitles[0].end = episode.subtitles[0].start + 5.5001;
  const quality = evaluateProductionQuality(episode, {stage: "qa"});
  const maximumDuration = quality.checks.find(
    (item) => item.id === "subtitle-max-duration"
  );
  assert.equal(maximumDuration.passed, false);
  assert.equal(maximumDuration.severity, "error");
  assert.equal(maximumDuration.ownerAgentId, "storyboard-agent");
});

test("伪造 sourceText 不能掩盖实际错误字幕", async () => {
  const episode = structuredClone(await readFixtureEpisode());
  episode.subtitles = Array.from({length: 9}, (_, index) => ({
    text: index % 2 === 0 ? "资料被" : "，忽略原文",
    sourceText: index === 8 ? "工具执行任务。" : "模型读取资料，",
    start: index * 4,
    end: (index + 1) * 4
  }));
  episode.production.scriptDraft.content = {
    hook: "",
    sections: [{
      narration: episode.subtitles.map((cue) => cue.sourceText).join(""),
      evidenceRefs: ["source-1"]
    }],
    closing: ""
  };
  const quality = evaluateProductionQuality(episode, {stage: "storyboard"});
  assert.equal(quality.passed, false);
  assert.equal(quality.checks.find((item) => item.id === "subtitle-source-integrity").passed, false);
});

test("rolling 累计显示不重复计入语义边界和脚本覆盖率", async () => {
  const rolling = [
    {
      text: "前一完整语义，",
      sourceText: "前一完整语义，",
      start: 0,
      end: 1
    },
    {
      text: "前一完整语义，后一完整语义。",
      sourceText: "后一完整语义。",
      start: 1,
      end: 2
    }
  ];
  assert.deepEqual(subtitleBoundaryIssues(rolling), []);

  const episode = structuredClone(await readFixtureEpisode());
  episode.render = {...episode.render, durationSeconds: 2};
  episode.production.scriptDraft.content = {
    hook: "",
    sections: [{narration: "甲乙丙丁", evidenceRefs: ["source-1"]}],
    closing: ""
  };
  episode.subtitles = [
    {text: "甲乙", sourceText: "甲乙", start: 0, end: 1},
    {text: "甲乙丙丁", sourceText: "丙丁", start: 1, end: 2}
  ];
  const rollingQuality = evaluateProductionQuality(episode, {
    stage: "storyboard"
  });
  const rollingCoverage = rollingQuality.checks.find(
    (item) => item.id === "storyboard-script-coverage"
  );
  assert.equal(rollingCoverage.actual, 1);
  assert.equal(rollingCoverage.passed, true);
  assert.equal(
    rollingQuality.checks.find((item) => item.id === "subtitle-source-integrity").passed,
    true
  );
  assert.equal(
    rollingQuality.checks.find((item) => item.id === "subtitle-rate").actual,
    4
  );

  episode.subtitles = [
    {text: "甲乙", start: 0, end: 1},
    {text: "丙丁", start: 1, end: 2}
  ];
  const ordinaryQuality = evaluateProductionQuality(episode, {
    stage: "storyboard"
  });
  const ordinaryCoverage = ordinaryQuality.checks.find(
    (item) => item.id === "storyboard-script-coverage"
  );
  assert.equal(ordinaryCoverage.actual, 1);
  assert.equal(ordinaryCoverage.passed, true);
});

test("结构完整但旁白量不足的十分钟脚本不能通过机器审核", async () => {
  const episode = structuredClone(await readFixtureEpisode());
  episode.productionProfile = {
    id: "long-form-explainer-v1",
    targetDurationSeconds: 600
  };
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
  const episode = structuredClone(await readFixtureEpisode());
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
  const episode = structuredClone(await readFixtureEpisode());
  episode.productionProfile = {
    id: "long-form-explainer-v1",
    targetDurationSeconds: 600
  };
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
  const episode = structuredClone(await readFixtureEpisode());
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
