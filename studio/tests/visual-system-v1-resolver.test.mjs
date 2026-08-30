import assert from "node:assert/strict";
import test from "node:test";

import { createVisualExpressionIntent } from "../src/shared/visual-expression-contract.mjs";
import {
  resolveVisualSystemV1Scene,
  visualSystemV1ColorToken,
  visualSystemV1LineToken,
  visualSystemV1TypographyToken
} from "../src/video/components/visual-system-v1/resolver.mjs";

function visualIntent() {
  return createVisualExpressionIntent({
    question: "两种能力的生命周期差在哪里？",
    takeaway: "Prompt 是一次输入，Skill 是可维护能力。",
    role: "explanation",
    objective: "compare",
    informationNeed: "comparison",
    contribution: "show-difference",
    contributionRationale: "共同维度对照让观众无需在两段文字之间自行寻找差异。",
    relationKind: "comparison",
    compositionProfile: "text-first",
    claims: [{
      id: "claim-lifecycle",
      text: "Prompt 与 Skill 的生命周期不同",
      visualRequired: true,
      evidenceRefs: []
    }],
    entities: [
      { id: "prompt", label: "Prompt", semanticRole: "concept", importance: "primary", claimIds: ["claim-lifecycle"] },
      { id: "skill", label: "Skill", semanticRole: "concept", importance: "primary", claimIds: ["claim-lifecycle"] }
    ],
    relations: [{
      id: "lifecycle-comparison",
      from: "prompt",
      to: "skill",
      type: "compares",
      label: "生命周期",
      directed: false,
      claimIds: ["claim-lifecycle"]
    }],
    evidenceRefs: [],
    mustNotShow: ["人物", "流程箭头"]
  });
}

test("resolver 只把语义角色映射到统一 token，不接受场景自定义颜色和字号", () => {
  const resolved = resolveVisualSystemV1Scene({ id: "S07", visualIntent: visualIntent() });
  assert.equal(resolved.visualPlan.structure, "comparison");
  assert.equal(resolved.styleProfileId, "visual-system-v1");
  assert.equal(resolved.shapeLanguage, "flat-geometric-2d");
  assert.equal(resolved.depthMode, "flat-only");
  assert.equal(resolved.colors["accent-primary"].tokenName, "mint");
  assert.equal(resolved.colors["accent-secondary"].tokenName, "purple");
  assert.ok(visualSystemV1TypographyToken("node-detail").fontSizePx >= 28);
  assert.equal(visualSystemV1LineToken("relationship-primary").widthPx, 3);
  assert.throws(() => visualSystemV1ColorToken("#ff0000"), /不支持颜色角色/u);
  assert.throws(() => visualSystemV1TypographyToken("scene-local-22px"), /不支持字号角色/u);
});
