import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  resegmentTimeline,
  resegmentTimelineWithVisualFits,
  writeJsonNoReplace
} from "../scripts/resegment-agent-skill-v004c-subtitles.mjs";
import { SUBTITLE_SEMANTIC_SEGMENTATION_VERSION, subtitleBoundaryReasons } from
  "../src/server/production/subtitle-segmentation.mjs";

const REGRESSION_TEXTS = Object.freeze({
  2: "当团队反复把同一套背景、步骤和注意事项贴进对话时，问题已经不只是提示词写得够不够长，而是过程知识没有形成可发现、可复用、可维护的工作单元。",
  6: "下一次任务开始时，这些经验仍散落在聊天记录里，没人确定该复制哪一版。",
  9: "Agent Skill 是可被 Agent 发现并按任务需要加载的过程知识包。",
  35: "在这个任务中，Skill 规定先核对指标定义、再检查异常、最后按固定结构写结论；数据库查询或文档写入 Tool 负责执行具体动作；MCP 则让这些外部能力以统一方式被 Agent 发现和调用。",
  53: "如果这些问题没有答案，Skill 只会把一次性的混乱复制得更快。",
  55: "用户还要理解边界，在受控范围内试运行，看到可检查的结果后再扩大使用；出现问题时，系统能把明确意见交回同一个产出 Agent 修订，并保留每次版本和审核记录。",
  56: "机器审核负责挡住结构、证据和安全问题，最终是否采用仍由人决定。",
  57: "只有这条链路成立，Skill 才是可治理的能力资产，而不是更隐蔽的自动化黑箱。"
});

// Synthetic, deterministic marker times exercise the frozen 58-segment shape.
// They are test inputs, not evidence of production speech or historical QA.
function sourceTimeline() {
  const sampleRate = 48_000;
  const samplesPerCharacter = 9_600;
  const displayCues = [];
  let nextStartSample = 0;
  const speechSegments = Array.from({length: 58}, (_, position) => {
    const index = position + 1;
    const text = REGRESSION_TEXTS[index] ?? "先检查输入，再核对结果。";
    const startSample = nextStartSample;
    const endSampleExclusive = startSample + text.length * samplesPerCharacter;
    nextStartSample = endSampleExclusive + sampleRate;
    const markers = Array.from(text, (character, characterIndex) => ({
      index: characterIndex + 1,
      text: character,
      textLocation: characterIndex,
      textLength: 1,
      targetFrame: characterIndex * samplesPerCharacter
    }));
    const displayCueIndexes = markers.map((marker) => {
      const cueIndex = displayCues.length + 1;
      displayCues.push({index: cueIndex, text: marker.text, legacy: true});
      return cueIndex;
    });
    return {
      index,
      sceneId: `S${String(Math.min(18, Math.ceil(index / 4))).padStart(2, "0")}`,
      text,
      speechText: text,
      startSample,
      endSampleExclusive,
      startFrame: startSample * 30 / sampleRate,
      endFrameExclusive: endSampleExclusive * 30 / sampleRate,
      markers,
      displayCueIndexes
    };
  });
  assert.ok(nextStartSample < 600 * sampleRate);
  return {
    schemaVersion: "synthetic-subtitle-regression-fixture-v1",
    fps: 30,
    sampleRate,
    durationInFrames: 18_000,
    durationSeconds: 600,
    durationInSamples: 600 * sampleRate,
    acceptedPrefix: {displayCueCount: 24},
    speechSegments,
    displayCues
  };
}

function cuesForSegment(timeline, segmentIndex) {
  return timeline.displayCues.filter(
    (cue) => cue.speechSegmentIndex === segmentIndex
  );
}

function sourceTextsForSegment(timeline, segmentIndex) {
  return cuesForSegment(timeline, segmentIndex).map((cue) => cue.sourceText);
}

