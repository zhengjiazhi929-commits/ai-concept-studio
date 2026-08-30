import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  VISUAL_EXPRESSION_REVIEW_CANDIDATE_STYLE_PROFILE_ID,
  VISUAL_EXPRESSION_STYLE_PROFILE_ID,
  createVisualExpressionIntent,
  resolveVisualExpressionPlan
} from "../src/shared/visual-expression-contract.mjs";
import {
  PRODUCTION_SEMANTIC_PREVIEW_STYLE_PROFILE_ID,
  isProductionSemanticScene,
  productionSemanticPrimitiveFamily,
  productionSemanticRelationLabelRequired,
  resolveProductionSemanticPreview
} from "../src/video/production-semantic-preview.mjs";

function visualIntent({ informationNeed = "sequence", directed = true } = {}) {
  const comparison = informationNeed === "comparison";
  return createVisualExpressionIntent({
    question: comparison ? "两个方案有什么区别？" : "三个阶段按什么顺序发生？",
    takeaway: comparison ? "两个方案各有明确边界。" : "先准备，再执行，最后验收。",
    role: "explanation",
    objective: comparison ? "compare" : "explain",
    informationNeed,
    contribution: comparison ? "show-difference" : "show-order",
    contributionRationale: comparison
      ? "删掉对比结构后，两个方案会被误读成一个连续流程。"
      : "删掉流程结构后，三个阶段会被误读成没有先后的并列名词。",
    relationKind: comparison ? "comparison" : "sequence",
    compositionProfile: "text-first",
    claims: [{
      id: "claim-main",
      text: comparison ? "两个方案不同" : "三个阶段有顺序",
      visualRequired: true,
      evidenceRefs: []
    }],
    entities: [
      {
        id: "first",
        label: comparison ? "方案一" : "准备",
        semanticRole: comparison ? "concept" : "step",
        importance: "primary",
        claimIds: ["claim-main"]
      },
      {
        id: "second",
        label: comparison ? "方案二" : "执行",
        semanticRole: comparison ? "concept" : "result",
        importance: "primary",
        claimIds: ["claim-main"]
      }
    ],
    relations: [{
      id: "first-second",
      from: "first",
      to: "second",
      type: comparison ? "compares" : "then",
      label: comparison ? "区别" : "然后",
      directed,
      claimIds: ["claim-main"]
    }],
    evidenceRefs: [],
    mustNotShow: ["装饰元素"]
  });
}

function semanticScene(options = {}) {
  const intent = visualIntent(options);
  return {
    id: options.id ?? "semantic-scene",
    title: "先建立结论",
    statement: "再用结构解释信息关系。",
    subtitle: "字幕最后进入既定层级。",
    visualIntent: intent,
    visualPlan: resolveVisualExpressionPlan({
      sceneId: options.id ?? "semantic-scene",
      visualIntent: intent
    })
  };
}

test("GenericEpisodePreview 的真实 540x960 画布直接驱动 grammar 布局", () => {
  const state = resolveProductionSemanticPreview({
    scene: semanticScene(),
    frame: 60,
    width: 540,
    height: 960
  });
  assert.deepEqual(state.viewport, { width: 540, height: 960 });
  assert.deepEqual(state.layout.safeArea, {
    x: 33.75,
    y: 302.2222,
    left: 33.75,
    top: 302.2222,
    width: 427.5,
    height: 408.8889,
    right: 461.25,
    bottom: 711.1111,
    centerX: 247.5,
    centerY: 506.6667
  });
  assert.equal(state.styleProfileId, "desktop-light-window-editorial-v3");
  assert.equal(PRODUCTION_SEMANTIC_PREVIEW_STYLE_PROFILE_ID, VISUAL_EXPRESSION_STYLE_PROFILE_ID);
});

test("标题先出现，辅助文案、图形、细节和字幕严格读取 visualPlan.timing", () => {
  const scene = semanticScene();
  const timing = scene.visualPlan.timing;
  const beforeSupporting = resolveProductionSemanticPreview({
    scene,
    frame: timing.supportingCopyStartFrame - 1,
    width: 540,
    height: 960
  });
  assert.ok(beforeSupporting.visibility.headline > 0);
  assert.equal(beforeSupporting.visibility.supportingCopy, 0);
  assert.equal(beforeSupporting.visibility.graphic, 0);
  assert.equal(beforeSupporting.visibility.detailCopy, 0);
  assert.equal(beforeSupporting.visibility.subtitle, 0);

  const beforeGraphic = resolveProductionSemanticPreview({
    scene,
    frame: timing.graphicStartFrame - 1,
    width: 540,
    height: 960
  });
  assert.ok(beforeGraphic.visibility.supportingCopy > 0);
  assert.ok(beforeGraphic.visibility.subtitle > 0);
  assert.equal(beforeGraphic.visibility.graphic, 0);
  assert.equal(beforeGraphic.visibility.detailCopy, 0);

  const afterDetail = resolveProductionSemanticPreview({
    scene,
    frame: timing.detailCopyStartFrame + 8,
    width: 540,
    height: 960
  });
  assert.equal(afterDetail.visibility.headline, 1);
  assert.equal(afterDetail.visibility.supportingCopy, 1);
  assert.equal(afterDetail.visibility.graphic, 1);
  assert.equal(afterDetail.visibility.detailCopy, 1);
  assert.equal(afterDetail.visibility.subtitle, 1);
});

