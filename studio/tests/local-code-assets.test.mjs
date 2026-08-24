import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { agents } from "../src/server/agents/registry.mjs";
import {
  buildLocalCodeAssets,
  inspectLocalCodeImplementation,
  localCodeAssetItems
} from "../src/server/production/local-code-assets.mjs";
import {
  APPROVED_STORYBOARD_SHORT_ASSET_ADAPTER_VERSION,
  adaptApprovedStoryboardToShortAssetPlan
} from "../src/server/production/short-asset-plan-adapter.mjs";
import { buildAssetExecutionCheckpoint } from "../src/server/reviews/asset-execution-checkpoint.mjs";
import { studioRoot } from "../src/shared/paths.mjs";
import { historicalApprovedStoryboardV3Episode } from
  "./historical-approved-storyboard-v3.fixture.mjs";
import {
  AGENT_SKILL_SHORT_CHAPTERS,
  AGENT_SKILL_SHORT_CHAPTER_WEIGHTS,
  AGENT_SKILL_SHORT_DURATION_SECONDS,
  AGENT_SKILL_SHORT_ARROW_FADE_FRAMES,
  AGENT_SKILL_SHORT_EDGE_DELAY_FRAMES,
  AGENT_SKILL_SHORT_EDGE_DRAW_FRAMES,
  AGENT_SKILL_SHORT_FPS,
  AGENT_SKILL_SHORT_NODE_ENTRY_OFFSET_PIXELS,
  AGENT_SKILL_SHORT_NODE_ENTER_FRAMES,
  AGENT_SKILL_SHORT_SCENES,
  AGENT_SKILL_SHORT_SCENE_WEIGHTS,
  AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS,
  agentSkillShortDiagramStateAt,
  agentSkillShortProgressPixelsAt,
  agentSkillShortSceneAt,
  buildAgentSkillShortDiagramMotionPolicy
} from "../src/video/agent-skill-short-plan.mjs";
import {
  PROGRESSIVE_KNOWLEDGE_MOTION_VERSION,
  TECHNICAL_DIAGRAM_CONTRACT_VERSION,
  TECHNICAL_DIAGRAM_ARROWHEAD_REVEAL,
  TECHNICAL_DIAGRAM_TRANSITION_DURATION_SECONDS,
  TECHNICAL_DIAGRAM_TRANSITION_EASING
} from "../src/shared/technical-diagram-contract.mjs";

const EPISODE_ID = "agent-skill-tool-mcp-60s-20260813";
const LOCAL_PLAN_PATH =
  `studio/data/production/episodes/${EPISODE_ID}/asset-plan-v001.json`;

async function localOnlyApprovedEpisode() {
  const episode = historicalApprovedStoryboardV3Episode();
  episode.production.assetPlanDirection = {
    strategy: "local-only",
    selectedBy: "human"
  };
  const plan = adaptApprovedStoryboardToShortAssetPlan(episode);
  const document = {
    episodeId: episode.id,
    provider: "deterministic-local",
    model: APPROVED_STORYBOARD_SHORT_ASSET_ADAPTER_VERSION,
    plan
  };
  const text = JSON.stringify(document);
  const evidence = {
    readFile: async () => text,
    inspectFileIntegrity: async () => ({
      bytes: Buffer.byteLength(text),
      sha256: "a".repeat(64)
    })
  };
  episode.production.assetPlan = {
    version: 1,
    artifactPath: LOCAL_PLAN_PATH,
    needsRevision: false,
    content: plan,
    versions: [{ version: 1, artifactPath: LOCAL_PLAN_PATH }]
  };
  const reviewed = await buildAssetExecutionCheckpoint(episode, {
    artifactPath: LOCAL_PLAN_PATH,
    version: 1
  }, evidence);
  const candidateHash = reviewed.checkpoint.currentCandidate.candidateHash;
  const machineReviewId = reviewed.checkpoint.machineReview.id;
  episode.reviewCheckpoints.assetExecution = {
    ...reviewed.checkpoint,
    status: "approved",
    humanApproval: {
      decision: "approved",
      at: "2026-08-13T10:00:00.000Z",
      note: "测试夹具显式批准 local-only 方案",
      version: 1,
      candidateHash,
      machineReviewId,
      maximumPaidCostUsd: 0,
      externalApiCallCount: 0
    },
    history: [
      ...reviewed.checkpoint.history,
      {
        type: "human-approval",
        at: "2026-08-13T10:00:00.000Z",
        version: 1,
        candidateHash,
        machineReviewId,
        decision: "approved",
        note: "测试夹具显式批准 local-only 方案"
      }
    ]
  };
  return episode;
}

