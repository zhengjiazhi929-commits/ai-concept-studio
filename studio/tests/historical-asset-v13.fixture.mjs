export const HISTORICAL_ASSET_V13_FIXTURE_ID =
  "agent-skill-tool-mcp-60s-20260813/asset-plan-v013:legacy-motion-v2-minimal-v1";

export const HISTORICAL_ASSET_V13_SOURCE_PLAN_HASH =
  "a776121354841411ab0d6f05570d0e3be9980c29a1a4b667a6c7595a3dc320d8";

export const HISTORICAL_ASSET_V13_FIXTURE_HASH =
  "a15da4728d04e65377042bc63af0318af6851b1710d721d54031708101e0a283";

export const HISTORICAL_ASSET_V13_FIXTURE = Object.freeze({
  fixtureId: HISTORICAL_ASSET_V13_FIXTURE_ID,
  source: {
    episodeId: "agent-skill-tool-mcp-60s-20260813",
    artifactVersion: 13,
    sourcePlanIntegrityHash: HISTORICAL_ASSET_V13_SOURCE_PLAN_HASH
  },
  plan: {
    sourceStoryboard: {
      version: 4,
      artifactHash: "c6bf111531e14a4a42fd26b55c3d1135c53ff64e19b5f2c2804e7d58c57f3a30",
      reviewReportId: "review-storyboard-v4-5-2026-08-17T11-38-18-288Z"
    },
    items: [{
      id: "skill-tool-mcp-layers",
      assetType: "technical-diagram",
      sceneIds: ["S01", "S02", "S03", "S04"],
      productionMethod: {
        kind: "local-code-animation"
      },
      visualContract: {
        schemaVersion: "technical-diagram-contract-v3",
        kind: "technical-architecture",
        style: "ai-research-paper-system-diagram",
        readingDirection: "top-to-bottom",
        semanticLayer: "local-code-semantic-diagram",
        sourceSceneIds: ["S01", "S02", "S03", "S04"],
        sourceRequirements: [
          "三层架构图：过程知识、执行动作、连接协议；高亮过程知识层并展示任务步骤展开；以关系和过程动画为主，不用大字卡片代替说明",
          "三层架构图：过程知识、执行动作、连接协议；高亮执行动作层并展示动作触发；以关系和过程动画为主，不用大字卡片代替说明",
          "三层架构图：过程知识、执行动作、连接协议；外部能力通过 MCP 连接线被 Agent 发现和调用；以关系和过程动画为主，不用大字卡片代替说明"
        ],
        nodes: [
          {
            id: "skill-knowledge",
            label: "Skill / 过程知识",
            role: "method-guidance"
          },
          {
            id: "agent",
            label: "Agent / 判断与编排",
            role: "orchestrator"
          },
          {
            id: "tool-action",
            label: "Tool / 执行动作",
            role: "executable-action"
          },
          {
            id: "mcp-protocol",
            label: "MCP / 连接协议",
            role: "capability-protocol"
          },
          {
            id: "external-capability",
            label: "外部能力",
            role: "external-capability"
          }
        ],
        edges: [
          {
            id: "skill-guides-agent",
            from: "skill-knowledge",
            to: "agent",
            relation: "guides",
            directed: true
          },
          {
            id: "agent-invokes-tool",
            from: "agent",
            to: "tool-action",
            relation: "invokes",
            directed: true
          },
          {
            id: "agent-uses-mcp",
            from: "agent",
            to: "mcp-protocol",
            relation: "discovers-and-calls",
            directed: true
          },
          {
            id: "mcp-connects-capability",
            from: "mcp-protocol",
            to: "external-capability",
            relation: "connects",
            directed: true
          }
        ],
        motionPolicy: {
          schemaVersion: "progressive-knowledge-derivation-v2",
          mode: "progressive-knowledge-derivation",
          durationSeconds: 25.443,
          initialVisibleNodeIds: [],
          retainRevealedElements: true,
          allowCompleteDiagramAtStart: false,
          maxNewNodesPerPhase: 1,
          transition: {
            schemaVersion: "technical-diagram-transition-v1",
            durationSeconds: 0.6,
            easing: "ease-in-out-smoothstep",
            bounce: false,
            arrowheadReveal: "continuous-fade"
          },
          phases: [
            {
              id: "reveal-skill",
              order: 1,
              kind: "reveal",
              startSecond: 0,
              endSecond: 2.2,
              learningObjective: "先建立 Skill 的过程知识",
              revealNodeIds: ["skill-knowledge"],
              activateEdgeIds: []
            },
            {
              id: "reveal-agent",
              order: 2,
              kind: "reveal",
              startSecond: 2.2,
              endSecond: 4.782,
              learningObjective: "再展示 Skill 如何指导 Agent",
              revealNodeIds: ["agent"],
              activateEdgeIds: ["skill-guides-agent"]
            },
            {
              id: "reveal-tool",
              order: 3,
              kind: "reveal",
              startSecond: 4.782,
              endSecond: 8.708,
              learningObjective: "展示 Agent 调用 Tool 执行动作",
              revealNodeIds: ["tool-action"],
              activateEdgeIds: ["agent-invokes-tool"]
            },
            {
              id: "reveal-mcp",
              order: 4,
              kind: "reveal",
              startSecond: 8.708,
              endSecond: 13,
              learningObjective: "展示 Agent 通过 MCP 发现能力",
              revealNodeIds: ["mcp-protocol"],
              activateEdgeIds: ["agent-uses-mcp"]
            },
            {
              id: "reveal-external",
              order: 5,
              kind: "reveal",
              startSecond: 13,
              endSecond: 17.402,
              learningObjective: "由 MCP 连接到外部能力",
              revealNodeIds: ["external-capability"],
              activateEdgeIds: ["mcp-connects-capability"]
            },
            {
              id: "hold-architecture",
              order: 6,
              kind: "hold",
              startSecond: 17.402,
              endSecond: 25.443,
              learningObjective: "停留完整架构并按旁白高亮职责",
              revealNodeIds: [],
              activateEdgeIds: []
            }
          ]
        },
        requiredPrimitives: [
          "rectangular-module-nodes",
          "directed-connectors",
          "group-boundaries",
          "clear-flow-order"
        ],
        forbiddenPrimitives: [
          "decorative-blobs",
          "cloud-metaphors",
          "gears",
          "rings",
          "waves",
          "ornamental-gradients"
        ]
      }
    }],
    executionPolicy: {
      externalApiCalls: []
    }
  }
});

export function historicalAssetV13Fixture() {
  return structuredClone(HISTORICAL_ASSET_V13_FIXTURE);
}
