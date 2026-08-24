import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAiClient } from "../ai/client.mjs";
import { writeVersionedArtifact } from "./artifacts.mjs";
import { readAiConfig } from "../../shared/ai-config.mjs";
import { latestReviewFeedback } from "../../shared/workflow.mjs";
import { ensureInside, workspaceRoot } from "../../shared/paths.mjs";
import { productionProfileForEpisode } from "../../shared/production-profiles.mjs";
import {
  adaptApprovedSourceToShortScript,
  APPROVED_SOURCE_SHORT_SCRIPT_ADAPTER_VERSION
} from "./short-script-adapter.mjs";
import {
  adaptApprovedScriptToShortStoryboard,
  APPROVED_SCRIPT_SHORT_STORYBOARD_ADAPTER_VERSION
} from "./short-storyboard-adapter.mjs";
import {
  adaptApprovedStoryboardToShortAssetPlan,
  APPROVED_STORYBOARD_SHORT_ASSET_ADAPTER_VERSION
} from "./short-asset-plan-adapter.mjs";
import {
  requireSideEffectGrant,
  SideEffectAuthorizationError
} from "../security/side-effect-capability.mjs";

const closedObject = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required
});

function scriptSchemaForProfile(profile) {
  return closedObject({
  title: { type: "string" },
  thesis: { type: "string" },
  targetDurationSeconds: {
    type: "integer",
    minimum: profile.targetDurationSeconds.minimum,
    maximum: profile.targetDurationSeconds.maximum
  },
  hook: { type: "string" },
  sections: {
    type: "array",
    minItems: profile.scriptSections.minimum,
    maxItems: profile.scriptSections.maximum,
    items: closedObject({
      id: { type: "string" },
      heading: { type: "string" },
      purpose: { type: "string" },
      narration: { type: "string" },
      evidenceRefs: { type: "array", items: { type: "string" } },
      visualDirection: { type: "string" }
    })
  },
  closing: { type: "string" },
  factCheckNotes: { type: "array", items: { type: "string" } }
});
}

function storyboardSchemaForProfile(profile) {
  return closedObject({
  targetDurationSeconds: {
    type: "integer",
    minimum: profile.targetDurationSeconds.minimum,
    maximum: profile.targetDurationSeconds.maximum
  },
  scenes: {
    type: "array",
    minItems: profile.storyboardScenes.minimum,
    maxItems: profile.storyboardScenes.maximum,
    items: closedObject({
      type: { type: "string", enum: ["title", "evidence", "statement", "summary"] },
      durationSeconds: {
        type: "number",
        minimum: profile.sceneDurationSeconds.minimum,
        maximum: profile.sceneDurationSeconds.maximum
      },
      kicker: { type: "string" },
      title: { type: "string" },
      statement: { type: "string" },
      subtitle: { type: "string" },
      label: { type: "string" },
      assetHint: { type: "string" },
      subtitleLines: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: closedObject({
          text: { type: "string" },
          weight: { type: "number", minimum: 0.1, maximum: 10 }
        })
      }
    })
  },
  assetChecklist: { type: "array", items: { type: "string" } }
});
}