test("批准前不能执行本地代码动画，批准后严格生成五项零外部调用清单", async () => {
  const approved = await localOnlyApprovedEpisode();
  assert.equal(localCodeAssetItems(approved).length, 5);
  const unapproved = structuredClone(approved);
  unapproved.reviewCheckpoints.assetExecution.status = "waiting_approval";
  unapproved.reviewCheckpoints.assetExecution.humanApproval = null;
  await assert.rejects(
    () => buildLocalCodeAssets(unapproved),
    (error) => error.code === "asset_execution_approval_required"
  );

  const testDirectory = await mkdtemp(resolve(studioRoot, "public", "local-code-test-"));
  const publicPrefix = testDirectory.slice(resolve(studioRoot, "public").length + 1);
  try {
    const assets = await buildLocalCodeAssets(approved, {
      now: new Date("2026-08-13T10:00:00.000Z"),
      outputDirectory: testDirectory,
      publicPrefix
    });
    assert.equal(assets.length, 5);
    assert.equal(new Set(assets.map((asset) => asset.planItemId)).size, 5);
    assert.ok(assets.every((asset) => asset.source === "local-code-animation"));
    assert.ok(assets.every((asset) => asset.type === "code-animation"));
    assert.ok(assets.every((asset) => asset.componentId === "AgentSkillShortExplainer"));
    const implementation = await inspectLocalCodeImplementation();
    assert.ok(assets.every((asset) => asset.implementationSha256 === implementation.sha256));
    assert.ok(assets.every((asset) => asset.externalApiCalls === 0));
    assert.ok(assets.every((asset) => asset.maximumPaidCostUsd === 0));
    assert.ok(assets.every((asset) => /^[a-f0-9]{64}$/u.test(asset.sha256)));
  } finally {
    await rm(testDirectory, { recursive: true, force: true });
  }
});

test("v4 实现摘要拒绝旧 v3 审批并覆盖入口、Root 与文字布局漂移", async () => {
  const approved = await localOnlyApprovedEpisode();
  const legacyApproved = structuredClone(approved);
  legacyApproved.reviewCheckpoints.assetExecution.currentCandidate
    .localCodeImplementation.schemaVersion = "local-code-implementation-v3";
  await assert.rejects(
    () => buildLocalCodeAssets(legacyApproved),
    (error) => error.code === "local_code_implementation_stale"
  );

  for (const changedPath of ["index.jsx", "root.jsx", "text-layout.mjs"]) {
    const changedImplementation = await inspectLocalCodeImplementation({
      readFile: async (filePath) => filePath.endsWith(changedPath)
        ? Buffer.from(`changed local implementation: ${filePath}`, "utf8")
        : readFile(filePath)
    });
    await assert.rejects(
      () => buildLocalCodeAssets(approved, { implementation: changedImplementation }),
      (error) => error.code === "local_code_implementation_stale",
      changedPath
    );
  }
});

test("Asset Agent 制作并登记代码动画后完成素材步骤，不把清单冒充上传图片", async () => {
  const episode = await localOnlyApprovedEpisode();
  assert.equal(episode.assets.length, 0);
  episode.scenes = episode.scenes.map((scene) => {
    const { asset: _asset, audio: _audio, ...rest } = scene;
    return rest;
  });
  const testDirectory = await mkdtemp(resolve(studioRoot, "public", "local-code-agent-test-"));
  const publicPrefix = testDirectory.slice(resolve(studioRoot, "public").length + 1);
  try {
    const result = await agents["asset-agent"].run(episode, {
      localCodeAssetOptions: { outputDirectory: testDirectory, publicPrefix }
    });
    assert.equal(result.status, "complete");
    assert.equal(result.patch.assets.length, 5);
    assert.ok(result.patch.assets.every((asset) => asset.verified === true));
    assert.ok(result.patch.assets.every((asset) => /^[a-f0-9]{64}$/u.test(asset.implementationSha256)));
    assert.ok(result.patch.scenes.every((scene) => scene.asset));
    assert.ok(result.patch.scenes.every((scene) => scene.asset.endsWith(".json")));
    assert.ok(
      result.patch.scenes.every(
        (scene) => !scene.asset.includes("subtitle-and-progress-chrome")
      )
    );
    assert.ok(result.patch.scenes.slice(0, 4).every((scene) => scene.asset.includes("skill-tool-mcp-layers")));
    assert.ok(result.patch.scenes[4].asset.includes("weekly-report-process"));
    assert.ok(result.patch.scenes.slice(5, 7).every((scene) => scene.asset.includes("tool-and-mcp-actions")));
    assert.ok(result.patch.scenes.slice(7).every((scene) => scene.asset.includes("capability-boundary-contrast")));
  } finally {
    await rm(testDirectory, { recursive: true, force: true });
  }
});

