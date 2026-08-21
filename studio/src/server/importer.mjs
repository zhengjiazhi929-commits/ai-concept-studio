import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, relative, resolve } from "node:path";
import { PIPELINE_DEFINITIONS } from "../shared/schema.mjs";
import {
  createApprovalMap,
  currentGateArtifactHash
} from "../shared/workflow.mjs";
import {
  episodePublicDirectory,
  studioRoot,
  workspaceRoot
} from "../shared/paths.mjs";
import { readConfig, readEpisode, writeEpisode, appendEvent } from "../shared/store.mjs";

const GOLDEN_ID = "golden-001";

const sourceFiles = [
  "docs/05-visual-system.md",
  "episodes/golden-001/01-topic-card.md",
  "episodes/golden-001/02-source-register.md",
  "episodes/golden-001/03-claim-ledger.md",
  "episodes/golden-001/07-script.md",
  "episodes/golden-001/08-storyboard.md",
  "episodes/golden-001/09-production-manifest.md"
];

const screenshotFiles = [
  "demo-baseline-export-failed.png",
  "demo-viewer-denied.png",
  "demo-admin-export-complete.png",
  "demo-final-before-export.png"
];

async function fileRecord(relativePath) {
  const absolutePath = resolve(workspaceRoot, relativePath);
  const [body, details] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
  return {
    path: relativePath.replaceAll("\\", "/"),
    bytes: details.size,
    sha256: createHash("sha256").update(body).digest("hex")
  };
}

