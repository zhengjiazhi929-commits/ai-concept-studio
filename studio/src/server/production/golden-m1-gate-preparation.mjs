import { approvalValidForGate } from "../control/policy-engine.mjs";
import { currentGateArtifactHash, prepareGateForHumanReview } from "../../shared/workflow.mjs";
import { isDeepStrictEqual } from "node:util";
import {
  bindGoldenM1LogicalEvidence,
  buildGoldenM1ResearchCandidate,
  buildGoldenM1ScriptDraft,
  buildGoldenM1StoryboardDraft,
  GOLDEN_M1_EPISODE_ID,
  goldenM1ProductionProfile
} from "./golden-m1-structure.mjs";

const UPSTREAM_GATES = Object.freeze(["research", "script", "storyboard"]);

function fail(message, code = "golden_m1_gate_preparation_invalid") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isLegacyImportedDraft(draft = {}) {
  return !draft.content
    && !draft.generationKind
    && Object.keys(draft).every((key) => ["version", "source", "needsRevision"].includes(key));
}

function migrateDraft(current, expected, label) {
  if (same(current, expected)) return structuredClone(current);
  if (!isLegacyImportedDraft(current)) {
    fail(
      `${label} 已不是可自动迁移的 legacy import，拒绝覆盖当前候选`,
      "golden_m1_existing_candidate_conflict"
    );
  }
  return structuredClone(expected);
}

function isUpgradeableResearchCandidate(current = {}, expected = {}) {
  const legacyCandidate = structuredClone(expected);
  delete legacyCandidate.content;
  legacyCandidate.readiness.supportedClaimCount = 10;
  return isDeepStrictEqual(current, legacyCandidate);
}

function hasPristinePendingResearchApproval(episode, expectedVersion) {
  const approval = episode.approvals?.research;
  if (!approval) return false;
  const expectedApproval = {
    status: "pending",
    at: null,
    note: "",
    feedback: "",
    currentVersion: expectedVersion,
    history: [],
    provenance: null,
    reviewReportId: null,
    artifactHash: null
  };
  const allowedSystemHistory = new Set([
    "approval-binding-invalidated",
    "review-recheck"
  ]);
  const hasNonSystemResearchHistory = (episode.history ?? []).some(
    (entry) => entry.gate === "research" && !allowedSystemHistory.has(entry.type)
  );
  return isDeepStrictEqual(approval, expectedApproval)
    && episode.production?.feedback?.research == null
    && !(episode.approvalHistory ?? []).some((entry) => entry.gate === "research")
    && !hasNonSystemResearchHistory;
}

export function prepareGoldenM1UpstreamGate(sourceEpisode, options = {}) {
  if (sourceEpisode?.id !== GOLDEN_M1_EPISODE_ID) {
    fail(`只允许处理 ${GOLDEN_M1_EPISODE_ID}`);
  }
  const episode = structuredClone(sourceEpisode);
  const before = {
    research: structuredClone(episode.research ?? null),
    productionProfile: structuredClone(episode.productionProfile ?? null),
    scriptDraft: structuredClone(episode.production?.scriptDraft ?? null),
    storyboardDraft: structuredClone(episode.production?.storyboardDraft ?? null),
    scenes: structuredClone(episode.scenes ?? []),
    trustedFixture: episode.system?.trustedFixture ?? null
  };

  const scenes = bindGoldenM1LogicalEvidence(episode.scenes ?? []);
  const scriptDraft = buildGoldenM1ScriptDraft(scenes, episode.subtitles ?? []);
  const storyboardDraft = buildGoldenM1StoryboardDraft();
  const researchCandidate = buildGoldenM1ResearchCandidate(episode.sourceDocs ?? []);
  if (!episode.research || Object.keys(episode.research).length === 0) {
    episode.research = researchCandidate;
  } else if (!same(episode.research, researchCandidate)) {
    if (
      !isUpgradeableResearchCandidate(episode.research, researchCandidate)
      || !hasPristinePendingResearchApproval(episode, researchCandidate.version)
    ) {
      fail(
        "研究候选已不是可自动迁移的旧版确定性候选，拒绝覆盖当前候选",
        "golden_m1_existing_research_conflict"
      );
    }
    episode.research = researchCandidate;
  }
  episode.production = {
    ...(episode.production ?? {}),
    scriptDraft: migrateDraft(episode.production?.scriptDraft ?? {}, scriptDraft, "短脚本"),
    storyboardDraft: migrateDraft(
      episode.production?.storyboardDraft ?? {},
      storyboardDraft,
      "36 秒分镜"
    )
  };
  episode.productionProfile = goldenM1ProductionProfile();
  episode.scenes = scenes;
  episode.system = {
    ...(episode.system ?? {}),
    trustedFixture: false,
    legacyTrustedApprovalBypassDisabled: true
  };

  const after = {
    research: structuredClone(episode.research),
    productionProfile: structuredClone(episode.productionProfile),
    scriptDraft: structuredClone(episode.production.scriptDraft),
    storyboardDraft: structuredClone(episode.production.storyboardDraft),
    scenes: structuredClone(episode.scenes),
    trustedFixture: episode.system.trustedFixture
  };
  const contentChanged = !same(before, after);
  const nextGate = UPSTREAM_GATES.find((gate) => !approvalValidForGate(episode, gate)) ?? null;
  if (!nextGate) {
    return {
      episode,
      changed: contentChanged,
      contentChanged,
      gatePreparationChanged: false,
      nextGate: null,
      hashes: Object.fromEntries(
        UPSTREAM_GATES.map((gate) => [gate, currentGateArtifactHash(episode, gate)])
      )
    };
  }

  const prepared = prepareGateForHumanReview(episode, {
    gate: nextGate,
    reason:
      nextGate === "script"
        ? "36 秒 M1 脚本已改为正文级结构化绑定，等待机器审核与 Zhengjiazhi 确认"
        : nextGate === "storyboard"
          ? "36 秒 M1 分镜已绑定可见编号和逻辑证据，等待机器审核与 Zhengjiazhi 确认"
          : "Golden seed 不再自动批准研究内容，等待机器审核与 Zhengjiazhi 确认",
    now: options.now
  });
  return {
    episode: prepared.episode,
    changed: contentChanged || prepared.changed,
    contentChanged,
    gatePreparationChanged: prepared.changed,
    nextGate,
    hashes: Object.fromEntries(
      UPSTREAM_GATES.map((gate) => [gate, currentGateArtifactHash(prepared.episode, gate)])
    )
  };
}
