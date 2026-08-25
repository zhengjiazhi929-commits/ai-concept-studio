import { lstat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { ensureAgentArchitecture } from "../shared/agent-contracts.mjs";
import { inspectFileIntegrity } from "../shared/integrity.mjs";
import { PIPELINE_DEFINITIONS } from "../shared/schema.mjs";
import { createApprovalMap } from "../shared/workflow.mjs";
import {
  episodePublicDirectory,
  resolveExistingPathInside,
  studioRoot,
  workspaceRoot
} from "../shared/paths.mjs";
import { readConfig, readEpisode, writeEpisode, appendEvent } from "../shared/store.mjs";
import {
  bindGoldenM1LogicalEvidence,
  buildGoldenM1ResearchCandidate,
  buildGoldenM1ScriptDraft,
  buildGoldenM1StoryboardDraft,
  goldenM1ProductionProfile
} from "./production/golden-m1-structure.mjs";

const GOLDEN_ID = "golden-001";
const IMPORTER_ID = "golden-seed-importer-v0.2";
export const GOLDEN_IMPORT_AUDIT_EVENT_ID =
  `${IMPORTER_ID}:${GOLDEN_ID}:episode.imported`;
const IMPORT_AUDIT_MESSAGE =
  "黄金样例已安全 seed；等待 research 机器审核与人工 Gate";

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

export class GoldenSampleImportError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "GoldenSampleImportError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function goldenImportError(message, code, statusCode = 400) {
  return new GoldenSampleImportError(message, code, statusCode);
}

function timestamp(now) {
  const value = typeof now === "function" ? now() : now;
  return (value instanceof Date ? value : new Date(value ?? Date.now())).toISOString();
}

function episodeAlreadyExistsError() {
  return goldenImportError(
    "Golden Episode 已存在；seed 只允许创建新 Episode，不能覆盖或静默 reset",
    "golden_episode_already_exists",
    409
  );
}

function importAuditOutbox(actor, at) {
  return {
    schemaVersion: 1,
    eventId: GOLDEN_IMPORT_AUDIT_EVENT_ID,
    idempotencyKey: GOLDEN_IMPORT_AUDIT_EVENT_ID,
    status: "pending",
    at,
    actor
  };
}

function validatedImportAuditOutbox(episode) {
  if (episode?.system?.importedBy !== IMPORTER_ID) return null;
  const marker = episode.system.importAuditOutbox;
  if (marker === undefined) return null;
  const matchingHistory = (episode.history ?? []).find((entry) => (
    entry?.type === "import" &&
    entry.auditEventId === GOLDEN_IMPORT_AUDIT_EVENT_ID &&
    entry.at === marker?.at &&
    entry.actor === marker?.actor
  ));
  if (
    !marker ||
    typeof marker !== "object" ||
    Array.isArray(marker) ||
    marker.schemaVersion !== 1 ||
    marker.eventId !== GOLDEN_IMPORT_AUDIT_EVENT_ID ||
    marker.idempotencyKey !== GOLDEN_IMPORT_AUDIT_EVENT_ID ||
    !new Set(["pending", "delivered"]).has(marker.status) ||
    typeof marker.at !== "string" ||
    !Number.isFinite(Date.parse(marker.at)) ||
    typeof marker.actor !== "string" ||
    !marker.actor ||
    marker.actor.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(marker.actor) ||
    !matchingHistory
  ) {
    throw goldenImportError(
      "Golden seed 审计 outbox 与 Episode 历史不一致，禁止自动补写",
      "golden_seed_audit_outbox_invalid",
      409
    );
  }
  return marker;
}

function importAuditEvent(marker) {
  return {
    eventId: marker.eventId,
    idempotencyKey: marker.idempotencyKey,
    at: marker.at,
    type: "episode.imported",
    episodeId: GOLDEN_ID,
    actor: marker.actor,
    message: IMPORT_AUDIT_MESSAGE
  };
}

function auditReceiptMatches(receipt, expected) {
  return Boolean(
    receipt &&
    typeof receipt === "object" &&
    receipt.eventId === expected.eventId &&
    receipt.idempotencyKey === expected.idempotencyKey &&
    receipt.at === expected.at &&
    receipt.type === expected.type &&
    receipt.episodeId === expected.episodeId &&
    receipt.actor === expected.actor &&
    receipt.message === expected.message
  );
}

async function deliverPendingImportAudit(episode, options = {}) {
  const marker = validatedImportAuditOutbox(episode);
  if (!marker || marker.status !== "pending") return episode;
  const event = importAuditEvent(marker);
  const receipt = await options.appendEvent(event);
  if (!auditReceiptMatches(receipt, event)) {
    throw goldenImportError(
      "Golden seed 审计账本未返回与 outbox 精确匹配的幂等回执",
      "golden_seed_audit_receipt_invalid",
      500
    );
  }
  const delivered = structuredClone(episode);
  delivered.system.importAuditOutbox = {
    ...delivered.system.importAuditOutbox,
    status: "delivered"
  };
  await options.writeEpisode(delivered);
  return delivered;
}

