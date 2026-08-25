import { GOLDEN_M1_PROFILE_ID } from "../../shared/production-profiles.mjs";

export const GOLDEN_M1_EPISODE_ID = "golden-001";
export const GOLDEN_M1_DURATION_SECONDS = 36;

const evidenceByScene = Object.freeze({
  S02: "demo-baseline-export-failed",
  S04: "demo-viewer-denied",
  S05: "demo-admin-export-complete"
});

const claimsByScene = Object.freeze({
  S01: ["C01"],
  S02: ["C09"],
  S03: ["C01", "C03"],
  S04: ["C06"],
  S05: ["C05", "C09"],
  S06: ["C01", "C10"]
});

function invalid(message) {
  const error = new Error(`golden-001 36 秒结构无效：${message}`);
  error.code = "golden_m1_structure_invalid";
  throw error;
}

export function goldenM1ProductionProfile() {
  return {
    id: GOLDEN_M1_PROFILE_ID,
    targetDurationSeconds: GOLDEN_M1_DURATION_SECONDS
  };
}

export function buildGoldenM1ResearchCandidate(sourceDocs = []) {
  const registeredSources = Array.isArray(sourceDocs) ? sourceDocs.length : 0;
  return {
    status: "ready_for_fact_approval",
    version: 1,
    versions: [],
    packPath: null,
    assistTaskPath: null,
    generationKind: "deterministic-golden-m1-fixed-evidence",
    evidenceSource: "episodes/golden-001/03-claim-ledger.md",
    readiness: {
      readyForFactApproval: registeredSources >= 2,
      verifiedSourceCount: registeredSources,
      supportedClaimCount: 10,
      reasons: registeredSources >= 2 ? [] : ["固定研究来源登记不足"]
    },
    needsRevision: false
  };
}

export function bindGoldenM1LogicalEvidence(scenes = []) {
  if (!Array.isArray(scenes) || scenes.length !== 6) invalid("必须恰好有六个场景");
  const ids = new Set(scenes.map((scene) => scene?.id));
  for (const id of ["S01", "S02", "S03", "S04", "S05", "S06"]) {
    if (!ids.has(id)) invalid(`缺少场景 ${id}`);
  }
  return scenes.map((scene) => {
    const expectedEvidence = evidenceByScene[scene.id] ?? null;
    if (!expectedEvidence) return { ...scene };
    return { ...scene, evidenceRef: expectedEvidence };
  });
}

export function buildGoldenM1ScriptContent(scenes = [], subtitles = []) {
  const boundScenes = bindGoldenM1LogicalEvidence(scenes);
  if (!Array.isArray(subtitles) || subtitles.length !== boundScenes.length) {
    invalid("六个场景必须逐一对应六段旁白");
  }
  const sections = boundScenes.map((scene, index) => {
    const subtitle = subtitles[index];
    if (
      !subtitle
      || subtitle.start !== scene.start
      || subtitle.end !== scene.end
      || typeof subtitle.text !== "string"
      || !subtitle.text.trim()
    ) {
      invalid(`${scene.id} 的旁白与场景时间轴不一致`);
    }
    return {
      id: scene.id,
      start: scene.start,
      end: scene.end,
      narration: subtitle.text,
      evidenceRefs: [...(claimsByScene[scene.id] ?? [])]
    };
  });
  return {
    schemaVersion: 1,
    kind: "golden-m1-short-script-v1",
    targetDurationSeconds: GOLDEN_M1_DURATION_SECONDS,
    sections,
    evidenceSource: "episodes/golden-001/03-claim-ledger.md"
  };
}

export function buildGoldenM1ScriptDraft(scenes = [], subtitles = []) {
  return {
    version: 1,
    generationKind: "deterministic-golden-m1-short-script",
    referenceSource: "episodes/golden-001/07-script.md",
    content: buildGoldenM1ScriptContent(scenes, subtitles)
  };
}

export function buildGoldenM1StoryboardDraft() {
  return {
    version: 1,
    generationKind: "deterministic-golden-m1-structure",
    sourceKind: "episode-scenes-subtitles-render-v1",
    referenceSource: "episodes/golden-001/08-storyboard.md"
  };
}