test("Asset Agent 发现动画清单漂移后生成新版本自愈", async () => {
  const episode = await localOnlyApprovedEpisode();
  const testDirectory = await mkdtemp(resolve(studioRoot, "public", "local-code-repair-test-"));
  const publicPrefix = testDirectory.slice(resolve(studioRoot, "public").length + 1);
  try {
    episode.assets = await buildLocalCodeAssets(episode, {
      now: new Date("2026-08-13T10:00:00.000Z"),
      outputDirectory: testDirectory,
      publicPrefix
    });
    const previousPath = episode.assets[0].path;
    episode.assets[0] = { ...episode.assets[0], sha256: "0".repeat(64) };
    const result = await agents["asset-agent"].run(episode, {
      localCodeAssetOptions: { outputDirectory: testDirectory, publicPrefix },
      now: new Date("2026-08-13T10:00:00.000Z")
    });
    assert.equal(result.status, "complete");
    assert.notEqual(result.patch.assets[0].path, previousPath);
    assert.notEqual(result.patch.assets[0].sha256, episode.assets[0].sha256);
    assert.ok(result.patch.assets.every((asset) => asset.externalApiCalls === 0));
  } finally {
    await rm(testDirectory, { recursive: true, force: true });
  }
});

test("Asset Agent 对方案版本、候选哈希和视觉合同绑定逐项 fail-closed", async (t) => {
  for (const field of ["assetPlanVersion", "candidateHash", "visualContractHash"]) {
    await t.test(field, async () => {
      const episode = await localOnlyApprovedEpisode();
      const testDirectory = await mkdtemp(
        resolve(studioRoot, "public", `local-code-${field}-test-`)
      );
      const publicPrefix = testDirectory.slice(resolve(studioRoot, "public").length + 1);
      try {
        const initialAssets = await buildLocalCodeAssets(episode, {
          now: new Date("2026-08-13T10:00:00.000Z"),
          outputDirectory: testDirectory,
          publicPrefix
        });
        const staleAssets = structuredClone(initialAssets);
        const staleAsset = staleAssets.find((asset) => asset.visualContractHash);
        assert.ok(staleAsset);
        staleAsset[field] = field === "assetPlanVersion" ? 999 : "0".repeat(64);
        episode.assets = staleAssets;
        const result = await agents["asset-agent"].run(episode, {
          now: new Date("2026-08-13T10:01:00.000Z"),
          localCodeAssetOptions: { outputDirectory: testDirectory, publicPrefix }
        });
        const repaired = result.patch.assets.find(
          (asset) => asset.planItemId === staleAsset.planItemId
        );
        assert.equal(result.status, "complete");
        assert.equal(repaired.version, 2);
        assert.equal(repaired.assetPlanVersion, episode.production.assetPlan.version);
        assert.equal(
          repaired.candidateHash,
          episode.reviewCheckpoints.assetExecution.currentCandidate.candidateHash
        );
        assert.equal(repaired.visualContractHash, initialAssets.find(
          (asset) => asset.planItemId === staleAsset.planItemId
        ).visualContractHash);
      } finally {
        await rm(testDirectory, { recursive: true, force: true });
      }
    });
  }
});