function validateFileRecord(relativePath, record) {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    record.path !== normalizedPath ||
    !Number.isSafeInteger(record.bytes) ||
    record.bytes < 0 ||
    !/^[a-f0-9]{64}$/u.test(record.sha256 ?? "")
  ) {
    throw goldenImportError(
      `Golden seed 文件摘要无效：${normalizedPath}`,
      "golden_seed_file_record_invalid"
    );
  }
  return {
    path: normalizedPath,
    bytes: record.bytes,
    sha256: record.sha256
  };
}

function sameFileSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function defaultFileRecord(relativePath, options = {}) {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  const root = options.workspaceRoot ?? workspaceRoot;
  const getStat = options.lstat ?? options.stat ?? lstat;
  const resolveSafe = options.resolveExistingPathInside ?? resolveExistingPathInside;
  const inspect = options.inspectFileIntegrity ?? inspectFileIntegrity;
  const lexicalPath = resolve(root, normalizedPath);
  const firstRealPath = await resolveSafe(root, lexicalPath);
  const before = await getStat(firstRealPath);
  if (!before.isFile()) {
    throw goldenImportError(
      `Golden seed 文件不是普通文件：${normalizedPath}`,
      "golden_seed_file_not_regular"
    );
  }
  const firstIntegrity = await inspect(firstRealPath);
  const secondRealPath = await resolveSafe(root, lexicalPath);
  const after = await getStat(secondRealPath);
  if (
    firstRealPath !== secondRealPath ||
    !after.isFile() ||
    !sameFileSnapshot(before, after) ||
    firstIntegrity.bytes !== before.size ||
    firstIntegrity.bytes !== after.size
  ) {
    throw goldenImportError(
      `Golden seed 文件在校验期间发生变化：${normalizedPath}`,
      "golden_seed_file_changed"
    );
  }
  const confirmedIntegrity = await inspect(secondRealPath);
  if (
    confirmedIntegrity.bytes !== firstIntegrity.bytes ||
    confirmedIntegrity.sha256 !== firstIntegrity.sha256
  ) {
    throw goldenImportError(
      `Golden seed 文件摘要在校验期间发生变化：${normalizedPath}`,
      "golden_seed_file_changed"
    );
  }
  return {
    path: normalizedPath,
    bytes: confirmedIntegrity.bytes,
    sha256: confirmedIntegrity.sha256
  };
}

