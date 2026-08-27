import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AI_TECH_ICON_COLOR_ROLES,
  AI_TECH_ICON_CONCEPT_KINDS,
  AI_TECH_ICON_POLICY,
  AI_TECH_ICON_REGISTRY_VERSION
} from "../src/shared/ai-tech-icon-contract.mjs";
import { AI_TECH_ICON_GEOMETRY } from "../src/video/components/visual-system-v1/icons/geometry.mjs";
import {
  AI_TECH_ICON_CATEGORIES,
  AI_TECH_ICON_REGISTRY,
  aiTechIconDefinition,
  aiTechIconDefinitionById,
  aiTechIconIdForConcept,
  aiTechIconTokenRolesForState
} from "../src/video/components/visual-system-v1/icons/registry.mjs";

const componentSource = await readFile(
  new URL("../src/video/components/visual-system-v1/icons/ai-tech-icon.jsx", import.meta.url),
  "utf8"
);
const geometrySource = await readFile(
  new URL("../src/video/components/visual-system-v1/icons/geometry.mjs", import.meta.url),
  "utf8"
);
const registrySource = await readFile(
  new URL("../src/video/components/visual-system-v1/icons/registry.mjs", import.meta.url),
  "utf8"
);
const indexSource = await readFile(
  new URL("../src/video/components/visual-system-v1/icons/index.jsx", import.meta.url),
  "utf8"
);

const EXPECTED_MAPPING = Object.freeze({
  prompt: "prompt-bubble",
  document: "document-sheet",
  image: "image-frame",
  audio: "audio-wave",
  video: "video-player",
  "table-data": "table-grid",
  database: "database-stack",
  "knowledge-base": "knowledge-books",
  "search-retrieval": "retrieval-search",
  "vector-embedding": "vector-points",
  "context-window": "context-window",
  memory: "memory-chip",
  "ai-model": "model-layers",
  agent: "agent-node",
  tool: "tool-wrench",
  api: "api-brackets",
  mcp: "mcp-bridge",
  workflow: "workflow-nodes",
  routing: "routing-branch",
  "parallel-execution": "parallel-lanes",
  retry: "retry-cycle",
  "verified-success": "verified-status-mark",
  warning: "warning-triangle",
  failure: "failure-cross",
  "human-approval": "human-approval-gate",
  permission: "permission-lock",
  "audit-log": "audit-clipboard",
  "version-history": "version-history"
});

test("28个 conceptKind 一一稳定映射到唯一 canonicalIconId", () => {
  assert.equal(AI_TECH_ICON_REGISTRY.length, 28);
  assert.equal(Object.keys(AI_TECH_ICON_GEOMETRY).length, 27);
  assert.deepEqual(AI_TECH_ICON_CONCEPT_KINDS, Object.keys(EXPECTED_MAPPING));
  assert.equal(new Set(AI_TECH_ICON_REGISTRY.map((definition) => definition.canonicalIconId)).size, 28);
  for (const [conceptKind, canonicalIconId] of Object.entries(EXPECTED_MAPPING)) {
    const definition = aiTechIconDefinition(conceptKind);
    assert.equal(definition.canonicalIconId, canonicalIconId);
    assert.equal(aiTechIconIdForConcept(conceptKind), canonicalIconId);
    assert.equal(aiTechIconDefinitionById(canonicalIconId), definition);
    assert.equal(definition.registryVersion, AI_TECH_ICON_REGISTRY_VERSION);
    assert.equal(definition.status, "approved-production-v1");
    assert.equal(definition.approval.approvedBy, "Zhengjiazhi");
    assert.equal(definition.approval.sourceCandidate, "ai-tech-icon-system-review-v002");
    if (definition.renderKind === "geometry") {
      assert.equal(definition.sourceType, "original-local-vector");
      assert.equal(definition.geometry, AI_TECH_ICON_GEOMETRY[canonicalIconId]);
    } else {
      assert.equal(definition.renderKind, "status-mark");
      assert.equal(definition.sourceType, "shared-visual-system-status-component");
      assert.equal(definition.geometry, null);
    }
    assert.ok(definition.allowedStateRoles.includes(definition.defaultStateRole));
  }
  assert.equal(aiTechIconDefinition("none", { allowNone: true }), null);
  assert.equal(aiTechIconIdForConcept("none", { allowNone: true }), null);
  assert.throws(() => aiTechIconDefinition("random-icon"), /未知 AI 技术图标语义/u);
});

