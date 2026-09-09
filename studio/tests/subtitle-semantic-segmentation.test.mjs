import test from "node:test";
import assert from "node:assert/strict";
import { splitSubtitleText } from "../src/server/production/generator.mjs";
import { subtitleBoundaryIssues } from "../src/server/production/quality.mjs";
import {
  semanticSubtitleBoundaryReasons,
  splitSubtitleTextSemantically,
  subtitleBoundaryReasons
} from "../src/server/production/subtitle-segmentation.mjs";

function asTimedSubtitles(texts) {
  return texts.map((text, index) => ({
    text,
    start: index,
    end: index + 1
  }));
}

test("语义边界门禁识别被、Skill 与依赖补足词之间的坏断句", () => {
  const cases = [
    [
      "这些外部能力以统一方式被 ",
      "Agent 发现和调用。",
      ["incomplete-left-phrase"]
    ],
    [
      "如果这些问题没有答案，Skill ",
      "只会把一次性的混乱复制得更快。",
      ["dependent-right-phrase"]
    ],
    [
      "只有这条链路成立，Skill ",
      "才是可治理的能力资产，",
      ["dependent-right-phrase"]
    ],
    ["Skill 则", "可以作为文件被版本管理", ["incomplete-left-phrase"]]
  ];

  for (const [previous, next, expectedReasons] of cases) {
    assert.deepEqual(
      semanticSubtitleBoundaryReasons(previous, next),
      expectedReasons
    );
    const qualityIssues = subtitleBoundaryIssues(
      asTimedSubtitles([previous, next])
    );
    assert.equal(qualityIssues.length, 1);
    for (const reason of expectedReasons) {
      assert.ok(qualityIssues[0].reasons.includes(reason));
    }
  }
});

test("自然逗号子句边界不会被语义门禁误报", () => {
  assert.deepEqual(
    semanticSubtitleBoundaryReasons(
      "才是可治理的能力资产，",
      "而不是更隐蔽的自动化黑箱。"
    ),
    []
  );
  assert.deepEqual(
    subtitleBoundaryIssues(
      asTimedSubtitles([
        "才是可治理的能力资产，",
        "而不是更隐蔽的自动化黑箱。"
      ])
    ),
    []
  );
  assert.deepEqual(
    semanticSubtitleBoundaryReasons(
      "步骤和注意事项贴进对话时，",
      "问题已经不只是提示词写得够不够长，"
    ),
    []
  );
  assert.deepEqual(
    semanticSubtitleBoundaryReasons(
      "下一次任务开始时，",
      "这些经验仍散落在聊天记录里，"
    ),
    []
  );
  assert.deepEqual(
    semanticSubtitleBoundaryReasons(
      "看到可检查的结果后再扩大使用；出现问题时，",
      "系统能把明确意见交回同一个产出 Agent 修订，"
    ),
    ["incomplete-punctuated-left-phrase"]
  );
});

test("英文和混排字幕保留空格边界，不把相邻完整单词误判成拆词", () => {
  assert.deepEqual(subtitleBoundaryReasons("OpenAI ", "API"), []);
  assert.deepEqual(subtitleBoundaryReasons("OpenAI", " API"), []);
  assert.ok(subtitleBoundaryReasons("Open", "AI").includes("word-split"));
  for (const [source, maximumCharacters] of [
    ["OpenAI API", 7],
    ["Check input. Verify result.", 14],
    ["示例 OpenAI API 调用。", 10]
  ]) {
    const chunks = splitSubtitleTextSemantically(source, maximumCharacters);
    assert.equal(chunks.join(""), source);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => Array.from(chunk).length <= maximumCharacters));
    assert.deepEqual(subtitleBoundaryIssues(asTimedSubtitles(chunks)), []);
    for (let index = 1; index < chunks.length; index += 1) {
      assert.deepEqual(subtitleBoundaryReasons(chunks[index - 1], chunks[index]), []);
    }
  }
});

test("共享分段器优先保留完整语义短语而不是追逐固定字数", () => {
  const cases = [
    ["这些外部能力以统一方式被 Agent 发现和调用。", 15],
    ["如果这些问题没有答案，Skill 只会把一次性的混乱复制得更快。", 15],
    ["只有这条链路成立，Skill 才是可治理的能力资产，而不是更隐蔽的自动化黑箱。", 15]
  ];
  for (const [source, maximumCharacters] of cases) {
    const chunks = splitSubtitleTextSemantically(source, maximumCharacters);
    assert.equal(chunks.join(""), source);
    assert.ok(
      chunks.every((chunk) => Array.from(chunk).length <= maximumCharacters)
    );
    assert.deepEqual(subtitleBoundaryIssues(asTimedSubtitles(chunks)), []);
  }
});

test("production generator 的公开 splitSubtitleText 使用共享语义分段器", () => {
  const source =
    "如果这些问题没有答案，Skill 只会把一次性的混乱复制得更快。";
  const expected = splitSubtitleTextSemantically(source, 15);
  assert.deepEqual(splitSubtitleText(source, 15), expected);
  assert.ok(expected.every((chunk) => Array.from(chunk).length <= 15));
  assert.deepEqual(subtitleBoundaryIssues(asTimedSubtitles(expected)), []);
});

test("允许边界列表会被严格遵守并继续无损还原文本", () => {
  const source = "先核对指标定义，再检查异常。";
  const boundary = source.indexOf("再检查");
  const chunks = splitSubtitleTextSemantically(source, 12, {
    allowedBoundaries: [boundary]
  });
  assert.equal(chunks.join(""), source);
  for (let index = 0, offset = 0; index < chunks.length - 1; index += 1) {
    offset += chunks[index].length;
    assert.equal(offset, boundary);
  }
});

test("被强制的前导闭合标点与尾部开启标点边界永不放宽", () => {
  const leadingPunctuation = "前半句，后半句";
  assert.throws(
    () => splitSubtitleTextSemantically(leadingPunctuation, 5, {
      allowedBoundaries: [leadingPunctuation.indexOf("，")],
      allowSemanticViolations: true
    }),
    /无法在允许边界内完整分段/u
  );

  const trailingOpening = "说明（内容）";
  assert.throws(
    () => splitSubtitleTextSemantically(trailingOpening, 4, {
      allowedBoundaries: [trailingOpening.indexOf("（") + 1],
      allowSemanticViolations: true
    }),
    /无法在允许边界内完整分段/u
  );
});

test("可注入 chunkFits 会用真实视觉失败反馈重做全局分段", () => {
  const source =
    "在这个任务中，Skill 规定先核对指标定义、再检查异常、最后按固定结构写结论；" +
    "数据库查询或文档写入 Tool 负责执行具体动作；" +
    "MCP 则让这些外部能力以统一方式被 Agent 发现和调用。";
  const rejected =
    "数据库查询或文档写入 Tool 负责执行具体动作；" +
    "MCP 则让这些外部能力以统一方式被 Agent 发现和调用。";
  const chunks = splitSubtitleTextSemantically(source, 32, {
    maximumLines: 2,
    chunkFits: (chunk) => chunk !== rejected
  });

  assert.deepEqual(chunks, [
    "在这个任务中，Skill 规定先核对指标定义、再检查异常、最后按固定结构写结论；",
    "数据库查询或文档写入 Tool 负责执行具体动作；",
    "MCP 则让这些外部能力以统一方式被 Agent 发现和调用。"
  ]);
  assert.deepEqual(subtitleBoundaryIssues(asTimedSubtitles(chunks)), []);
});