export async function importGoldenSample(options = {}) {
  const persist = options.persist !== false;
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const readStudioConfig = options.readConfig ?? readConfig;
  const publicDirectoryFor = options.episodePublicDirectory ?? episodePublicDirectory;
  const root = options.workspaceRoot ?? workspaceRoot;
  const actor = typeof options.actor === "string" && options.actor.trim()
    ? options.actor.trim().slice(0, 128)
    : "system:golden-seed-importer";
  const recordFile = async (relativePath) => validateFileRecord(
    relativePath,
    await (options.fileRecord ?? defaultFileRecord)(relativePath, {
      workspaceRoot: root,
      lstat: options.lstat,
      stat: options.stat,
      resolveExistingPathInside: options.resolveExistingPathInside,
      inspectFileIntegrity: options.inspectFileIntegrity
    })
  );

  if (persist) {
    let existing = null;
    try {
      existing = await readState(GOLDEN_ID);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (existing) {
      await deliverPendingImportAudit(existing, {
        appendEvent: recordEvent,
        writeEpisode: writeState
      });
      throw episodeAlreadyExistsError();
    }
  }

  const config = await readStudioConfig();
  const publicDirectory = publicDirectoryFor(GOLDEN_ID);
  const now = timestamp(options.now);

  const assets = [];
  for (const fileName of screenshotFiles) {
    const source = resolve(
      root,
      "episodes",
      GOLDEN_ID,
      "production",
      "captures",
      "screen-selects",
      fileName
    );
    const destination = resolve(publicDirectory, fileName);
    const sourcePath = relative(root, source).replaceAll("\\", "/");
    const publicPath = relative(root, destination).replaceAll("\\", "/");
    let sourceIntegrity;
    let publicIntegrity;
    try {
      sourceIntegrity = await recordFile(sourcePath);
    } catch (error) {
      throw goldenImportError(
        `Golden seed 源素材不可安全读取：${fileName}`,
        error?.code === "ENOENT"
          ? "golden_seed_source_asset_missing"
          : "golden_seed_source_asset_invalid",
        409
      );
    }
    try {
      publicIntegrity = await recordFile(publicPath);
    } catch (error) {
      throw goldenImportError(
        `Golden seed 公开素材不可安全读取：${fileName}`,
        error?.code === "ENOENT"
          ? "golden_seed_public_asset_missing"
          : "golden_seed_public_asset_invalid",
        409
      );
    }
    if (
      sourceIntegrity.bytes !== publicIntegrity.bytes ||
      sourceIntegrity.sha256 !== publicIntegrity.sha256
    ) {
      throw goldenImportError(
        `Golden seed 源素材与公开素材不一致：${fileName}`,
        "golden_seed_public_asset_mismatch",
        409
      );
    }
    assets.push({
      id: fileName.replace(/\.png$/u, ""),
      type: "image",
      path: `episodes/${GOLDEN_ID}/${fileName}`,
      source: sourcePath,
      bytes: publicIntegrity.bytes,
      sha256: publicIntegrity.sha256,
      privacy: "fictional-data",
      verified: true,
      rights: {
        schemaVersion: 1,
        authorOrSource: "AI Concept Studio synthetic fixture generator",
        sourceUrl: null,
        acquiredAt: now,
        license: "project-original-private-use",
        allowedUse: "private-internal-review",
        attributionRequirements: "none",
        privacyPortraitStatus: "fictional-data",
        verifiedBy: `machine:${IMPORTER_ID}`
      }
    });
  }

  const sourceDocs = [];
  for (const sourceFile of sourceFiles) sourceDocs.push(await recordFile(sourceFile));

  const scenes = bindGoldenM1LogicalEvidence([
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
  ]);
  const subtitles = [
    { start: 0, end: 5, text: "Agentic Coding 到底是什么？" },
    { start: 5, end: 11, text: "同样是写代码，为什么一种方式还没有完成任务？" },
    { start: 11, end: 17, text: "关键变化，是 AI 承担的工作单位变大了。" },
    { start: 17, end: 23, text: "它不仅修改文件，还要验证权限和业务规则。" },
    { start: 23, end: 30, text: "测试、状态和最终结果共同构成完成证据。" },
    { start: 30, end: 36, text: "从生成代码，到持续推进一个可验证任务。" }
  ];
  const productionProfile = goldenM1ProductionProfile();
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
    productionProfile,
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
    research: buildGoldenM1ResearchCandidate(sourceDocs),
    approvals: createApprovalMap({
      research: { currentVersion: 1 },
      script: { currentVersion: 1 },
      storyboard: { currentVersion: 1 },
      assets: { currentVersion: 1 }
    }),
    approvalHistory: [],
    pipeline: PIPELINE_DEFINITIONS.map((definition) => {
      const trendImported = definition.id === "trend";
      const researchCandidate = definition.id === "research";
      return {
        ...definition,
        status: trendImported
          ? "complete"
          : researchCandidate
            ? "waiting_approval"
            : "pending",
        progress: trendImported || researchCandidate ? 1 : 0,
        mode: trendImported
          ? "imported-fixed-input"
          : researchCandidate
            ? "imported-candidate"
            : null,
        lastRunAt: trendImported || researchCandidate ? now : null,
        requiresApproval: researchCandidate ? "research" : null,
        requiresHuman: false,
        artifacts: researchCandidate ? sourceDocs.map((record) => record.path) : [],
        findings: [],
        message: trendImported
          ? "固定选题与趋势输入已导入"
          : researchCandidate
            ? "研究候选已导入；须按当前规则重新机器审核后再人工批准"
            : "等待前一道真实人工 Gate 完成"
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
      scriptDraft: buildGoldenM1ScriptDraft(scenes, subtitles),
      storyboardDraft: buildGoldenM1StoryboardDraft()
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
      durationSeconds: productionProfile.targetDurationSeconds,
      compositionId: config.render.compositionId,
      outputPath: null,
      status: "pending",
      progress: 0
    },
    scenes,
    subtitles,
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
        actor,
        auditEventId: GOLDEN_IMPORT_AUDIT_EVENT_ID,
        message: "从黄金样例文档和真实浏览器素材导入"
      }
    ],
    system: {
      studioRoot: relative(workspaceRoot, studioRoot).replaceAll("\\", "/"),
      importedBy: IMPORTER_ID,
      trustedFixture: false,
      fixedInput: true,
      importAuditOutbox: importAuditOutbox(actor, now)
    }
  };

  const seededEpisode = ensureAgentArchitecture(episode);
  if (!persist) return { episode: seededEpisode, destination: null };

  const destination = await writeState(seededEpisode);
  const deliveredEpisode = await deliverPendingImportAudit(seededEpisode, {
    appendEvent: recordEvent,
    writeEpisode: writeState
  });
  return { episode: deliveredEpisode, destination };
}