test("60 秒专用组件保留九镜并用六个真实时长章节推进，字幕透明无黑底", async () => {
  assert.equal(AGENT_SKILL_SHORT_DURATION_SECONDS, 60);
  assert.equal(AGENT_SKILL_SHORT_SCENES.length, 9);
  assert.equal(AGENT_SKILL_SHORT_SCENES[0].start, 0);
  assert.equal(AGENT_SKILL_SHORT_SCENES.at(-1).end, 60);
  assert.equal(Number(AGENT_SKILL_SHORT_SCENE_WEIGHTS.reduce((sum, value) => sum + value, 0).toFixed(3)), 60);
  assert.equal(new Set(AGENT_SKILL_SHORT_SCENE_WEIGHTS).size > 1, true);
  assert.equal(AGENT_SKILL_SHORT_CHAPTERS.length, 6);
  assert.equal(AGENT_SKILL_SHORT_CHAPTERS[0].start, 0);
  assert.equal(AGENT_SKILL_SHORT_CHAPTERS.at(-1).end, 60);
  assert.equal(
    Number(AGENT_SKILL_SHORT_CHAPTER_WEIGHTS.reduce((sum, value) => sum + value, 0).toFixed(3)),
    60
  );
  assert.equal(new Set(AGENT_SKILL_SHORT_CHAPTER_WEIGHTS).size > 1, true);
  assert.equal(agentSkillShortSceneAt(0).id, "S01");
  assert.equal(agentSkillShortSceneAt(59.9).id, "S09");
  assert.equal(agentSkillShortProgressPixelsAt(30), 270);
  assert.equal(agentSkillShortProgressPixelsAt(60), 540);

  const [preview, component] = await Promise.all([
    readFile(resolve(studioRoot, "src", "video", "episode-preview.jsx"), "utf8"),
    readFile(resolve(studioRoot, "src", "video", "agent-skill-short.jsx"), "utf8")
  ]);
  assert.match(preview, /AGENT_SKILL_SHORT_EPISODE_ID/u);
  assert.match(preview, /<AgentSkillShortExplainer episode=\{episode\} \/>/u);
  for (const name of [
    "TechnicalDiagram",
    "DiagramGroupBoundary",
    "DiagramEdge",
    "DiagramNode",
    "SceneBody"
  ]) {
    assert.match(component, new RegExp(`function ${name}\\b`, "u"));
  }
  assert.match(component, /AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS\[diagramId\]/u);
  assert.match(component, /agentSkillShortDiagramStateAt\(diagramId, currentSecond\)/u);
  assert.match(component, /state\.edgeArrowProgress\[edge\.id\]/u);
  assert.match(component, /diagramId="flow" currentSecond=\{currentSecond\}/u);
  assert.doesNotMatch(component, /progress\s*>\s*0\.94/u);
  assert.doesNotMatch(component, /0\.24\s*\+\s*progress/u);
  assert.doesNotMatch(component, /\bspring\s*\(/u);
  assert.doesNotMatch(component, /GeneratedBackdrop|<Img\b|<OffthreadVideo\b/u);
  assert.doesNotMatch(component, /radial-gradient/u);
  assert.match(component, /variant="outline"/u);
  assert.match(component, /bottom=\{46\}/u);
  assert.match(component, /horizontalInset=\{4\}/u);
  assert.match(component, /fontSize=\{18\}/u);
  assert.match(component, /gridTemplateColumns: chapterGrid/u);
  assert.match(component, /AGENT_SKILL_SHORT_CHAPTERS\.map/u);
  assert.match(component, /bottom: 0, height: 36/u);
  assert.match(component, /transform: `scaleX\(\$\{progressRatio\}\)`/u);
  assert.match(component, /transformOrigin: "left center"/u);
  assert.doesNotMatch(component, /width: progressPixels/u);
  assert.doesNotMatch(component, /ProgressStrip|right.*\d+\s*\/\s*\d+/u);
  assert.doesNotMatch(component, /AGENT SKILL|来源：/u);
});

test("S06 到 S07 共用全局技术图时间轴且不会在场景切换时重置", () => {
  const flow = AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS.flow;
  const s06 = AGENT_SKILL_SHORT_SCENES.find((scene) => scene.id === "S06");
  const s07 = AGENT_SKILL_SHORT_SCENES.find((scene) => scene.id === "S07");
  assert.equal(flow.start, s06.start);
  assert.equal(flow.end, s07.end);
  assert.equal(s06.end, s07.start);

  const beforeBoundary = agentSkillShortDiagramStateAt("flow", s06.end - 0.001);
  const atBoundary = agentSkillShortDiagramStateAt("flow", s07.start);
  assert.ok(atBoundary.elapsedSecond > 4.7);
  for (const nodeId of Object.keys(beforeBoundary.nodeProgress)) {
    assert.ok(atBoundary.nodeProgress[nodeId] >= beforeBoundary.nodeProgress[nodeId]);
  }
  for (const edgeId of Object.keys(beforeBoundary.edgeProgress)) {
    assert.ok(atBoundary.edgeProgress[edgeId] >= beforeBoundary.edgeProgress[edgeId]);
  }
  assert.equal(atBoundary.nodeProgress["agent-request"], 1);
  assert.equal(atBoundary.nodeProgress["database-query"], 1);
  assert.ok(atBoundary.nodeProgress["document-write"] > 0.99);
});

test("每个节点和连线按整数帧连续缓入缓出，之后稳定停留", () => {
  assert.equal(TECHNICAL_DIAGRAM_CONTRACT_VERSION, "technical-diagram-contract-v3");
  assert.equal(PROGRESSIVE_KNOWLEDGE_MOTION_VERSION, "progressive-knowledge-derivation-v3");
  assert.equal(TECHNICAL_DIAGRAM_TRANSITION_DURATION_SECONDS, 0.6);
  assert.equal(TECHNICAL_DIAGRAM_TRANSITION_EASING, "ease-in-out-smoothstep");
  assert.equal(TECHNICAL_DIAGRAM_ARROWHEAD_REVEAL, "continuous-fade");
  assert.equal(AGENT_SKILL_SHORT_NODE_ENTRY_OFFSET_PIXELS, 12);
  assert.equal(AGENT_SKILL_SHORT_NODE_ENTER_FRAMES, 18);
  assert.equal(AGENT_SKILL_SHORT_EDGE_DELAY_FRAMES, 3);
  assert.equal(AGENT_SKILL_SHORT_EDGE_DRAW_FRAMES, 11);
  assert.equal(AGENT_SKILL_SHORT_ARROW_FADE_FRAMES, 4);

  for (const [diagramId, diagram] of Object.entries(
    AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS
  )) {
    const policy = buildAgentSkillShortDiagramMotionPolicy(diagramId);
    assert.deepEqual(policy.transition, {
      schemaVersion: "technical-diagram-transition-v1",
      durationSeconds: 0.6,
      easing: "ease-in-out-smoothstep",
      bounce: false,
      arrowheadReveal: "continuous-fade"
    });

    for (const phase of policy.phases.filter((item) => item.kind === "reveal")) {
      const nodeId = phase.revealNodeIds[0];
      const absoluteStart = diagram.start + phase.startSecond;
      const phaseStartFrame = Math.ceil(absoluteStart * AGENT_SKILL_SHORT_FPS - 1e-7);
      const values = Array.from({ length: AGENT_SKILL_SHORT_NODE_ENTER_FRAMES + 1 }, (_, frame) =>
        agentSkillShortDiagramStateAt(
          diagramId,
          (phaseStartFrame + frame) / AGENT_SKILL_SHORT_FPS
        ).nodeProgress[nodeId]
      );
      assert.equal(values[0], 0);
      assert.equal(values.at(-1), 1);
      for (let index = 1; index < values.length - 1; index += 1) {
        assert.ok(values[index] > values[index - 1]);
        assert.ok(values[index] > 0 && values[index] < 1);
      }
      assert.equal(agentSkillShortDiagramStateAt(
        diagramId,
        (phaseStartFrame - 1) / AGENT_SKILL_SHORT_FPS
      ).nodeProgress[nodeId], 0);
      assert.equal(
        agentSkillShortDiagramStateAt(
          diagramId,
          diagram.start + phase.endSecond - 0.001
        ).nodeProgress[nodeId],
        1
      );

      for (const edgeId of phase.activateEdgeIds) {
        const stateAtOffset = (offset) => agentSkillShortDiagramStateAt(
          diagramId,
          (phaseStartFrame + offset) / AGENT_SKILL_SHORT_FPS
        );
        assert.equal(stateAtOffset(AGENT_SKILL_SHORT_EDGE_DELAY_FRAMES).edgeProgress[edgeId], 0);
        const lineValues = Array.from(
          { length: AGENT_SKILL_SHORT_EDGE_DRAW_FRAMES + 1 },
          (_, frame) => stateAtOffset(
            AGENT_SKILL_SHORT_EDGE_DELAY_FRAMES + frame
          ).edgeProgress[edgeId]
        );
        assert.equal(lineValues[0], 0);
        assert.equal(lineValues.at(-1), 1);
        for (let index = 1; index < lineValues.length - 1; index += 1) {
          assert.ok(lineValues[index] > lineValues[index - 1]);
          assert.ok(lineValues[index] > 0 && lineValues[index] < 1);
          assert.equal(
            stateAtOffset(
              AGENT_SKILL_SHORT_EDGE_DELAY_FRAMES + index
            ).edgeArrowProgress[edgeId],
            0
          );
        }
        assert.equal(
          stateAtOffset(
            AGENT_SKILL_SHORT_EDGE_DELAY_FRAMES + AGENT_SKILL_SHORT_EDGE_DRAW_FRAMES
          ).edgeProgress[edgeId],
          1
        );
        assert.equal(
          stateAtOffset(
            AGENT_SKILL_SHORT_EDGE_DELAY_FRAMES + AGENT_SKILL_SHORT_EDGE_DRAW_FRAMES
          ).edgeArrowProgress[edgeId],
          0
        );
        const arrowValues = Array.from(
          { length: AGENT_SKILL_SHORT_ARROW_FADE_FRAMES + 1 },
          (_, frame) => stateAtOffset(
            AGENT_SKILL_SHORT_EDGE_DELAY_FRAMES +
              AGENT_SKILL_SHORT_EDGE_DRAW_FRAMES +
              frame
          ).edgeArrowProgress[edgeId]
        );
        assert.equal(arrowValues[0], 0);
        assert.equal(arrowValues.at(-1), 1);
        for (let index = 1; index < arrowValues.length; index += 1) {
          assert.ok(arrowValues[index] > arrowValues[index - 1]);
        }
      }
    }
  }
});

test("箭头和底部进度均连续变化，不再使用单帧阈值或整数像素跳动", () => {
  const oneFrame = agentSkillShortProgressPixelsAt(1 / AGENT_SKILL_SHORT_FPS);
  const twoFrames = agentSkillShortProgressPixelsAt(2 / AGENT_SKILL_SHORT_FPS);
  assert.ok(Math.abs(oneFrame - 0.3) < 1e-12);
  assert.ok(Math.abs(twoFrames - 0.6) < 1e-12);
  assert.ok(twoFrames > oneFrame);
});

test("本地技术图从最小状态单调建立并在结尾保留全部节点与有向边", () => {
  for (const [diagramId, diagram] of Object.entries(
    AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS
  )) {
    const initial = agentSkillShortDiagramStateAt(diagramId, diagram.start);
    assert.equal(Object.values(initial.nodeProgress).every((value) => value === 0), true);
    assert.equal(Object.values(initial.edgeProgress).every((value) => value === 0), true);

    const sampleSeconds = [
      diagram.start,
      ...diagram.phases.map((phase) => diagram.start + phase.endSecond),
      diagram.end
    ];
    let previous = initial;
    for (const second of sampleSeconds.slice(1)) {
      const current = agentSkillShortDiagramStateAt(diagramId, second);
      for (const nodeId of Object.keys(previous.nodeProgress)) {
        assert.ok(current.nodeProgress[nodeId] >= previous.nodeProgress[nodeId]);
      }
      for (const edgeId of Object.keys(previous.edgeProgress)) {
        assert.ok(current.edgeProgress[edgeId] >= previous.edgeProgress[edgeId]);
      }
      previous = current;
    }
    assert.equal(previous.complete, true);
    assert.equal(Object.values(previous.nodeProgress).every((value) => value === 1), true);
    assert.equal(Object.values(previous.edgeProgress).every((value) => value === 1), true);
  }

  const flow = AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS.flow;
  assert.equal(
    flow.edges.some((edge) => edge.from === "database-query" && edge.to === "document-write"),
    false
  );
  assert.notEqual(
    flow.phases.find((phase) => phase.revealNodeIds.includes("database-query")).id,
    flow.phases.find((phase) => phase.revealNodeIds.includes("document-write")).id
  );
});
