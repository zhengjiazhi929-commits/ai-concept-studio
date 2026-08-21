import test from "node:test";
import assert from "node:assert/strict";
import { readEpisode } from "../src/shared/store.mjs";
import { generateStoryboardDraft } from "../src/server/production/generator.mjs";
import {
  APPROVED_SCRIPT_SHORT_STORYBOARD_ADAPTER_VERSION,
  approvedScriptNarrationText,
  SHORT_STORYBOARD_VISUAL_RULES
} from "../src/server/production/short-storyboard-adapter.mjs";

const EPISODE_ID = "agent-skill-tool-mcp-60s-20260813";
const EXPECTED_SCENE_TIMES = [
  [0, 4.782],
  [4.782, 8.708],
  [8.708, 17.402],
  [17.402, 25.443],
  [25.443, 36.745],
  [36.745, 41.526],
  [41.526, 47.395],
  [47.395, 52.828],
  [52.828, 60]
];

function compactLength(value) {
  return String(value ?? "")
    .replace(/[\s，。！？；：、“”‘’（）《》…—,.!?;:'"()\[\]{}-]/gu, "")
    .length;
}

test("确定性短分镜保留关键语义单元并满足单行字幕合同", async () => {
  const episode = structuredClone(await readEpisode(EPISODE_ID));
  let providerCalls = 0;
  const generated = await generateStoryboardDraft(episode, {
    client: {
      async generateStructured() {
        providerCalls += 1;
        throw new Error("确定性短分镜不得调用 Provider");
      }
    },
    writeArtifact: async () => ({
      version: 999,
      path: "/tmp/no-write-storyboard.json",
      relativePath: "no-write-storyboard.json"
    })
  });

  assert.equal(providerCalls, 0);
  assert.equal(
    APPROVED_SCRIPT_SHORT_STORYBOARD_ADAPTER_VERSION,
    "approved-script-short-storyboard-adapter-v4"
  );
  assert.equal(generated.model, APPROVED_SCRIPT_SHORT_STORYBOARD_ADAPTER_VERSION);
  assert.equal(generated.timeline.durationSeconds, 60);
  assert.deepEqual(
    generated.timeline.scenes.map(({ start, end }) => [start, end]),
    EXPECTED_SCENE_TIMES
  );

  const mcpScene = generated.timeline.scenes.find((scene) => scene.id === "S03");
  const mcpSubtitles = generated.timeline.subtitles
    .filter((subtitle) => subtitle.start >= mcpScene.start && subtitle.end <= mcpScene.end)
    .map((subtitle) => subtitle.text);
  assert.deepEqual(mcpSubtitles, [
    "MCP 标准化 prompts、resources 和 tools ",
    "如何被外部系统暴露和调用。"
  ]);
  assert.equal(mcpSubtitles.some((text) => /(?:和|与|及|或)\s*$/u.test(text)), false);
  assert.equal(mcpSubtitles.every((text) => !text.includes("\n")), true);
  assert.equal(mcpSubtitles.every((text) => compactLength(text) <= 28), true);

  const weeklyScene = generated.timeline.scenes.find((scene) => scene.id === "S05");
  const weeklySubtitles = generated.timeline.subtitles.filter(
    (subtitle) => subtitle.start >= weeklyScene.start && subtitle.end <= weeklyScene.end
  );
  assert.deepEqual(weeklySubtitles, [
    {
      start: 25.443,
      end: 30.442,
      text: "可以把三者放进同一个任务看：用户要求整理一份周报，"
    },
    {
      start: 30.442,
      end: 34.572,
      text: "Skill 规定先核对指标定义、再检查异常、"
    },
    {
      start: 34.572,
      end: 36.745,
      text: "最后按固定结构写结论；"
    }
  ]);
  assert.equal(generated.timeline.subtitles.length, 14);
  assert.equal(
    generated.timeline.subtitles.every((subtitle) => !subtitle.text.includes("\n")),
    true
  );
  assert.equal(
    generated.timeline.subtitles.every((subtitle) => compactLength(subtitle.text) <= 28),
    true
  );
  assert.equal(
    weeklySubtitles.some(
      (subtitle, index) => subtitle.text.endsWith("固定") &&
        weeklySubtitles[index + 1]?.text.startsWith("结构")
    ),
    false
  );
  assert.equal(
    generated.timeline.subtitles.map((subtitle) => subtitle.text).join(""),
    approvedScriptNarrationText(episode.production.scriptDraft.content)
  );
  assert.ok(
    SHORT_STORYBOARD_VISUAL_RULES.includes(
      "字幕尽量单行、小字号、贴齐左右与底部，背景透明且不得使用黑色底板。"
    )
  );
  assert.ok(
    SHORT_STORYBOARD_VISUAL_RULES.includes(
      "技术运行逻辑必须用节点和有向连线逐步推导；已出现的主路径持续保留，旁支保持中性，转场不得让主路径提前重置或单帧跳变。"
    )
  );

  const architectureScene = generated.timeline.scenes.find((scene) => scene.id === "S04");
  assert.match(
    architectureScene.assetHint,
    /Skill 规则 → Agent 判断 → MCP 调用 → 外部能力四段累计高亮/u
  );
  assert.match(architectureScene.assetHint, /每段新增节点与有向连线并持续保留前序高亮/u);
  assert.match(architectureScene.assetHint, /Tool 与 agent-invokes-tool 只作中性旁支/u);
  assert.match(architectureScene.assetHint, /随下一场景平滑交叉淡出/u);
});
