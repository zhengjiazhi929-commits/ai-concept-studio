import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AI_CUBE_FACES,
  AI_WATERMARK_TURNS,
  AI_WATERMARK_EXTRUSION_LAYERS,
  VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF,
  aiCubeFaceVisibilityAtFrame,
  aiExtrusionLayerState,
  aiWatermarkMotionAtFrame,
  referenceCssEase,
  visibleAiSolidGapAtCubeCorner,
  visualOrientationAtFrame
} from "../src/video/visual-system-v1-ai-watermark-proof-plan.mjs";
import { AI_WATERMARK_PROOF_RENDER_CONTRACT } from "../scripts/render-visual-system-v1-ai-watermark-proof.mjs";

const componentSource = await readFile(
  new URL("../src/video/visual-system-v1-ai-watermark-proof.jsx", import.meta.url),
  "utf8"
);
const mainRootSource = await readFile(
  new URL("../src/video/root.jsx", import.meta.url),
  "utf8"
);
const rendererSource = await readFile(
  new URL("../scripts/render-visual-system-v1-ai-watermark-proof.mjs", import.meta.url),
  "utf8"
);

const multiplyMatrix3 = (left, right) =>
  Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    return [0, 1, 2].reduce(
      (sum, inner) => sum + left[row * 3 + inner] * right[inner * 3 + column],
      0
    );
  });

const transposeMatrix3 = (matrix) => [
  matrix[0], matrix[3], matrix[6],
  matrix[1], matrix[4], matrix[7],
  matrix[2], matrix[5], matrix[8]
];

const rotationXMatrix = (degrees) => {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [1, 0, 0, 0, cosine, -sine, 0, sine, cosine];
};

const rotationYMatrix = (degrees) => {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [cosine, 0, sine, 0, 1, 0, -sine, 0, cosine];
};

const rotationZMatrix = (degrees) => {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [cosine, -sine, 0, sine, cosine, 0, 0, 0, 1];
};

const orientationMatrixAtFrame = (frame) => {
  const state = aiWatermarkMotionAtFrame(frame);
  return multiplyMatrix3(
    multiplyMatrix3(rotationZMatrix(state.rotateZ), rotationXMatrix(state.rotateX)),
    rotationYMatrix(state.rotateY)
  );
};

const relativeOrientationMatrixAtFrame = (frame) => {
  const baseTranspose = transposeMatrix3(orientationMatrixAtFrame(0));
  return multiplyMatrix3(baseTranspose, orientationMatrixAtFrame(frame));
};

const assertMatrixClose = (actual, expected, epsilon = 1e-10) => {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= epsilon,
      `matrix[${index}] ${actual[index]} != ${expected[index]}`
    );
  }
};

const matrixDeterminant3 = (matrix) =>
  matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7]) -
  matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6]) +
  matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6]);

const maxMatrixDistance = (left, right) =>
  Math.max(...left.map((value, index) => Math.abs(value - right[index])));

test("独立样片是640方形、30fps、四次旋转加闭合证明帧", () => {
  const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF;
  assert.equal(contract.schemaVersion, "visual-system-v1-ai-watermark-motion-proof-v12");
  assert.equal(contract.width, 640);
  assert.equal(contract.height, 640);
  assert.equal(contract.fps, 30);
  assert.equal(contract.cycleFrames, 120);
  assert.equal(contract.referenceCycleFrames, 60);
  assert.equal(contract.turnFrames, 30);
  assert.equal(contract.turnCount, 4);
  assert.equal(contract.contentFrames, 120);
  assert.equal(contract.durationInFrames, 121);
  assert.equal(contract.durationSeconds, 121 / 30);
});

test("CSS ease与参考中点一致且单调", () => {
  assert.equal(referenceCssEase(0), 0);
  assert.equal(referenceCssEase(1), 1);
  assert.ok(Math.abs(referenceCssEase(0.5) - 0.8024033876) < 1e-6);
  let previous = 0;
  for (let index = 1; index <= 100; index += 1) {
    const current = referenceCssEase(index / 100);
    assert.ok(current >= previous);
    previous = current;
  }
});

