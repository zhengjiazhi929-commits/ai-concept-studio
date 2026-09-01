import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  VISUAL_SYSTEM_V1,
  VISUAL_SYSTEM_V1_FONT_WEIGHTS
} from "../src/video/components/visual-system-v1/tokens.mjs";
import {
  visualSystemV1TypographyToken
} from "../src/video/components/visual-system-v1/resolver.mjs";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");
const normalizeWhitespace = (value) => value.replace(/\s+/gu, " ").trim();
const fontWeightExpressions = (renderedSource) => [...renderedSource.matchAll(
  /fontWeight\s*:\s*([^,}]+)/gu
)].map((match) => normalizeWhitespace(match[1])).sort();

const EXPECTED_FONT_WEIGHTS = Object.freeze({
  display: 760,
  primaryLabel: 680,
  sectionLabel: 600,
  subtitle: 600,
  technicalLabel: 600,
  supporting: 520,
  explanatory: 520,
  detail: 500,
  navigation: 500
});

test("Noto 长片字重按用途集中为五档九类语义角色", () => {
  assert.deepEqual(VISUAL_SYSTEM_V1_FONT_WEIGHTS, EXPECTED_FONT_WEIGHTS);
  assert.equal(VISUAL_SYSTEM_V1.typography.fontWeights, VISUAL_SYSTEM_V1_FONT_WEIGHTS);
  assert.ok(VISUAL_SYSTEM_V1_FONT_WEIGHTS.display > VISUAL_SYSTEM_V1_FONT_WEIGHTS.primaryLabel);
  assert.ok(VISUAL_SYSTEM_V1_FONT_WEIGHTS.primaryLabel > VISUAL_SYSTEM_V1_FONT_WEIGHTS.sectionLabel);
  assert.ok(VISUAL_SYSTEM_V1_FONT_WEIGHTS.sectionLabel > VISUAL_SYSTEM_V1_FONT_WEIGHTS.supporting);
  assert.ok(VISUAL_SYSTEM_V1_FONT_WEIGHTS.supporting > VISUAL_SYSTEM_V1_FONT_WEIGHTS.detail);
  for (const weight of Object.values(VISUAL_SYSTEM_V1_FONT_WEIGHTS)) {
    assert.ok(Number.isInteger(weight));
    assert.ok(weight >= 100 && weight <= 900);
  }
  assert.equal(VISUAL_SYSTEM_V1.semanticNode.standard.detailFontWeight, 500);
  assert.equal(VISUAL_SYSTEM_V1.semanticNode.longformEmphasis.detailFontWeight, 500);
});