test("v004c 从58个合成 speechSegments 全量重建语义字幕且不复用旧24条", async () => {
  const source = await sourceTimeline();
  const output = resegmentTimeline(source, {
    maximumCharacters: 32,
    sourceTimelineSha256: createHash("sha256").update(JSON.stringify(source)).digest("hex")
  });

  assert.equal(output.schemaVersion, "agent-skill-subtitle-timeline-v004c-semantic-v7");
  assert.equal(
    output.semanticSegmentation.contractVersion,
    SUBTITLE_SEMANTIC_SEGMENTATION_VERSION
  );
  assert.equal(output.acceptedPrefix.reused, false);
  assert.equal(output.semanticSegmentation.acceptedPrefixCuePngsReused, false);
  assert.equal(output.semanticSegmentation.audioChanged, false);
  assert.equal(output.semanticSegmentation.speechTimingChanged, false);
  assert.equal(output.semanticSegmentation.minimumCueDurationSeconds, 0.75);
  assert.equal(output.semanticSegmentation.preferredCueDurationSeconds, 4.5);
  assert.equal(output.semanticSegmentation.maximumCueDurationSeconds, 5.5);
  assert.equal(output.semanticSegmentation.rollingCarryForUnpunctuatedBoundaries, true);
  assert.equal(output.semanticSegmentation.rollingCarryDisplayAnchor, "group-source-start");
  assert.equal(
    output.semanticSegmentation.rollingCarryDisplaysOnlyPreviouslySpokenPrefix,
    true
  );
  assert.equal(output.semanticSegmentation.sourceTextIsLosslessAndNonRepeated, true);
  assert.ok(output.semanticSegmentation.rollingCarryCueCount > 0);
  assert.ok(output.semanticSegmentation.rollingGroupCount > 0);
  assert.equal(output.semanticSegmentation.cueDurationTimingEnforcedAtMarkers, true);
  assert.equal(output.speechSegments.length, 58);
  assert.ok(output.displayCues.length >= 58);
  assert.ok(output.displayCues.length < source.displayCues.length);

  for (const [position, sourceSegment] of source.speechSegments.entries()) {
    const outputSegment = output.speechSegments[position];
    const cues = cuesForSegment(output, sourceSegment.index);
    assert.equal(cues.map((cue) => cue.sourceText).join(""), sourceSegment.text);
    assert.equal(outputSegment.startSample, sourceSegment.startSample);
    assert.equal(outputSegment.endSampleExclusive, sourceSegment.endSampleExclusive);
    assert.deepEqual(outputSegment.markers, sourceSegment.markers);
    assert.deepEqual(
      outputSegment.displayCueIndexes,
      cues.map((cue) => cue.index)
    );
    for (const cue of cues) {
      assert.equal(
        cue.sourceText,
        sourceSegment.text.slice(
          cue.sourceCharacterStart,
          cue.sourceCharacterEnd
        )
      );
      assert.equal(
        cue.text,
        sourceSegment.text.slice(
          cue.displayContextStart,
          cue.sourceCharacterEnd
        )
      );
      assert.equal(cue.displayContextEnd, cue.sourceCharacterEnd);
      assert.ok(cue.displayContextStart <= cue.sourceCharacterStart);
      assert.equal(
        cue.rollingCarryApplied,
        cue.displayContextStart < cue.sourceCharacterStart
      );
    }
    for (let index = 0; index < cues.length - 1; index += 1) {
      assert.deepEqual(
        subtitleBoundaryReasons(
          cues[index].sourceText,
          cues[index + 1].sourceText
        ),
        []
      );
      assert.equal(cues[index].endSampleExclusive, cues[index + 1].startSample);
    }
  }
});

test("v004c 合成 marker 夹具阻断已知依赖短语断句且不提前展示整段长句", async () => {
  const source = sourceTimeline();
  const output = resegmentTimeline(source, {
    maximumCharacters: 32
  });

  for (const [segmentIndex, text] of Object.entries(REGRESSION_TEXTS)) {
    assert.equal(sourceTextsForSegment(output, Number(segmentIndex)).join(""), text);
  }
  for (const [segmentIndex, phrase, leftPart] of [
    [35, "被 Agent", "被 "],
    [53, "Skill 只会", "Skill "],
    [57, "Skill 才是", "Skill "]
  ]) {
    const text = REGRESSION_TEXTS[segmentIndex];
    const forbiddenOffset = text.indexOf(phrase) + leftPart.length;
    assert.ok(forbiddenOffset > leftPart.length);
    assert.ok(cuesForSegment(output, segmentIndex).every(
      (cue) => cue.sourceCharacterEnd !== forbiddenOffset
    ));
  }

  for (const cue of output.displayCues) {
    const duration =
      (cue.endSampleExclusive - cue.startSample) / output.sampleRate;
    assert.ok(duration >= 0.75, `cue ${cue.index} 过短: ${duration}`);
    assert.ok(duration <= 5.5, `cue ${cue.index} 过长: ${duration}`);
  }

  const groups = Map.groupBy(
    output.displayCues.filter((cue) => cue.rollingGroup),
    (cue) => cue.rollingGroup.id
  );
  assert.ok(groups.size > 0);
  for (const groupCues of groups.values()) {
    assert.ok(groupCues.length > 1);
    assert.deepEqual(
      groupCues.map((cue) => cue.rollingGroup.cueOrdinal),
      groupCues.map((_cue, index) => index + 1)
    );
    assert.equal(groupCues[0].rollingCarryApplied, false);
    assert.equal(groupCues[1].rollingCarryApplied, true);
    assert.equal(groupCues[0].rollingGroup.id, groupCues[1].rollingGroup.id);
    assert.equal(groupCues[0].rollingGroup.cueCount, groupCues.length);
    assert.equal(
      groupCues[0].rollingGroup.displayAnchor,
      "group-source-start"
    );
    assert.equal(
      groupCues[0].rollingGroup.finalText,
      groupCues.at(-1).text
    );
    assert.notEqual(groupCues[0].text, groupCues[0].rollingGroup.finalText);
    assert.equal(
      groupCues[1].text.slice(0, groupCues[1].sourceCharacterStart -
        groupCues[1].displayContextStart),
      groupCues[0].sourceText
    );
  }
});