export async function importGoldenSample(options = {}) {
  const persist = options.persist !== false;
  const config = await readConfig();
  const publicDirectory = episodePublicDirectory(GOLDEN_ID);
  if (persist) await mkdir(publicDirectory, { recursive: true });

  const assets = [];
  for (const fileName of screenshotFiles) {
    const source = resolve(
      workspaceRoot,
      "episodes",
      GOLDEN_ID,
      "production",
      "captures",
      "screen-selects",
      fileName
    );
    const destination = resolve(publicDirectory, fileName);
    if (persist) await copyFile(source, destination);
    const sourcePath = relative(workspaceRoot, source).replaceAll("\\", "/");
    const integrity = await fileRecord(sourcePath);
    assets.push({
      id: fileName.replace(/\.png$/u, ""),
      type: "image",
      path: `episodes/${GOLDEN_ID}/${fileName}`,
      source: sourcePath,
      bytes: integrity.bytes,
      sha256: integrity.sha256,
      privacy: "fictional-data",
      verified: true
    });
  }

  const sourceDocs = [];
  for (const sourceFile of sourceFiles) sourceDocs.push(await fileRecord(sourceFile));

  const now = new Date().toISOString();
  const episode = {
    schemaVersion: 1,
    id: GOLDEN_ID,
    title: "Agentic Coding 到底是什么？",
    concept: "Agentic Coding",
    conceptId: "agentic-coding",
    audience: "理解 AI 基础概念、关注产品落地的 AI 产品经理及技术邻近人群",
    thesis: "AI 编程的工作单位正在从代码片段转向可验证的任务。",
    status: "in_production",
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: now,
    previewMode: "visual-proof",
    trendSelection: {
      runId: "golden-import",
      candidateId: "agentic-coding",
      selectedAt: "2026-07-31T00:00:00.000Z",
      note: "黄金样例人工选题",
      productDecisions: ["任务授权范围", "完成定义与验收", "人工接管和可逆性"],
      primarySources: [
        { label: "OpenAI Codex", url: "https://developers.openai.com/codex/" },
        {
          label: "Anthropic Claude Code",
          url: "https://docs.anthropic.com/en/docs/claude-code/overview"
        }
      ],
      creatorEvidence: [],
      evidenceSignals: []
    },
    approvals: createApprovalMap({
      research: {
        status: "approved",
        at: "2026-07-31",
        currentVersion: 1,
        provenance: "trusted-fixture"
      },
      script: {
        status: "approved",
        at: "2026-08-03",
        currentVersion: 1,
        provenance: "trusted-fixture"
      },
      storyboard: {
        status: "approved",
        at: "2026-08-03",
        note: "B-real-product-documentary",
        currentVersion: 1,
        provenance: "trusted-fixture"
      },
      assets: { currentVersion: 1 }
    }),
    approvalHistory: [
      { at: "2026-07-31", gate: "research", decision: "approved", note: "", version: 1 },
      { at: "2026-08-03", gate: "script", decision: "approved", note: "", version: 1 },
      {
        at: "2026-08-03",
        gate: "storyboard",
        decision: "approved",
        note: "B-real-product-documentary",
        version: 1
      }
    ],
    pipeline: PIPELINE_DEFINITIONS.map((definition) => {
      const complete = ["trend", "research", "script", "storyboard", "assets"].includes(
        definition.id
      );
      return {
        ...definition,
        status: complete ? "complete" : definition.id === "voice" ? "ready" : "pending",
        mode: complete ? "imported-approved-artifact" : null,
        lastRunAt: complete ? now : null,
        message:
          definition.id === "voice"
            ? "素材已导入，可以进行旁白与素材总审"
            : "等待上一步完成"
      };
    }),
    sourceDocs,
    assets,
    production: {
      ai: { requestCount: 0, attempts: [] },
      feedback: {},
      quality: {},
      materialsVersion: 1,
      assetBundleRevision: 1,
      scriptDraft: { version: 1, source: "episodes/golden-001/07-script.md" },
      storyboardDraft: { version: 1, source: "episodes/golden-001/08-storyboard.md" }
    },
    voice: {
      status: "unconfigured",
      mode: null,
      audioPath: null,
      note: "视觉验证版允许无旁白；正式低清样片必须先通过声音审批。"
    },
    render: {
      width: config.render.previewWidth,
      height: config.render.previewHeight,
      fps: config.render.previewFps,
      durationSeconds: config.render.previewDurationSeconds,
      compositionId: config.render.compositionId,
      outputPath: null,
      status: "pending",
      progress: 0
    },
    scenes: [
      {
        id: "S01",
        start: 0,
        end: 5,
        type: "title",
        kicker: "AI 概念拆解",
        title: "Agentic Coding\n到底是什么？",
        subtitle: "不是让 AI 多写几行代码"
      },
      {
        id: "S02",
        start: 5,
        end: 11,
        type: "evidence",
        asset: "episodes/golden-001/demo-baseline-export-failed.png",
        label: "BEFORE｜真实失败",
        title: "旧接口返回了 CSV\n页面却无法完成任务",
        subtitle: "代码存在，不等于任务完成"
      },
      {
        id: "S03",
        start: 11,
        end: 17,
        type: "statement",
        index: "01",
        title: "工作单位变了",
        statement: "生成代码片段\n↓\n交付可验证任务",
        subtitle: "目标、环境、行动、反馈、验收"
      },
      {
        id: "S04",
        start: 17,
        end: 23,
        type: "evidence",
        asset: "episodes/golden-001/demo-viewer-denied.png",
        label: "权限验证｜viewer 403",
        title: "普通用户必须被拒绝",
        subtitle: "权限结果是完成证据的一部分"
      },
      {
        id: "S05",
        start: 23,
        end: 30,
        type: "evidence",
        asset: "episodes/golden-001/demo-admin-export-complete.png",
        label: "AFTER｜真实验收",
        title: "管理员异步导出完成",
        subtitle: "测试、状态、下载与脱敏全部可检查"
      },
      {
        id: "S06",
        start: 30,
        end: 36,
        type: "summary",
        kicker: "一句话记住",
        title: "Agentic Coding 的核心",
        statement: "AI 开始负责把任务\n持续推进到可验收结果",
        subtitle: "模型能力 × 工具 × 环境 × 反馈 × 边界"
      }
    ],
    subtitles: [
      { start: 0, end: 5, text: "Agentic Coding 到底是什么？" },
      { start: 5, end: 11, text: "同样是写代码，为什么一种方式还没有完成任务？" },
      { start: 11, end: 17, text: "关键变化，是 AI 承担的工作单位变大了。" },
      { start: 17, end: 23, text: "它不仅修改文件，还要验证权限和业务规则。" },
      { start: 23, end: 30, text: "测试、状态和最终结果共同构成完成证据。" },
      { start: 30, end: 36, text: "从生成代码，到持续推进一个可验证任务。" }
    ],
    qa: {
      status: "pending",
      reportPath: null,
      checks: [],
      checkedAt: null
    },
    history: [
      {
        at: now,
        type: "import",
        message: "从黄金样例文档和真实浏览器素材导入"
      }
    ],
    system: {
      studioRoot: relative(workspaceRoot, studioRoot).replaceAll("\\", "/"),
      importedBy: "golden-sample-importer-v0.1",
      trustedFixture: true
    }
  };

  for (const gate of ["research", "script", "storyboard"]) {
    episode.approvals[gate].artifactHash = currentGateArtifactHash(episode, gate);
  }

  if (!persist) return { episode, destination: null };

  try {
    const existing = await readEpisode(GOLDEN_ID);
    episode.control = {
      ...(episode.control ?? {}),
      stateVersion: existing.control.stateVersion
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const destination = await writeEpisode(episode);
  await appendEvent({
    type: "episode.imported",
    episodeId: GOLDEN_ID,
    message: "黄金样例已导入为结构化一期数据"
  });
  return { episode, destination };
}