test("resolver 与正式渲染组件消费同一套字重 token", async () => {
  assert.equal(visualSystemV1TypographyToken("headline").fontWeight, 760);
  assert.equal(visualSystemV1TypographyToken("supporting").fontWeight, 520);
  assert.equal(visualSystemV1TypographyToken("stage-title").fontWeight, 600);
  assert.equal(visualSystemV1TypographyToken("node-label").fontWeight, 680);
  assert.equal(visualSystemV1TypographyToken("node-detail").fontWeight, 500);
  assert.equal(visualSystemV1TypographyToken("caption").fontWeight, 500);
  assert.equal(visualSystemV1TypographyToken("evidence-label").fontWeight, 600);

  const sourceContracts = [
    {
      path: "../src/video/agent-skill-long-review.jsx",
      expected: [
        "typography.fontWeights.display",
        "typography.fontWeights.explanatory",
        "typography.fontWeights.sectionLabel",
        "typography.fontWeights.sectionLabel",
        "typography.fontWeights.supporting"
      ]
    },
    {
      path: "../src/video/components/visual-system-v1/components.jsx",
      expected: [
        "semanticIconNode ? typography.fontWeights.primaryLabel : typography.fontWeights.sectionLabel",
        "semanticTypography.detailFontWeight",
        "typography.fontWeights.detail",
        "typography.fontWeights.detail",
        "typography.fontWeights.detail",
        "typography.fontWeights.navigation",
        "typography.fontWeights.primaryLabel",
        "typography.fontWeights.primaryLabel",
        "typography.fontWeights.primaryLabel",
        "typography.fontWeights.sectionLabel",
        "typography.fontWeights.sectionLabel",
        "typography.fontWeights.sectionLabel",
        "typography.fontWeights.sectionLabel",
        "typography.fontWeights.sectionLabel",
        "typography.fontWeights.subtitle"
      ]
    },
    {
      path: "../src/video/components/visual-system-v1/technical-artifact.jsx",
      expected: ["typography.fontWeights.technicalLabel"]
    },
    {
      path: "../src/video/components/visual-system-v1/resolver.mjs",
      expected: [
        "VISUAL_SYSTEM_V1.typography.fontWeights.detail",
        "VISUAL_SYSTEM_V1.typography.fontWeights.detail",
        "VISUAL_SYSTEM_V1.typography.fontWeights.display",
        "VISUAL_SYSTEM_V1.typography.fontWeights.primaryLabel",
        "VISUAL_SYSTEM_V1.typography.fontWeights.sectionLabel",
        "VISUAL_SYSTEM_V1.typography.fontWeights.supporting",
        "VISUAL_SYSTEM_V1.typography.fontWeights.technicalLabel"
      ]
    }
  ];
  for (const contract of sourceContracts) {
    const renderedSource = await source(contract.path);
    assert.deepEqual(
      fontWeightExpressions(renderedSource),
      [...contract.expected].sort(),
      `${contract.path} 只能引用已批准的集中字重 token，禁止数字、字符串或局部变量绕过`
    );
  }
});

test("字重修订不改变所有正式文本角色的字号、行高、字距与换行合同", async () => {
  const [longReview, components, technicalArtifact] = await Promise.all([
    source("../src/video/agent-skill-long-review.jsx"),
    source("../src/video/components/visual-system-v1/components.jsx"),
    source("../src/video/components/visual-system-v1/technical-artifact.jsx")
  ]);

  assert.match(longReview, /fontSize: titleFontSize\(title\)/u);
  assert.match(longReview, /letterSpacing: "-\.045em"/u);
  assert.match(longReview, /fontSize: typography\.supportingWidePx/u);
  assert.match(longReview, /lineHeight: 1\.34/u);
  assert.match(longReview, /whiteSpace: "nowrap"/u);
  assert.match(longReview, /fontSize: 28[\s\S]*?lineHeight: 1\.25[\s\S]*?letterSpacing: "-\.015em"/u);
  assert.match(longReview, /fontSize: SHAPE_GRAMMAR_LEGEND_FONT_SIZE_PX[\s\S]*?letterSpacing: "\.01em"/u);

  assert.match(components, /fontSize: labelFontSize/u);
  assert.match(components, /fontSize: detailFontSize/u);
  assert.match(components, /letterSpacing: `\$\{semanticTypography\.labelLetterSpacingPx\}px`/u);
  assert.match(components, /whiteSpace: informationCard \? "nowrap" : undefined/u);
  assert.match(components, /visualSystemV1SubtitleFontSize\(layout, visualWeight\)/u);
  assert.match(components, /lineHeight: typography\.subtitleLineHeight/u);
  assert.match(components, /WebkitLineClamp: typography\.subtitleMaximumLines/u);
  assert.match(components, /fontSize: layout\.vertical \? 13 : 17[\s\S]*?lineHeight: "22px"[\s\S]*?whiteSpace: "nowrap"/u);
  assert.match(components, /data-ai-tech-icon-caption="standalone-label"[\s\S]*?whiteSpace: "nowrap"/u);
  assert.match(components, /fontSize: 30[\s\S]*?letterSpacing: "-\.03em"/u);

  assert.match(technicalArtifact, /fontSize: 18/u);
  assert.match(technicalArtifact, /lineHeight: "28px"/u);
  assert.match(technicalArtifact, /letterSpacing: "\.04em"/u);
  assert.match(technicalArtifact, /whiteSpace: "nowrap"/u);
});