test("v004c 视觉反馈与 marker 时长门禁组合后仍全量覆盖58句", async () => {
  const output = await resegmentTimelineWithVisualFits(
    await sourceTimeline(),
    {
      maximumCharacters: 32,
      allowUnverifiedMeasurementTestDouble: true,
      measureChunks: async (texts) => texts.map((text) => ({
        text,
        fits: true,
        lines: [text],
        contract: {
          insideCaptionSafeArea: true,
          containerLikeAlpha: false,
          borderAlphaMax: 0,
          nearFullWidthAlphaRows: 0,
          alphaCoverageRatio: 0.12
        }
      }))
    }
  );

  assert.equal(output.speechSegments.length, 58);
  assert.equal(output.semanticSegmentation.visualFit.verified, false);
  assert.equal(output.semanticSegmentation.visualFit.publicationEligible, false);
  assert.equal(
    output.semanticSegmentation.visualFit.measurementProvenance,
    "injected-test-double"
  );
  assert.equal(output.semanticSegmentation.visualFit.testDouble, true);
  assert.deepEqual(output.semanticSegmentation.visualFit.renderer, {
    type: "injected-test-double",
    functionName: "measureChunks"
  });
  assert.equal(output.semanticSegmentation.visualFit.allSelectedChunksFit, true);
  assert.equal(output.semanticSegmentation.visualFit.maximumLines, 2);
  assert.equal(output.semanticSegmentation.visualFit.maximumCueDurationSeconds, 5.5);
  assert.ok(
    output.semanticSegmentation.visualFit.maximumActualCueDurationSeconds <= 5.5
  );
  assert.equal(
    output.semanticSegmentation.visualFit.selectedCueCount,
    output.displayCues.length
  );
});

test("v004c 注入 measureChunks 未显式声明 test double 时失败关闭", async () => {
  const source = await sourceTimeline();
  await assert.rejects(
    () => resegmentTimelineWithVisualFits(source, {
      maximumCharacters: 32,
      measureChunks: async (texts) => texts.map((text) => ({
        text,
        fits: true
      }))
    }),
    /不能冒充真实视觉验证/u
  );
});

test("v004c 正式测量身份拒绝伪造 builder、python 与 renderer metadata", async () => {
  const source = await sourceTimeline();
  for (const forgedOptions of [
    {measureOptions: {builderPath: "/tmp/forged-builder.py"}},
    {measureOptions: {pythonPath: "/tmp/forged-python"}},
    {rendererIdentity: {builderPath: "/forged/not-used.py"}}
  ]) {
    await assert.rejects(
      () => resegmentTimelineWithVisualFits(source, {
        maximumCharacters: 32,
        ...forgedOptions
      }),
      /不得覆盖固定的正式字幕测量身份/u
    );
  }
});

test("v004c 即使 test double 声称 fits 也必须提供完整视觉证据", async () => {
  const source = await sourceTimeline();
  const validContract = {
    insideCaptionSafeArea: true,
    containerLikeAlpha: false,
    borderAlphaMax: 0,
    nearFullWidthAlphaRows: 0,
    alphaCoverageRatio: 0.12
  };
  const invalidMeasurements = [
    {lines: [], contract: validContract},
    {lines: ["测试"], contract: {...validContract, insideCaptionSafeArea: false}},
    {lines: ["测试"], contract: {...validContract, containerLikeAlpha: true}},
    {lines: ["测试"], contract: {...validContract, borderAlphaMax: 1}}
  ];
  for (const invalid of invalidMeasurements) {
    await assert.rejects(
      () => resegmentTimelineWithVisualFits(source, {
        maximumCharacters: 32,
        allowUnverifiedMeasurementTestDouble: true,
        measureChunks: async (texts) => texts.map((text) => ({
          text,
          fits: true,
          ...invalid
        }))
      }),
      /fits=true 缺少完整两行、安全区或无容器 alpha 证据/u
    );
  }
});

