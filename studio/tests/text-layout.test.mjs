import test from "node:test";
import assert from "node:assert/strict";
import { phraseWrapChunks } from "../src/video/text-layout.mjs";

test("中文正文只在短词组之间换行，不拆分常见复合词", () => {
  const source = "三层加载动画：元数据、说明、按需资源";
  const chunks = phraseWrapChunks(source);
  assert.equal(chunks.join(""), source);
  assert.equal(chunks.includes("元数据、"), true);
  assert.equal(chunks.includes("按需资源"), true);
});

test("长结论保留能力单元、过程知识和按需加载词组", () => {
  const source = "Agent Skill 的价值不是让提示词变长，而是把稳定、可验收的过程知识变成可发现、按需加载且可治理的能力单元。";
  const chunks = phraseWrapChunks(source);
  assert.equal(chunks.join(""), source);
  assert.equal(chunks.includes("过程知识"), true);
  assert.equal(chunks.includes("按需加载"), true);
  assert.equal(chunks.includes("能力单元。"), true);
});

test("显式换行被保留为独立边界", () => {
  assert.deepEqual(phraseWrapChunks("第一行\n第二行"), ["第一行", "\n", "第二行"]);
});