test("注册项属于受控分类，语义说明不为空且状态颜色使用 visual-system token", () => {
  const categoryIds = new Set(AI_TECH_ICON_CATEGORIES.map((category) => category.id));
  for (const definition of AI_TECH_ICON_REGISTRY) {
    assert.equal(categoryIds.has(definition.category), true, definition.conceptKind);
    assert.ok(definition.labelZh.length > 0, definition.conceptKind);
    assert.ok(definition.labelEn.length > 0, definition.conceptKind);
    assert.ok(definition.contribution.length >= 8, definition.conceptKind);
    assert.equal(definition.viewBox, "0 0 64 64");
    for (const colorRole of Object.values(definition.tokenRoles)) {
      assert.ok(AI_TECH_ICON_COLOR_ROLES.includes(colorRole), `${definition.conceptKind}:${colorRole}`);
    }
  }
  assert.deepEqual(aiTechIconTokenRolesForState("success"), {
    primary: "state-success",
    secondary: "state-success",
    surface: "surface"
  });
  assert.deepEqual(aiTechIconTokenRolesForState("human"), {
    primary: "accent-secondary",
    secondary: "text-primary",
    surface: "surface"
  });
  assert.deepEqual(aiTechIconDefinition("prompt").allowedStateRoles, ["neutral", "active"]);
  assert.deepEqual(aiTechIconDefinition("verified-success").allowedStateRoles, ["success"]);
});

test("所有几何统一64视窗、简约原语预算和受控颜色槽", () => {
  const allowedTypes = new Set(["path", "line", "rect", "circle", "ellipse"]);
  const allowedSlots = new Set(["primary", "secondary", "surface"]);
  for (const [canonicalIconId, definition] of Object.entries(AI_TECH_ICON_GEOMETRY)) {
    assert.equal(definition.viewBox, AI_TECH_ICON_POLICY.viewBox, canonicalIconId);
    assert.ok(
      definition.elements.length >= AI_TECH_ICON_POLICY.minimumPrimitiveCount &&
      definition.elements.length <= AI_TECH_ICON_POLICY.maximumPrimitiveCount,
      canonicalIconId
    );
    for (const element of definition.elements) {
      assert.equal(allowedTypes.has(element.type), true, `${canonicalIconId}:${element.type}`);
      assert.equal(allowedSlots.has(element.colorSlot), true, `${canonicalIconId}:${element.colorSlot}`);
      assert.equal("color" in element, false, canonicalIconId);
      assert.equal("stroke" in element, false, canonicalIconId);
      assert.equal("fillRole" in element, false, canonicalIconId);
    }
  }
  assert.doesNotMatch(geometrySource, /#[0-9a-f]{3,8}|rgba?\(/iu);
  assert.doesNotMatch(registrySource, /#[0-9a-f]{3,8}|rgba?\(/iu);
  assert.equal("success-check" in AI_TECH_ICON_GEOMETRY, false);
  assert.equal("human-gate-check" in AI_TECH_ICON_GEOMETRY, false);
});

test("Remotion组件只消费 progress 与 token，不含临时图标、emoji 或浏览器计时动画", () => {
  assert.match(componentSource, /progress = 1/u);
  assert.match(componentSource, /aiTechIconMotionStateAtProgress\(progress\)/u);
  assert.match(componentSource, /visualSystemV1ColorToken/u);
  assert.match(componentSource, /data-ai-tech-icon-id/u);
  assert.match(componentSource, /data-ai-tech-icon-registry/u);
  assert.match(componentSource, /data-ai-tech-icon-settled/u);
  assert.match(componentSource, /strokeDashoffset: 1 - drawProgress/u);
  assert.match(componentSource, /VisualSystemV1StatusMark/u);
  assert.match(componentSource, /data-ai-tech-icon-status-mark-variant/u);
  assert.match(componentSource, /definition\.renderKind === "status-mark"/u);
  assert.doesNotMatch(componentSource, /✓|✔|✕|✖|⚠|🤖|🧠|🔒/u);
  assert.doesNotMatch(componentSource, /Math\.random|requestAnimationFrame|setInterval|setTimeout/u);
  assert.doesNotMatch(componentSource, /\banimation\s*:|\btransition\s*:/u);
  assert.doesNotMatch(componentSource, /#[0-9a-f]{3,8}|rgba?\(/iu);
  assert.doesNotMatch(componentSource, /<path\s+d=/u);
});

test("独立入口导出合同、注册表、几何和唯一组件，不要求修改现有 visual-system index", () => {
  assert.match(indexSource, /VisualSystemV1AiTechIcon/u);
  assert.match(indexSource, /AI_TECH_ICON_REGISTRY/u);
  assert.match(indexSource, /AI_TECH_ICON_GEOMETRY/u);
  assert.match(indexSource, /AI_TECH_ICON_CONCEPT_KINDS/u);
  assert.match(indexSource, /aiTechIconMotionStateAtProgress/u);
});