test("完整方向序列每120帧重复且首尾raw状态完全相同", () => {
  assert.deepEqual(aiWatermarkMotionAtFrame(0), aiWatermarkMotionAtFrame(120));
  for (let frame = 0; frame < 120; frame += 1) {
    assert.deepEqual(aiWatermarkMotionAtFrame(frame), aiWatermarkMotionAtFrame(frame + 120));
  }
  assert.notDeepEqual(aiWatermarkMotionAtFrame(15), aiWatermarkMotionAtFrame(75));
  assert.notDeepEqual(aiWatermarkMotionAtFrame(45), aiWatermarkMotionAtFrame(105));
});

test("四次依次为X正向、Y正向、X反向、Y反向", () => {
  assert.deepEqual(
    AI_WATERMARK_TURNS.map(({ axis, direction }) => ({ axis, direction })),
    [
      { axis: "x", direction: -1 },
      { axis: "y", direction: 1 },
      { axis: "x", direction: 1 },
      { axis: "y", direction: -1 }
    ]
  );
  assert.deepEqual(aiWatermarkMotionAtFrame(0), {
    cycleFrame: 0,
    turnIndex: 0,
    phase: "rotate-x-forward",
    axis: "x",
    direction: -1,
    linearProgress: 0,
    easedProgress: 0,
    rotateZ: 45,
    rotateX: -25,
    rotateY: 25
  });
  assert.deepEqual(aiWatermarkMotionAtFrame(30), {
    cycleFrame: 30,
    turnIndex: 1,
    phase: "rotate-y-forward",
    axis: "y",
    direction: 1,
    linearProgress: 0,
    easedProgress: 0,
    rotateZ: 45,
    rotateX: -385,
    rotateY: 25
  });
  assert.deepEqual(aiWatermarkMotionAtFrame(60), {
    cycleFrame: 60,
    turnIndex: 2,
    phase: "rotate-x-reverse",
    axis: "x",
    direction: 1,
    linearProgress: 0,
    easedProgress: 0,
    rotateZ: 45,
    rotateX: -385,
    rotateY: 385
  });
  assert.deepEqual(aiWatermarkMotionAtFrame(90), {
    cycleFrame: 90,
    turnIndex: 3,
    phase: "rotate-y-reverse",
    axis: "y",
    direction: -1,
    linearProgress: 0,
    easedProgress: 0,
    rotateZ: 45,
    rotateX: -25,
    rotateY: 385
  });

  const boundaryOrientation = visualOrientationAtFrame(0);
  for (const frame of [30, 60, 90, 120]) {
    assert.deepEqual(visualOrientationAtFrame(frame), boundaryOrientation);
  }

  const firstMidpoint = aiWatermarkMotionAtFrame(15);
  const secondMidpoint = aiWatermarkMotionAtFrame(45);
  const thirdMidpoint = aiWatermarkMotionAtFrame(75);
  const fourthMidpoint = aiWatermarkMotionAtFrame(105);
  assert.ok(
    Math.abs(
      (firstMidpoint.rotateX - VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.rotation.xStart) +
        (thirdMidpoint.rotateX - VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.rotation.xEnd)
    ) < 1e-9
  );
  assert.ok(
    Math.abs(
      (secondMidpoint.rotateY - VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.rotation.yStart) +
        (fourthMidpoint.rotateY - VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.rotation.yEnd)
    ) < 1e-9
  );
  assert.ok(aiWatermarkMotionAtFrame(16).rotateX < firstMidpoint.rotateX);
  assert.ok(aiWatermarkMotionAtFrame(46).rotateY > secondMidpoint.rotateY);
  assert.ok(aiWatermarkMotionAtFrame(76).rotateX > thirdMidpoint.rotateX);
  assert.ok(aiWatermarkMotionAtFrame(106).rotateY < fourthMidpoint.rotateY);
});

