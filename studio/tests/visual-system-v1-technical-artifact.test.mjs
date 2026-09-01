import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { studioRoot } from "../src/shared/paths.mjs";
import {
  TECHNICAL_ARTIFACT_PROFILE_KINDS,
  TECHNICAL_ARTIFACT_PROFILE_POLICY,
  defineTechnicalArtifactProfile,
  technicalArtifactLayout,
  technicalArtifactRailStartX,
  technicalArtifactZoneProgress,
  validateTechnicalArtifactProfile
} from "../src/shared/technical-artifact-profile.mjs";

const COMPONENT_PATH = resolve(
  studioRoot,
  "src",
  "video",
  "components",
  "visual-system-v1",
  "technical-artifact.jsx"
);

function profile(overrides = {}) {
  return defineTechnicalArtifactProfile({
    kind: "bounded-resource-artifact",
    semanticPurpose: "把真实语义节点组织为稳定技术工件",
    zones: [
      { id: "input", label: "输入", anchorNodeIds: ["a", "b"] },
      { id: "result", label: "结果", anchorNodeIds: ["c"] }
    ],
    ...overrides
  });
}

test("技术工件 profile 限制为四种语义结构并拒绝装饰性或未绑定配置", () => {
  assert.deepEqual(TECHNICAL_ARTIFACT_PROFILE_KINDS, [
    "bounded-resource-artifact",
    "layered-runtime-map",
    "decision-field",
    "evidence-lifecycle-ledger"
  ]);
  assert.equal(TECHNICAL_ARTIFACT_PROFILE_POLICY.decorativeIconsAllowed, false);
  assert.equal(TECHNICAL_ARTIFACT_PROFILE_POLICY.revealMode, "anchor-bound");
  assert.throws(() => profile({ kind: "decorative-dashboard" }), /未知技术工件类型/u);
  assert.throws(
    () => profile({ minimumSafeWidthRatio: 0.59 }),
    /宽度覆盖率不足/u
  );
  assert.throws(
    () => profile({ minimumSafeHeightRatio: 0.44 }),
    /高度覆盖率不足/u
  );
  assert.throws(
    () => profile({
      zones: [
        { id: "input", label: "输入", anchorNodeIds: ["a"] },
        { id: "result", label: "结果", anchorNodeIds: ["a"] }
      ]
    }),
    /同一节点只能归属一个/u
  );
  const review = validateTechnicalArtifactProfile(profile(), new Set(["a", "b"]));
  assert.equal(review.valid, false);
  assert.deepEqual(review.issues, ["unknown-anchor:c"]);
});

test("技术工件使用稳定节点几何铺满安全区，区名只跟随所属节点揭示", () => {
  const artifactProfile = profile();
  const safeArea = {
    left: 120,
    top: 340,
    width: 1520,
    height: 460
  };
  const geometryById = {
    a: { left: 300, top: 360, right: 650, bottom: 470, width: 350, height: 110, centerX: 475, centerY: 415 },
    b: { left: 700, top: 360, right: 1050, bottom: 470, width: 350, height: 110, centerX: 875, centerY: 415 },
    c: { left: 700, top: 640, right: 1050, bottom: 750, width: 350, height: 110, centerX: 875, centerY: 695 }
  };
  const layout = technicalArtifactLayout({
    profile: artifactProfile,
    safeArea,
    geometryById
  });
  assert.equal(layout.bounds.meetsCoverage, true);
  assert.equal(layout.bounds.safeWidthRatio >= 0.6, true);
  assert.equal(layout.bounds.safeHeightRatio >= 0.45, true);
  assert.deepEqual(layout.rowDividers, [215]);
  assert.equal(technicalArtifactZoneProgress(artifactProfile.zones[0], { a: 0, b: 0 }), 0);
  assert.equal(technicalArtifactZoneProgress(artifactProfile.zones[0], { a: 0.4, b: 0 }), 0.4);
  assert.equal(technicalArtifactZoneProgress(artifactProfile.zones[1], { c: 1 }), 1);
});

test("生命周期轨道为区名保留固定避让带", () => {
  const zone = {
    anchors: [
      { centerX: 120 },
      { centerX: 420 }
    ]
  };
  const labelBounds = { left: 12, width: 150 };
  const railStart = technicalArtifactRailStartX(zone, labelBounds);
  assert.equal(railStart, 186);
  assert.ok(railStart >= labelBounds.left + labelBounds.width + 24);
});

test("技术工件组件无场景硬编码、图标堆叠或 CSS 时间轴，并由逐帧 progress 驱动", async () => {
  const source = await readFile(COMPONENT_PATH, "utf8");
  assert.match(source, /data-technical-artifact-profile=\{profile\.kind\}/u);
  assert.match(source, /opacity:\s*contentOpacity/u);
  assert.match(source, /const zoneProgresses = profile\.zones\.map/u);
  assert.match(source, /opacity=\{zoneProgresses\[index\]\}/u);
  assert.match(source, /technicalArtifactZoneProgress/u);
  assert.match(source, /technicalArtifactRailStartX/u);
  assert.match(source, /geometryById/u);
  assert.doesNotMatch(source, /\bS(?:08|10|12|14)\b|sceneId|spec\.id/u);
  assert.doesNotMatch(source, /AiTechIcon|<img\b|<Img\b|emoji/u);
  assert.doesNotMatch(source, /M 34 24 H 94|M 34 36 H 72/u);
  assert.doesNotMatch(source, /transition:\s*|animation(?:Name)?:|@keyframes|setTimeout|Math\.random/u);
});