test("v004c cue 仍严格绑定原 marker、场景、帧与样本范围", async () => {
  const source = await sourceTimeline();
  const output = resegmentTimeline(source, {maximumCharacters: 32});
  const markerTimesBySegment = new Map(
    source.speechSegments.map((segment) => [
      segment.index,
      new Set([
        segment.startSample,
        segment.endSampleExclusive,
        ...segment.markers.map(
          (marker) => segment.startSample + marker.targetFrame
        )
      ])
    ])
  );

  for (const cue of output.displayCues) {
    assert.equal(
      markerTimesBySegment.get(cue.speechSegmentIndex).has(cue.startSample),
      true
    );
    assert.equal(
      markerTimesBySegment.get(cue.speechSegmentIndex).has(cue.endSampleExclusive),
      true
    );
    assert.equal(cue.startFrame, Math.ceil(cue.startSample * 30 / 48_000 - 1e-12));
    assert.equal(
      cue.endFrameExclusive,
      Math.ceil(cue.endSampleExclusive * 30 / 48_000 - 1e-12)
    );
    assert.equal(cue.sceneId, output.speechSegments[cue.speechSegmentIndex - 1].sceneId);
    assert.ok(cue.endFrameExclusive > cue.startFrame);
  }
});

test("v004c 显式发布 Python 不可用时失败关闭，不回退本机运行时", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v004c-subtitle-runtime-"));
  const moduleUrl = new URL("../scripts/resegment-agent-skill-v004c-subtitles.mjs", import.meta.url).href;
  const output = resolve(root, "timeline.json");
  const missingPython = resolve(root, "missing-python");
  try {
    const code = `import {writeJsonNoReplace} from ${JSON.stringify(moduleUrl)}; await writeJsonNoReplace(${JSON.stringify(output)}, {fixture: true});`;
    await assert.rejects(
      () => promisify(execFile)(process.execPath, ["--input-type=module", "-e", code], {
        env: {...process.env, QA_PYTHON: missingPython}
      }),
      (error) => error.code === 1 && error.stderr.includes(missingPython)
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("v004c 时间线通过同目录临时文件原子发布并同步为只读", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v004c-subtitle-resegment-"));
  const path = resolve(root, "timeline.json");
  try {
    const result = await writeJsonNoReplace(path, {version: 1});
    assert.match(result.sha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {version: 1});
    assert.equal((await lstat(path)).mode & 0o777, 0o444);
    assert.deepEqual(await readdir(root), ["timeline.json"]);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("v004c 时间线已有目标时原子发布拒绝覆盖并清理本次临时文件", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v004c-subtitle-resegment-"));
  const path = resolve(root, "timeline.json");
  try {
    await writeJsonNoReplace(path, {version: 1});
    await assert.rejects(
      () => writeJsonNoReplace(path, {version: 2}),
      /拒绝覆盖既有 v004c 时间线/u
    );
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {version: 1});
    assert.deepEqual(await readdir(root), ["timeline.json"]);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("v004c 时间线发布前崩溃只清理本次 sibling temp 且不留目标占位", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v004c-subtitle-resegment-"));
  const path = resolve(root, "timeline.json");
  try {
    await assert.rejects(
      () => writeJsonNoReplace(path, {version: 1}, {
        testOnlyBeforePublish: async ({targetPath, temporaryPath}) => {
          assert.equal(targetPath, path);
          const temporaryDetails = await lstat(temporaryPath);
          assert.equal(temporaryDetails.isFile(), true);
          assert.equal(temporaryDetails.mode & 0o777, 0o444);
          throw new Error("模拟 publish 前崩溃");
        }
      }),
      /模拟 publish 前崩溃/u
    );
    await assert.rejects(() => readFile(path), {code: "ENOENT"});
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("v004c 上次进程崩溃遗留的 sibling temp 不阻断续跑也不会被误删", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v004c-subtitle-resegment-"));
  const path = resolve(root, "timeline.json");
  const staleTemporaryPath = resolve(
    root,
    ".timeline.json.part-previous-crash"
  );
  try {
    await writeFile(staleTemporaryPath, "{\"partial\":", {flag: "wx"});
    await writeJsonNoReplace(path, {version: 1});
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {version: 1});
    assert.equal(await readFile(staleTemporaryPath, "utf8"), "{\"partial\":");
    assert.deepEqual((await readdir(root)).sort(), [
      ".timeline.json.part-previous-crash",
      "timeline.json"
    ]);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