test("第三、四次的相对旋转矩阵逐帧分别是第一、二次的逆矩阵", () => {
  for (let offset = 0; offset <= 30; offset += 1) {
    assertMatrixClose(
      relativeOrientationMatrixAtFrame(60 + offset),
      transposeMatrix3(relativeOrientationMatrixAtFrame(offset))
    );
    assertMatrixClose(
      relativeOrientationMatrixAtFrame(90 + offset),
      transposeMatrix3(relativeOrientationMatrixAtFrame(30 + offset))
    );
  }

  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let frame = 0; frame <= 120; frame += 1) {
    const matrix = orientationMatrixAtFrame(frame);
    assertMatrixClose(multiplyMatrix3(transposeMatrix3(matrix), matrix), identity);
    assert.ok(Math.abs(matrixDeterminant3(matrix) - 1) <= 1e-10);
  }
  for (const frame of [30, 60, 90, 120]) {
    assertMatrixClose(orientationMatrixAtFrame(frame), orientationMatrixAtFrame(0));
  }
  assert.ok(maxMatrixDistance(orientationMatrixAtFrame(15), orientationMatrixAtFrame(75)) > 0.1);
  assert.ok(maxMatrixDistance(orientationMatrixAtFrame(45), orientationMatrixAtFrame(105)) > 0.1);
});

test("四个相位边界与首尾在离散帧上无方向跳变", () => {
  const shortestAngularDistance = (left, right) => {
    const delta = normalizeSignedDegrees(right - left);
    return Math.abs(delta);
  };
  const normalizeSignedDegrees = (value) => ((value + 180) % 360 + 360) % 360 - 180;
  const pairs = [
    [29, 30, "rotateX"],
    [59, 60, "rotateY"],
    [89, 90, "rotateX"],
    [119, 120, "rotateY"]
  ];
  for (const [leftFrame, rightFrame, key] of pairs) {
    assert.ok(
      shortestAngularDistance(
        aiWatermarkMotionAtFrame(leftFrame)[key],
        aiWatermarkMotionAtFrame(rightFrame)[key]
      ) < 1
    );
  }
});

test("每个AI实体侧面严格分为薄荷12层和紫色3层", () => {
  assert.equal(AI_WATERMARK_EXTRUSION_LAYERS.length, 15);
  assert.equal(
    AI_WATERMARK_EXTRUSION_LAYERS.filter((layer) => layer.role === "primary-mint").length,
    12
  );
  assert.equal(
    AI_WATERMARK_EXTRUSION_LAYERS.filter((layer) => layer.role === "secondary-purple").length,
    3
  );
  assert.equal(AI_WATERMARK_EXTRUSION_LAYERS[0].depthPx, -15);
  assert.equal(AI_WATERMARK_EXTRUSION_LAYERS[0].role, "primary-mint");
  assert.equal(AI_WATERMARK_EXTRUSION_LAYERS[1].role, "secondary-purple");
  assert.equal(AI_WATERMARK_EXTRUSION_LAYERS[3].role, "secondary-purple");
  assert.equal(AI_WATERMARK_EXTRUSION_LAYERS[4].role, "primary-mint");
  assert.equal(AI_WATERMARK_EXTRUSION_LAYERS.at(-1).depthPx, -1);
});

test("六个朝外AI构成镂空立方体且没有实体方板", () => {
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.faceCount, 6);
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.panelMode, "none");
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.backfaceMode, "hidden");
  assert.equal(AI_CUBE_FACES.length, 6);
  assert.equal(new Set(AI_CUBE_FACES.map((face) => face.id)).size, 6);
  assert.equal(new Set(AI_CUBE_FACES.map((face) => face.normal.join(","))).size, 6);
  assert.deepEqual(
    AI_CUBE_FACES.map((face) => face.id),
    ["front", "back", "right", "left", "top", "bottom"]
  );
  assert.match(componentSource, /data-ai-open-cube="six-extruded-ai-faces"/u);
  assert.match(componentSource, /data-ai-cube-face/u);
  assert.match(componentSource, /AI_CUBE_FACES\.map/u);
  assert.doesNotMatch(componentSource, /data-ai-cube-panel|boxGeometry|wireframe/u);
});