test("箭头只由 directed 关系生成", () => {
  const directedState = resolveProductionSemanticPreview({
    scene: semanticScene({ informationNeed: "sequence", directed: true }),
    frame: 60,
    width: 540,
    height: 960
  });
  assert.equal(directedState.connectors.length, 1);
  assert.equal(directedState.connectors[0].directed, true);
  assert.equal(directedState.connectors[0].arrowhead, true);
  assert.equal(directedState.connectors[0].showLabel, false);

  const undirectedState = resolveProductionSemanticPreview({
    scene: semanticScene({ informationNeed: "comparison", directed: false }),
    frame: 60,
    width: 540,
    height: 960
  });
  assert.equal(undirectedState.connectors.length, 1);
  assert.equal(undirectedState.connectors[0].directed, false);
  assert.equal(undirectedState.connectors[0].arrowhead, false);
  assert.equal(undirectedState.connectors[0].showLabel, true);
  assert.equal(productionSemanticRelationLabelRequired("branches-to"), true);
  assert.equal(productionSemanticRelationLabelRequired("contains"), true);
  assert.equal(productionSemanticRelationLabelRequired("association"), false);
  assert.equal(productionSemanticRelationLabelRequired("then"), false);
});

test("至少八类 grammar primitive 使用不同开放式视觉原语，不回落同一 surface", async () => {
  const primitives = [
    "comparison-left",
    "flow-step",
    "hierarchy-node",
    "branch-input",
    "timeline-anchor",
    "state-after",
    "evidence-frame",
    "quantity-bar"
  ];
  const families = primitives.map(productionSemanticPrimitiveFamily);
  assert.deepEqual(families, [
    "comparison",
    "flow",
    "hierarchy",
    "branch",
    "timeline",
    "state",
    "evidence",
    "quantity"
  ]);
  assert.equal(new Set(families).size, 8);
  const rendererSource = await readFile(
    new URL("../src/video/production-semantic-preview.jsx", import.meta.url),
    "utf8"
  );
  for (const family of families) {
    assert.match(rendererSource, new RegExp(`primitiveFamily === "${family}"`, "u"));
  }
  assert.match(rendererSource, /data-primitive-family=\{primitiveFamily\}/u);
});

test("无 visualPlan 保持历史分支，候选 profile 不会进入通用生产语义预览", () => {
  assert.equal(isProductionSemanticScene({ id: "legacy", type: "title" }), false);
  const scene = semanticScene();
  assert.equal(isProductionSemanticScene(scene), true);
  const candidateScene = {
    ...scene,
    visualPlan: {
      ...scene.visualPlan,
      styleProfileId: VISUAL_EXPRESSION_REVIEW_CANDIDATE_STYLE_PROFILE_ID
    }
  };
  assert.throws(
    () => resolveProductionSemanticPreview({
      scene: candidateScene,
      frame: 60,
      width: 540,
      height: 960
    }),
    /只接受已批准风格 desktop-light-window-editorial-v3/u
  );
});

test("生产组件只消费通用语义与 grammar，且没有 CSS 动画或业务关键词特判", async () => {
  const [rendererSource, modelSource, previewSource, visualSystemSource] = await Promise.all([
    readFile(new URL("../src/video/production-semantic-preview.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/video/production-semantic-preview.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/video/episode-preview.jsx", import.meta.url), "utf8"),
    readFile(new URL("../config/visual-system.json", import.meta.url), "utf8")
  ]);
  const visualSystem = JSON.parse(visualSystemSource);
  assert.doesNotMatch(rendererSource, /Agent|Skill|Prompt|文件夹|纸张|目录插入/iu);
  assert.doesNotMatch(modelSource, /Agent|Skill|Prompt|文件夹|纸张|目录插入/iu);
  assert.doesNotMatch(rendererSource, /\banimation\b|\btransition\b/iu);
  assert.doesNotMatch(rendererSource, /#[0-9a-f]{6}\b|rgba\(/iu);
  assert.equal(visualSystem.id, PRODUCTION_SEMANTIC_PREVIEW_STYLE_PROFILE_ID);
  assert.equal(visualSystem.id, "desktop-light-window-editorial-v3");
  assert.match(rendererSource, /approvedVisualSystem\.colors\.activeBlue/u);
  assert.match(rendererSource, /approvedVisualSystem\.window\.shadow/u);
  assert.match(rendererSource, /approvedVisualSystem\.subtitle\.textShadow/u);
  assert.doesNotMatch(rendererSource, /fontSize: 16|fontSize: 17|Math\.max\(22|Math\.max\(23/u);
  assert.match(modelSource, /visualSystemV1GrammarLayout/u);
  assert.match(rendererSource, /markerEnd=\{connector\.arrowhead \?/u);
  assert.match(rendererSource, /!connector\.showLabel \|\| !connector\.label/u);
  assert.match(previewSource, /const semanticScene = isProductionSemanticScene\(scene\)/u);
  assert.match(previewSource, /!semanticScene/u);
  assert.match(previewSource, /scene\.type === "title"/u);
  assert.match(previewSource, /scene\.type === "evidence"/u);
  assert.match(previewSource, /scene\.type === "statement"/u);
  assert.match(previewSource, /scene\.type === "summary"/u);
  assert.match(previewSource, /<GenericEpisodePreview episode=\{episode\} \/>/u);
  assert.ok(
    previewSource.indexOf("episode.scenes?.some") <
      previewSource.indexOf('episode.id === "agent-skill-20260806"'),
    "带 visualPlan 的场景必须先于特殊 Episode ID 路由"
  );
});