const assetPlanSchema = closedObject({
  visualSystem: { type: "string" },
  items: {
    type: "array",
    minItems: 1,
    maxItems: 80,
    items: closedObject({
      id: { type: "string" },
      assetType: {
        type: "string",
        enum: [
          "screenshot",
          "screen-recording",
          "diagram",
          "generated-image",
          "generated-video",
          "stock",
          "voice",
          "music"
        ]
      },
      purpose: { type: "string" },
      sceneIds: { type: "array", items: { type: "string" } },
      sourceRequirement: { type: "string" },
      rightsRequirement: { type: "string" },
      required: { type: "boolean" },
      productionMethod: closedObject({
        kind: {
          type: "string",
          enum: [
            "local-code-animation",
            "human-capture",
            "licensed-stock",
            "external-image-generation",
            "external-video-generation",
            "deferred-voice-agent"
          ]
        },
        executor: { type: "string" },
        externalProvider: { anyOf: [{ type: "string" }, { type: "null" }] },
        externalModel: { anyOf: [{ type: "string" }, { type: "null" }] },
        notes: { type: "string" }
      }),
      estimatedCost: closedObject({
        currency: { type: "string", enum: ["USD"] },
        unitCount: { type: "number", minimum: 0 },
        unitPriceUsd: { type: "number", minimum: 0 },
        maximumCostUsd: { type: "number", minimum: 0 },
        pricingStatus: { type: "string", enum: ["confirmed", "unconfirmed", "not-applicable"] },
        pricingSource: { type: "string" },
        pricingCheckedAt: { anyOf: [{ type: "string" }, { type: "null" }] }
      })
    })
  },
  voiceDirection: closedObject({
    tone: { type: "string" },
    pacing: { type: "string" },
    pronunciationNotes: { type: "array", items: { type: "string" } }
  }),
  executionPolicy: closedObject({
    mode: { type: "string", enum: ["local-only", "mixed", "external-generation"] },
    costScope: { type: "string", enum: ["external-api-only"] },
      externalApiCalls: {
        type: "array",
        items: closedObject({
        id: { type: "string" },
        providerId: { type: "string" },
        model: { type: "string" },
        purpose: { type: "string" },
        sceneIds: { type: "array", minItems: 1, items: { type: "string" } },
          estimatedCalls: { type: "integer", minimum: 1 },
          maximumCostUsd: { type: "number", minimum: 0 },
          pricingSource: { type: "string" },
          pricingCheckedAt: { type: "string" },
          endpoint: { type: "string" },
          prompt: { type: "string" },
          outputSpec: { type: "string" }
        })
      },
    maximumPaidCostUsd: { type: "number", minimum: 0 },
    currency: { type: "string", enum: ["USD"] },
    pricingConfirmed: { type: "boolean" },
    humanApprovalRequiredBeforeExecution: { type: "boolean" },
    invalidatesOnPlanChange: { type: "boolean" }
  }),
  risks: { type: "array", items: { type: "string" } }
});

const subtitleSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
const leadingClosingPunctuation = /^[，。！？；：、）》】,.!?;:)\]]/u;
const trailingOpeningPunctuation = /[（《【(\[]$/u;

function textLength(value) {
  return Array.from(String(value ?? "")).length;
}

export function splitSubtitleText(value, maximumCharacters = 24) {
  const source = String(value ?? "");
  const tokens = [...subtitleSegmenter.segment(source)].map((item) => item.segment);
  const chunks = [];
  let current = "";
  for (const token of tokens) {
    const closingPunctuation = leadingClosingPunctuation.test(token.trimStart());
    if (
      current &&
      !closingPunctuation &&
      textLength(current) + textLength(token) > maximumCharacters
    ) {
      if (current.trim()) chunks.push(current);
      current = token;
      continue;
    }
    current += token;
  }
  if (current.trim()) chunks.push(current);
  return chunks.length > 0 ? chunks : ["待补充"];
}

export function splitTextNearMiddle(value) {
  const source = String(value ?? "");
  if (!source) return ["", ""];
  const midpoint = source.length / 2;
  const boundaries = [...subtitleSegmenter.segment(source)]
    .map((item) => item.index)
    .filter((index) => {
      if (index <= 0 || index >= source.length) return false;
      return !leadingClosingPunctuation.test(source.slice(index).trimStart())
        && !trailingOpeningPunctuation.test(source.slice(0, index).trimEnd());
    });
  const boundary = boundaries.length > 0
    ? boundaries.reduce(
        (best, candidate) => Math.abs(candidate - midpoint) < Math.abs(best - midpoint)
          ? candidate
          : best,
        boundaries[0]
      )
    : Math.ceil(midpoint);
  return [source.slice(0, boundary), source.slice(boundary)];
}

function episodeContext(episode) {
  return {
    id: episode.id,
    title: episode.title,
    concept: episode.concept,
    audience: episode.audience,
    thesis: episode.thesis,
    sourceDocs: (episode.sourceDocs ?? []).map((source) => source.path),
    researchReadiness: episode.research?.readiness ?? null,
    trendSelection: episode.trendSelection ?? null,
    productionProfile: episode.productionProfile ?? null,
    derivation: episode.derivation
      ? {
          kind: episode.derivation.kind,
          parentEpisodeId: episode.derivation.parentEpisodeId,
          parentScriptVersion: episode.derivation.parentScriptVersion,
          parentScriptArtifactHash: episode.derivation.parentScriptArtifactHash,
          sourceSectionIds: episode.derivation.sourceSectionIds,
          sourceSections: episode.derivation.sourceSections,
          constraints: episode.derivation.constraints,
          sourceSnapshotHash: episode.derivation.sourceSnapshotHash
        }
      : null
  };
}

function routingContext(episode, capabilityOperation) {
  return {
    episodeId: episode.id,
    control: episode.control,
    persistBudget: true,
    ...(capabilityOperation ? { capabilityOperation } : {})
  };
}

function requireGeneratorSideEffects(episode, options, input) {
  const explicitlyRequired = options.requireSideEffectCapability === true;
  const usesDefaultModel = input.usesModel &&
    (explicitlyRequired || options.client === undefined);
  const usesDefaultArtifactWriter = explicitlyRequired ||
    options.writeArtifact === undefined;
  if (!usesDefaultModel && !usesDefaultArtifactWriter) return null;
  if (!options.sideEffectGrant && typeof options.authorizeSideEffect !== "function") {
    throw new SideEffectAuthorizationError(
      "缺少服务端签发的副作用 Capability",
      "side_effect_capability_missing",
      {},
      403
    );
  }
  const scopes = new Set();
  if (usesDefaultArtifactWriter) scopes.add("filesystem.write");
  let maxCalls = 0;
  let maxCostUsd = 0;
  if (usesDefaultModel) {
    scopes.add("model.invoke");
    scopes.add("network.request");
    scopes.add("paid.invoke");
    const budget = episode.control?.budget;
    if (!Number.isInteger(budget?.maxCalls) || !Number.isFinite(budget?.maxCostUsd)) {
      throw new SideEffectAuthorizationError(
        "真实模型生成必须先配置有限的调用次数和费用预算",
        "side_effect_capability_budget_unbounded",
        {},
        403
      );
    }
    maxCalls = 1;
    maxCostUsd = Number((
      budget.maxCostUsd
      - (budget.usedCostUsd ?? 0)
      - (budget.reservedCostUsd ?? 0)
    ).toFixed(6));
    const remainingCalls = budget.maxCalls
      - (budget.usedCalls ?? 0)
      - (budget.reservedCalls ?? 0);
    if (remainingCalls < 1 || maxCostUsd <= 0) {
      throw new SideEffectAuthorizationError(
        "真实模型生成的调用次数或费用预算已经耗尽",
        "side_effect_capability_budget_exhausted",
        {},
        403
      );
    }
  }
  return requireSideEffectGrant(options, {
    episodeId: episode.id,
    operation: options.capabilityOperation ?? input.operation,
    scopes: [...scopes],
    maxCalls,
    maxCostUsd
  });
}

function generationReviewFeedback(episode, gate, explicitFeedback) {
  if (Array.isArray(explicitFeedback) && explicitFeedback.length > 0) {
    return structuredClone(explicitFeedback);
  }
  if (typeof explicitFeedback === "string" && explicitFeedback.trim()) {
    return explicitFeedback.trim();
  }
  return latestReviewFeedback(episode, gate) || null;
}

async function nextRequestCount(episode) {
  const config = await readAiConfig();
  const current = episode.production?.ai?.requestCount ?? 0;
  if (current >= config.request.maxRequestsPerEpisode) {
    throw new Error(
      `本期已达到 ${config.request.maxRequestsPerEpisode} 次 AI 生成上限，请人工复核后再调整预算`
    );
  }
  return current + 1;
}

export async function generateScriptDraft(episode, options = {}) {
  const profile = productionProfileForEpisode(episode);
  const writeArtifact = options.writeArtifact ?? writeVersionedArtifact;
  const deterministic = episode.derivation?.kind === "approved-script-section-v1";
  const capabilityOperation = options.capabilityOperation ?? "generator:script";
  const sideEffectGrant = requireGeneratorSideEffects(episode, options, {
    operation: "generator:script",
    usesModel: !deterministic
  });
  if (deterministic) {
    const value = adaptApprovedSourceToShortScript(episode);
    const requestCount = episode.production?.ai?.requestCount ?? 0;
    const generatedAt = new Date().toISOString();
    const result = {
      provider: "deterministic-local",
      model: APPROVED_SOURCE_SHORT_SCRIPT_ADAPTER_VERSION,
      responseId: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      attempts: [],
      value,
      generationKind: "deterministic-approved-source-adapter",
      sourceSnapshotHash: episode.derivation.sourceSnapshotHash
    };
    const artifact = await writeArtifact(episode.id, "script-draft", {
      generatedAt,
      episodeId: episode.id,
      provider: result.provider,
      model: result.model,
      generationKind: result.generationKind,
      sourceSnapshotHash: result.sourceSnapshotHash,
      usage: result.usage,
      attempts: result.attempts,
      draft: result.value
    });
    return { ...result, artifact, requestCount };
  }

  const requestCount = await nextRequestCount(episode);
  const client = options.client ?? (await createAiClient({
    sideEffectGrant,
    capabilityOperation,
    requireSideEffectCapability: true
  }));
  const result = await client.generateStructured("script", {
    schemaName: "episode_script_draft",
    schema: scriptSchemaForProfile(profile),
    instructions:
      `你是中文 AI 概念视频的资深主编。只使用输入中已登记的证据，不得编造事实、来源、数字或引语。${profile.scriptInstruction}。每一节都要说明证据引用；没有证据的内容必须进入 factCheckNotes。输出将由机器审核和人类审批，不能自行视为定稿。`,
    input: JSON.stringify({
      episode: episodeContext(episode),
      reviewFeedback: generationReviewFeedback(episode, "script", options.reviewFeedback)
    }),
    taskProfile: options.taskProfile,
    routingContext: routingContext(episode, capabilityOperation),
    maxOutputTokens: profile.maximumScriptTokens
  });
  const artifact = await writeArtifact(episode.id, "script-draft", {
    generatedAt: new Date().toISOString(),
    episodeId: episode.id,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
    attempts: result.attempts,
    draft: result.value
  });
  return { ...result, artifact, requestCount };
}

function buildTimeline(draft, profile) {
  const target = Math.max(
    profile.targetDurationSeconds.minimum,
    Math.min(profile.targetDurationSeconds.maximum, draft.targetDurationSeconds)
  );
  const rawTotal = draft.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  let cursor = 0;
  let rawCursor = 0;
  const scenes = [];
  const subtitles = [];
  draft.scenes.forEach((scene, index) => {
    const isLast = index === draft.scenes.length - 1;
    rawCursor += scene.durationSeconds;
    const end = isLast ? target : Number(((rawCursor / rawTotal) * target).toFixed(3));
    const id = `S${String(index + 1).padStart(2, "0")}`;
    scenes.push({
      id,
      start: cursor,
      end,
      type: scene.type,
      kicker: scene.kicker,
      title: scene.title,
      statement: scene.statement,
      subtitle: scene.subtitle,
      label: scene.label,
      assetHint: scene.assetHint
    });

    const weights = scene.subtitleLines.map((line) => line.weight);
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let subtitleCursor = cursor;
    scene.subtitleLines.forEach((line, lineIndex) => {
      const lineIsLast = lineIndex === scene.subtitleLines.length - 1;
      const lineEnd = lineIsLast
        ? end
        : Math.min(end, subtitleCursor + ((end - cursor) * line.weight) / weightTotal);
      subtitles.push({
        start: Number(subtitleCursor.toFixed(3)),
        end: Number(lineEnd.toFixed(3)),
        text: line.text
      });
      subtitleCursor = lineEnd;
    });
    cursor = end;
  });
  return { scenes, subtitles, durationSeconds: target };
}

export async function generateStoryboardDraft(episode, options = {}) {
  const profile = productionProfileForEpisode(episode);
  const writeArtifact = options.writeArtifact ?? writeVersionedArtifact;
  const deterministic = episode.derivation?.kind === "approved-script-section-v1";
  const capabilityOperation = options.capabilityOperation ?? "generator:storyboard";
  const sideEffectGrant = requireGeneratorSideEffects(episode, options, {
    operation: "generator:storyboard",
    usesModel: !deterministic
  });
  if (deterministic) {
    const value = adaptApprovedScriptToShortStoryboard(episode);
    const requestCount = episode.production?.ai?.requestCount ?? 0;
    const generatedAt = new Date().toISOString();
    const result = {
      provider: "deterministic-local",
      model: APPROVED_SCRIPT_SHORT_STORYBOARD_ADAPTER_VERSION,
      responseId: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      attempts: [],
      value,
      generationKind: "deterministic-approved-script-storyboard-adapter",
      sourceSnapshotHash: episode.derivation.sourceSnapshotHash,
      sourceScriptVersion: value.sourceScript.version,
      sourceScriptArtifactHash: value.sourceScript.artifactHash,
      sourceScriptReviewReportId: value.sourceScript.reviewReportId
    };
    const timeline = buildTimeline(value, profile);
    const artifact = await writeArtifact(episode.id, "storyboard-draft", {
      generatedAt,
      episodeId: episode.id,
      provider: result.provider,
      model: result.model,
      generationKind: result.generationKind,
      sourceSnapshotHash: result.sourceSnapshotHash,
      sourceScript: value.sourceScript,
      usage: result.usage,
      attempts: result.attempts,
      draft: result.value,
      timeline
    });
    return { ...result, artifact, timeline, requestCount };
  }

  const requestCount = await nextRequestCount(episode);
  const scriptDraft = await readApprovedScriptInput(episode);
  const client = options.client ?? (await createAiClient({
    sideEffectGrant,
    capabilityOperation,
    requireSideEffectCapability: true
  }));
  const result = await client.generateStructured("storyboard", {
    schemaName: "episode_storyboard_draft",
    schema: storyboardSchemaForProfile(profile),
    instructions:
      `你是中文竖屏视频的分镜导演。${profile.storyboardInstruction}。必须包含 title、evidence、statement、summary 场景；证据场景写清素材提示和来源标签。字幕需拆成适合阅读的短句，不得声称素材已经存在。输出仍需机器审核与人类视觉审批。`,
    input: JSON.stringify({
      episode: episodeContext(episode),
      script: scriptDraft,
      reviewFeedback: generationReviewFeedback(
        episode,
        "storyboard",
        options.reviewFeedback
      )
    }),
    taskProfile: options.taskProfile,
    routingContext: routingContext(episode, capabilityOperation),
    maxOutputTokens: profile.maximumStoryboardTokens
  });
  const timeline = buildTimeline(result.value, profile);
  const artifact = await writeArtifact(episode.id, "storyboard-draft", {
    generatedAt: new Date().toISOString(),
    episodeId: episode.id,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
    attempts: result.attempts,
    draft: result.value,
    timeline
  });
  return { ...result, artifact, timeline, requestCount };
}

export async function readApprovedScriptInput(episode) {
  const draft = episode.production?.scriptDraft;
  if (draft?.content) return draft.content;
  const sourcePath = draft?.source ?? draft?.artifactPath;
  if (!sourcePath) throw new Error("缺少已批准的脚本内容或脚本文件");
  const absolutePath = ensureInside(workspaceRoot, resolve(workspaceRoot, sourcePath));
  const body = await readFile(absolutePath, "utf8");
  if (sourcePath.endsWith(".json")) {
    const document = JSON.parse(body);
    return document.draft ?? document.content ?? document;
  }
  return { format: "markdown", source: sourcePath, content: body };
}

export async function generateAssetPlan(episode, options = {}) {
  if (!episode.production?.storyboardDraft && (episode.scenes?.length ?? 0) === 0) {
    throw new Error("缺少已批准的分镜，不能生成素材清单");
  }
  const writeArtifact = options.writeArtifact ?? writeVersionedArtifact;
  const deterministic = episode.derivation?.kind === "approved-script-section-v1";
  const capabilityOperation = options.capabilityOperation ?? "generator:assets";
  const sideEffectGrant = requireGeneratorSideEffects(episode, options, {
    operation: "generator:assets",
    usesModel: !deterministic
  });
  if (deterministic) {
    const value = adaptApprovedStoryboardToShortAssetPlan(episode);
    const result = {
      provider: "deterministic-local",
      model: APPROVED_STORYBOARD_SHORT_ASSET_ADAPTER_VERSION,
      generationKind: "deterministic-approved-storyboard-asset-plan-adapter",
      sourceStoryboardVersion: value.sourceStoryboard.version,
      sourceStoryboardArtifactHash: value.sourceStoryboard.artifactHash,
      sourceStoryboardReviewReportId: value.sourceStoryboard.reviewReportId,
      responseId: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      attempts: [],
      value
    };
    const artifact = await writeArtifact(episode.id, "asset-plan", {
      generatedAt: new Date().toISOString(),
      episodeId: episode.id,
      provider: result.provider,
      model: result.model,
      generationKind: result.generationKind,
      sourceStoryboard: value.sourceStoryboard,
      usage: result.usage,
      attempts: result.attempts,
      plan: value
    });
    return {
      ...result,
      artifact,
      requestCount: episode.production?.ai?.requestCount ?? 0
    };
  }

  const requestCount = await nextRequestCount(episode);
  const client = options.client ?? (await createAiClient({
    sideEffectGrant,
    capabilityOperation,
    requireSideEffectCapability: true
  }));
  const result = await client.generateStructured("assets", {
    schemaName: "episode_asset_plan",
    schema: assetPlanSchema,
    instructions:
      "你是 AI 知识视频的素材制片。为已批准分镜建立逐项素材清单。真实产品界面、操作结果和证据画面必须来自真实截图或录屏，禁止用生成式 UI 冒充；概念图解可以使用浅色技术图。沿用已锁定的视觉系统，不重新设计风格。每项必须写清来源、版权、对应场景、制作方式和费用上限；任何外部生成调用必须登记 Provider、模型、端点、完整提示词、输出尺寸/格式/时长、调用次数、价格来源和最大费用。生成提示词必须明确禁止模型生成文字、品牌、Logo、真实产品 UI 和截图，概念标签与事实关系由本地代码叠加。价格未确认时不得标记 pricingConfirmed；输出只是一份待机器审核与人工批准的方案，不得执行素材生成。",
    input: JSON.stringify({
      episode: episodeContext(episode),
      scenes: episode.scenes,
      existingAssets: episode.assets,
      reviewFeedback: generationReviewFeedback(episode, "assets", options.reviewFeedback)
    }),
    taskProfile: options.taskProfile,
    routingContext: routingContext(episode, capabilityOperation),
    maxOutputTokens: 6000
  });
  const sourceStoryboard = {
    version: episode.approvals.storyboard.currentVersion,
    artifactHash: episode.approvals.storyboard.artifactHash,
    reviewReportId: episode.approvals.storyboard.reviewReportId
  };
  const value = {
    ...result.value,
    visualRules: [...(episode.production?.storyboardDraft?.visualRules ?? [])],
    sourceStoryboard
  };
  const artifact = await writeArtifact(episode.id, "asset-plan", {
    generatedAt: new Date().toISOString(),
    episodeId: episode.id,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
    attempts: result.attempts,
    sourceStoryboard,
    plan: value
  });
  return {
    ...result,
    value,
    sourceStoryboardVersion: sourceStoryboard.version,
    sourceStoryboardArtifactHash: sourceStoryboard.artifactHash,
    sourceStoryboardReviewReportId: sourceStoryboard.reviewReportId,
    artifact,
    requestCount
  };
}

export async function createVoicePlan(episode, options = {}) {
  requireGeneratorSideEffects(episode, options, {
    operation: "generator:voice-plan",
    usesModel: false
  });
  const writeArtifact = options.writeArtifact ?? writeVersionedArtifact;
  const artifact = await writeArtifact(episode.id, "voice-plan", {
    generatedAt: new Date().toISOString(),
    episodeId: episode.id,
    durationSeconds: episode.render?.durationSeconds ?? 0,
    narration: (episode.subtitles ?? []).map((subtitle) => subtitle.text).join("\n"),
    choices: [
      { id: "self-recorded", label: "本人录音", requiresConsent: false },
      { id: "licensed-clone", label: "授权音色", requiresConsent: true },
      { id: "generic-natural", label: "通用自然音色", requiresConsent: false }
    ],
    note: "这里只生成配音清单，不会在未审批时合成或克隆声音。"
  });
  return artifact;
}