test("六个AI按可见字形紧贴并保留约0.5px投影缝隙", () => {
  const { cube, extrusion } = VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF;
  const gap = visibleAiSolidGapAtCubeCorner();
  assert.equal(cube.layoutMode, "near-touching");
  assert.equal(cube.halfSizePx, 91.22);
  assert.equal(cube.glyphWidthPx, 168);
  assert.ok(Math.abs(gap.visibleGlyphHalfWidthPx - 75.7826086957) < 1e-9);
  assert.ok(Math.abs(gap.axisClearancePx - 0.4373913043) < 1e-9);
  assert.ok(gap.axisClearancePx >= 0.3);
  assert.ok(gap.nearestCornerGapPx >= cube.targetVisibleSolidGapRangePx[0]);
  assert.ok(gap.nearestCornerGapPx <= cube.targetVisibleSolidGapRangePx[1]);
  assert.equal(cube.targetProjectedVisibleGapPx, 0.5);
  assert.ok(cube.halfSizePx > extrusion.depthPx);
});

test("每个面都是独立挤出的AI且背向镜头自动隐藏", () => {
  assert.match(componentSource, /data-ai-glyph-front=\{faceId\}/u);
  assert.match(componentSource, /data-ai-extrusion-layer/u);
  assert.match(componentSource, /continuousExtrusionLayers\.map/u);
  assert.match(componentSource, /translateZ\(/u);
  assert.match(componentSource, /aiExtrusionLayerState/u);
  assert.match(componentSource, /data-ai-extrusion-layers/u);
  assert.match(componentSource, /data-ai-extrusion-progress/u);
  assert.match(componentSource, /data-ai-extrusion-depth/u);
  assert.doesNotMatch(componentSource, /slice\(-faceVisibility\.extrusionLayerCount\)/u);
  assert.match(componentSource, /visibility: faceVisibility\.visible \? "visible" : "hidden"/u);
  assert.ok((componentSource.match(/backfaceVisibility: "hidden"/gu) ?? []).length >= 2);
  assert.ok((componentSource.match(/WebkitBackfaceVisibility: "hidden"/gu) ?? []).length >= 2);
  assert.match(componentSource, /useCurrentFrame/u);
  assert.doesNotMatch(
    componentSource,
    /animation\s*:|transition\s*:|@keyframes|requestAnimationFrame|Math\.random|Date\.now|spring\(/u
  );
});

test("任意帧最多显示三个朝向镜头的面且近侧视面提前隐藏", () => {
  for (let frame = 0; frame <= 120; frame += 1) {
    const visibleFaces = AI_CUBE_FACES.filter(
      (face) => aiCubeFaceVisibilityAtFrame(frame, face).visible
    );
    assert.ok(visibleFaces.length >= 1 && visibleFaces.length <= 3);
    for (const face of AI_CUBE_FACES) {
      const state = aiCubeFaceVisibilityAtFrame(frame, face);
      assert.equal(
        state.visible,
        state.facing > VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.minimumVisibleFacing
      );
      assert.ok(state.extrusionLayerCount >= 0 && state.extrusionLayerCount <= 15);
      assert.ok(state.extrusionProgress >= 0 && state.extrusionProgress <= 1);
      assert.ok(state.extrusionDepthPx >= 0 && state.extrusionDepthPx <= 15);
    }
  }
  assert.deepEqual(
    AI_CUBE_FACES.filter((face) => aiCubeFaceVisibilityAtFrame(0, face).visible).map(
      (face) => face.id
    ),
    ["front", "left", "top"]
  );
  assert.equal(aiCubeFaceVisibilityAtFrame(22, AI_CUBE_FACES[4]).visible, false);
  assert.equal(aiCubeFaceVisibilityAtFrame(52, AI_CUBE_FACES[3]).visible, false);
});

test("第三次旋转左侧AI使用连续深度，不再出现0到6层的单帧跳动", () => {
  const { cube, extrusion } = VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF;
  assert.equal(cube.extrusionTaperFacingStart, 0.1);
  assert.equal(cube.extrusionFullFacing, 0.5);
  const leftFace = AI_CUBE_FACES.find((face) => face.id === "left");
  let previous = aiCubeFaceVisibilityAtFrame(78, leftFace);
  let visibilityChanges = 0;
  for (let frame = 79; frame <= 90; frame += 1) {
    const current = aiCubeFaceVisibilityAtFrame(frame, leftFace);
    assert.ok(current.extrusionDepthPx >= previous.extrusionDepthPx);
    assert.ok(current.extrusionDepthPx - previous.extrusionDepthPx <= 2.1);
    assert.ok(current.extrusionLayerCount - previous.extrusionLayerCount <= 3);
    if (current.visible !== previous.visible) visibilityChanges += 1;
    previous = current;
  }
  assert.equal(visibilityChanges, 0);

  for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
    for (const layer of AI_WATERMARK_EXTRUSION_LAYERS) {
      const state = aiExtrusionLayerState(layer, progress);
      assert.equal(state.depthPx, layer.depthPx);
      assert.ok(state.opacity >= 0 && state.opacity <= 1);
    }
  }
  assert.deepEqual(aiExtrusionLayerState(AI_WATERMARK_EXTRUSION_LAYERS[0], 0), {
    depthPx: -extrusion.depthPx,
    opacity: 0
  });
  assert.deepEqual(aiExtrusionLayerState(AI_WATERMARK_EXTRUSION_LAYERS[0], 1), {
    depthPx: -extrusion.depthPx,
    opacity: 1
  });

  for (const face of AI_CUBE_FACES) {
    const baseline = aiCubeFaceVisibilityAtFrame(0, face);
    for (const frame of [30, 60, 90, 120]) {
      const state = aiCubeFaceVisibilityAtFrame(frame, face);
      assert.ok(Math.abs(state.extrusionProgress - baseline.extrusionProgress) < 1e-12);
      assert.ok(Math.abs(state.extrusionDepthPx - baseline.extrusionDepthPx) < 1e-12);
    }
  }
});

test("A正面使用nonzero复合路径且渐变与高光不再分块叠画", () => {
  assert.match(componentSource, /function AiACompoundPath\(props\)/u);
  assert.match(
    componentSource,
    /M96 22H126L66 218H18Z M96 22H126L206 218H158Z M68 137H152L166 174H55Z/u
  );
  assert.match(componentSource, /fillRule="nonzero"/u);
  assert.doesNotMatch(componentSource, /fillRule="evenodd"/u);
  assert.match(componentSource, /data-ai-a-front-base="single-compound-surface"/u);
  assert.match(componentSource, /data-ai-a-front-shine="single-compound-surface"/u);
  assert.equal((componentSource.match(/<AiACompoundPath/gu) ?? []).length, 2);
  assert.equal((componentSource.match(/<AiIPath/gu) ?? []).length, 3);
  assert.match(
    componentSource,
    /M232 22H350V64H313V176H350V218H232V176H269V64H232Z/u
  );
  assert.doesNotMatch(
    componentSource,
    /<g fill=\{`url\(#\$\{faceGradientId\}\)`\}>\s*<AiGlyphPaths/u
  );
});

test("样片保持独立，未注册到正式视频Root", () => {
  assert.doesNotMatch(mainRootSource, /visual-system-v1-ai-watermark-proof/iu);
  assert.doesNotMatch(mainRootSource, /VisualSystemV1AIWatermarkMotionProof/u);
});

test("v012安全直渲保留v011且禁止提前生成横版v005", () => {
  assert.equal(AI_WATERMARK_PROOF_RENDER_CONTRACT.candidateVersion, 12);
  assert.equal(
    AI_WATERMARK_PROOF_RENDER_CONTRACT.candidateDirectoryName,
    "visual-system-v1-ai-watermark-motion-proof-v012"
  );
  assert.equal(
    AI_WATERMARK_PROOF_RENDER_CONTRACT.schemaVersion,
    "visual-system-v1-ai-watermark-proof-render-v12"
  );
  assert.match(rendererSource, /visual-system-v1-ai-watermark-motion-proof-v011/u);
  assert.match(rendererSource, /preview-v012\.mp4/u);
  assert.match(rendererSource, /visual-system-v1-skill-agent-mcp-proof-v005/u);
  assert.match(rendererSource, /analyzeThirdTurnLeftFaceFlicker/u);
  assert.match(rendererSource, /FLICKER_INSPECTION_FRAMES/u);
  assert.match(rendererSource, /continuous-layer-opacity-taper/u);
});
