import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { studioRoot } from "../src/shared/paths.mjs";
import { VISUAL_SYSTEM_V1_AI_WATERMARK } from "../src/video/components/visual-system-v1/ai-watermark.mjs";

const BRAND_LAYER_PATH = resolve(
  studioRoot,
  "src",
  "video",
  "components",
  "visual-system-v1",
  "brand-layer.jsx"
);
const LONG_REVIEW_PATH = resolve(studioRoot, "src", "video", "agent-skill-long-review.jsx");

test("横版品牌层只挂载一个不可覆盖尺寸的标准AI水印", async () => {
  const source = await readFile(BRAND_LAYER_PATH, "utf8");

  assert.deepEqual(VISUAL_SYSTEM_V1_AI_WATERMARK.placement, {
    size: 120,
    top: 40,
    right: 40,
    zIndex: 6
  });
  assert.equal(
    VISUAL_SYSTEM_V1_AI_WATERMARK.defaultProfileId,
    "approved-v013-stable-footprint"
  );
  assert.match(source, /export function VisualSystemV1WideBrandLayer\(\{/u);
  assert.match(source, /profile = VISUAL_SYSTEM_V1_AI_WATERMARK\.defaultProfileId/u);
  assert.match(
    source,
    /defaultWatermarkProfileId: VISUAL_SYSTEM_V1_AI_WATERMARK\.defaultProfileId/u
  );
  assert.match(
    source,
    /watermarkProfilePolicy: "approved-v013-default-v012-explicit-legacy-fallback"/u
  );
  assert.equal((source.match(/<VisualSystemV1AiWatermark\b/gu) ?? []).length, 1);
  assert.match(source, /<VisualSystemV1AiWatermark profile=\{profile\} \/>/u);
  assert.doesNotMatch(
    source,
    /<VisualSystemV1AiWatermark\b[^>]*(?:size|top|right|zIndex)=/u
  );
  assert.match(source, /data-brand-watermark-profile=\{profile\}/u);
  assert.match(source, /instancePolicy: "exactly-one-per-composition"/u);
  assert.match(source, /data-brand-layer-instance-policy="exactly-one-per-composition"/u);
  assert.match(source, /data-visual-system-brand-layer="wide-persistent-ai-watermark"/u);
});

test("品牌层声明可检测的右上角200px安全区并排除内容角色", async () => {
  const source = await readFile(BRAND_LAYER_PATH, "utf8");

  assert.match(source, /id: "top-right-brand-exclusion-zone"/u);
  assert.match(source, /const safeZonePadding = 40/u);
  assert.match(source, /const safeZoneSize = placement\.size \+ safeZonePadding \* 2/u);
  assert.match(source, /canvas: Object\.freeze\(\{ width: 1920, height: 1080 \}\)/u);
  for (const role of ["title", "body-copy", "caption", "diagram", "connector"]) {
    assert.match(source, new RegExp(`"${role}"`, "u"));
  }
  for (const attribute of ["left", "top", "width", "height"]) {
    assert.match(source, new RegExp(`data-brand-safe-zone-${attribute}=`, "u"));
  }
  assert.match(source, /data-brand-safe-zone-content-policy="reserved-no-content"/u);
});

test("十分钟横版成片通过统一品牌层挂载且不再保留40px特例", async () => {
  const source = await readFile(LONG_REVIEW_PATH, "utf8");

  assert.match(source, /import \{ VisualSystemV1WideBrandLayer \} from "\.\/components\/visual-system-v1\/brand-layer\.jsx";/u);
  assert.equal((source.match(/<VisualSystemV1WideBrandLayer\b/gu) ?? []).length, 1);
  assert.doesNotMatch(source, /<VisualSystemV1AiWatermark\b/u);
  assert.doesNotMatch(source, /size=\{40\}|top=\{18\}|right=\{18\}/u);
  assert.ok(
    source.indexOf("<VisualSystemV1WideBrandLayer") >
      source.indexOf('data-visual-system-content="open-canvas"')
  );
  assert.ok(
    source.indexOf("<VisualSystemV1WideBrandLayer") <
      source.indexOf("<VisualSystemV1PlainSubtitle")
  );
});
