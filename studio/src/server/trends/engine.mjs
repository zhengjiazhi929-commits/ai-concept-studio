import { normalizeSearchText } from "./schema.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 0) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function ageInDays(signal, now) {
  const timestamp = Date.parse(signal.publishedAt || signal.observedAt);
  return (now.getTime() - timestamp) / DAY_MS;
}

function inWindow(signal, now, days) {
  const age = ageInDays(signal, now);
  return age >= -1 && age <= days;
}

export function inferConceptIds(signal, taxonomy) {
  if (Array.isArray(signal.conceptIds) && signal.conceptIds.length > 0) {
    return Array.from(new Set(signal.conceptIds));
  }
  const haystack = normalizeSearchText(
    [signal.title, signal.notes, ...(signal.tags ?? [])].filter(Boolean).join(" ")
  );
  return taxonomy.concepts
    .filter((concept) =>
      concept.aliases.some((alias) => haystack.includes(normalizeSearchText(alias)))
    )
    .map((concept) => concept.id);
}

function relativePerformance(signal, creator) {
  if (Number.isFinite(signal.relativePerformance)) return signal.relativePerformance;
  const views = signal.metrics?.views;
  const medianViews = creator.baselineMetrics?.medianViews;
  if (Number.isFinite(views) && Number.isFinite(medianViews) && medianViews > 0) {
    return views / medianViews;
  }
  return null;
}

function questionDensity(signal) {
  if (Number.isFinite(signal.questionDensity)) return signal.questionDensity;
  const questions = signal.metrics?.questionComments;
  const comments = signal.metrics?.comments;
  if (Number.isFinite(questions) && Number.isFinite(comments) && comments > 0) {
    return questions / comments;
  }
  return null;
}

function precisionWeight(signal) {
  if (signal.datePrecision === "page-date") return 1;
  if (signal.datePrecision === "relative-day-estimate") return 0.8;
  if (signal.datePrecision === "observation-window") return 0.55;
  return 0.7;
}

function creatorCoverage(signals, sourceMap, now, days) {
  const groups = new Map();
  for (const signal of signals.filter((item) => inWindow(item, now, days))) {
    const creator = sourceMap.get(signal.creatorId);
    if (!creator || creator.enabled === false) continue;
    const key = creator.coverageGroup || creator.id;
    const current = groups.get(key);
    if (!current || creator.weight > current.weight) {
      groups.set(key, {
        id: creator.id,
        coverageGroup: key,
        name: creator.name,
        platform: creator.platform,
        category: creator.category,
        weight: creator.weight,
        audienceFit: creator.audienceFit
      });
    }
  }
  return Array.from(groups.values());
}

function buildScore({ signals, creators30, creators14, sourceMap, now, config }) {
  const weights = config.scoreWeights;
  const weightedCreators = creators30.reduce((total, creator) => total + creator.weight, 0);
  const platforms = new Set(creators30.map((creator) => creator.platform));
  const signals14 = signals.filter((signal) => inWindow(signal, now, config.windows.primaryDays));

  const coverageScore = clamp(
    round(
      Math.min(1, weightedCreators / config.hardGates.extendedCreatorCount) * 28 +
        Math.min(1, Math.max(0, platforms.size - 1)) * 4 +
        Math.min(1, signals14.length / 6) * 3
    ),
    0,
    weights.creatorCoverage
  );
  const audienceFit = creators30.length
    ? creators30.reduce((total, creator) => total + creator.audienceFit, 0) / creators30.length
    : 0;
  const audienceScore = round(audienceFit * weights.audienceFit);
  const velocityScore = round(
    Math.min(1, signals14.length / Math.max(3, creators14.length * 1.25)) * weights.velocity
  );

  const performanceValues = [];
  const questionValues = [];
  for (const signal of signals.filter((item) => inWindow(item, now, config.windows.extendedDays))) {
    const creator = sourceMap.get(signal.creatorId);
    const performance = relativePerformance(signal, creator ?? {});
    const density = questionDensity(signal);
    if (Number.isFinite(performance)) performanceValues.push(performance);
    if (Number.isFinite(density)) questionValues.push(density);
  }

  const performanceScore = performanceValues.length
    ? round(
        clamp(
          (performanceValues.reduce((total, value) => total + Math.min(value, 2.5), 0) /
            performanceValues.length /
            2) *
            weights.relativePerformance,
          0,
          weights.relativePerformance
        )
      )
    : null;
  const questionScore = questionValues.length
    ? round(
        clamp(
          (questionValues.reduce((total, value) => total + value, 0) / questionValues.length / 0.3) *
            weights.questionDensity,
          0,
          weights.questionDensity
        )
      )
    : null;

  const components = {
    creatorCoverage: { score: coverageScore, max: weights.creatorCoverage, available: true },
    audienceFit: { score: audienceScore, max: weights.audienceFit, available: true },
    relativePerformance: {
      score: performanceScore,
      max: weights.relativePerformance,
      available: performanceScore !== null
    },
    velocity: { score: velocityScore, max: weights.velocity, available: true },
    questionDensity: {
      score: questionScore,
      max: weights.questionDensity,
      available: questionScore !== null
    }
  };
  const available = Object.values(components).filter((item) => item.available);
  const earned = available.reduce((total, item) => total + item.score, 0);
  const possible = available.reduce((total, item) => total + item.max, 0);
  return {
    score: possible > 0 ? round((earned / possible) * 100) : 0,
    rawScore: earned,
    availablePoints: possible,
    components,
    metricsCoverage: round(possible / 100, 2),
    performanceSampleCount: performanceValues.length,
    questionSampleCount: questionValues.length
  };
}

function conceptIndependence(concept) {
  const checks = [
    { id: "brand-independent", passed: concept.brandIndependent === true },
    { id: "cross-product-examples", passed: (concept.crossProductExamples?.length ?? 0) >= 2 },
    { id: "product-decisions", passed: (concept.productDecisions?.length ?? 0) >= 2 },
    { id: "primary-source-plan", passed: (concept.primarySources?.length ?? 0) >= 1 }
  ];
  return { passed: checks.every((check) => check.passed), checks };
}

function confidenceLevel(score, signals) {
  const precision = signals.length
    ? signals.reduce((total, signal) => total + precisionWeight(signal), 0) / signals.length
    : 0;
  const combined = score.metricsCoverage * 0.55 + precision * 0.45;
  return {
    level: combined >= 0.82 ? "high" : combined >= 0.58 ? "medium" : "low",
    value: round(combined, 2),
    datePrecision: round(precision, 2)
  };
}

function candidatePool({ hardGatePassed, fastGatePassed, independence, eventDominated, score, config }) {
  if (
    hardGatePassed &&
    independence.passed &&
    !eventDominated &&
    score.score >= config.thresholds.formalCandidate
  ) {
    return "formal_candidate";
  }
  if (
    (hardGatePassed || fastGatePassed) &&
    independence.passed &&
    score.score >= config.thresholds.continueWatching
  ) {
    return "continue_watching";
  }
  return "observation_pool";
}

function buildCandidate(concept, signals, sourceMap, config, now) {
  const recentSignals = signals.filter((signal) =>
    inWindow(signal, now, config.windows.extendedDays)
  );
  const creators7 = creatorCoverage(recentSignals, sourceMap, now, config.windows.fastDays);
  const creators14 = creatorCoverage(recentSignals, sourceMap, now, config.windows.primaryDays);
  const creators30 = creatorCoverage(recentSignals, sourceMap, now, config.windows.extendedDays);
  const hardGate14 = creators14.length >= config.hardGates.primaryCreatorCount;
  const hardGate30 = creators30.length >= config.hardGates.extendedCreatorCount;
  const strongPerformanceCreatorGroups = new Set();
  for (const signal of recentSignals.filter((item) => inWindow(item, now, config.windows.fastDays))) {
    const creator = sourceMap.get(signal.creatorId);
    if (
      creator &&
      (relativePerformance(signal, creator) ?? 0) >= config.hardGates.fastRelativePerformance
    ) {
      strongPerformanceCreatorGroups.add(creator.coverageGroup || creator.id);
    }
  }
  const fastGatePassed =
    creators7.length >= config.hardGates.fastCreatorCount &&
    strongPerformanceCreatorGroups.size >= config.hardGates.fastCreatorCount;
  const eventShare = recentSignals.length
    ? recentSignals.filter((signal) => signal.angle === "news").length / recentSignals.length
    : 0;
  const eventDominated = eventShare > config.hardGates.maxEventShare;
  const independence = conceptIndependence(concept);
  const score = buildScore({
    signals: recentSignals,
    creators30,
    creators14,
    sourceMap,
    now,
    config
  });
  const confidence = confidenceLevel(score, recentSignals);
  const hardGatePassed = hardGate14 || hardGate30;
  const pool = candidatePool({
    hardGatePassed,
    fastGatePassed,
    independence,
    eventDominated,
    score,
    config
  });

  const reasons = [];
  if (hardGate14) reasons.push(`14 天内 ${creators14.length} 个独立创作者覆盖`);
  else if (hardGate30) reasons.push(`30 天内 ${creators30.length} 个独立创作者覆盖`);
  else reasons.push(`未通过创作者覆盖硬门槛：14 天 ${creators14.length}，30 天 ${creators30.length}`);
  if (eventDominated) reasons.push(`事件型内容占 ${Math.round(eventShare * 100)}%，暂不直接立项`);
  if (score.performanceSampleCount === 0) reasons.push("缺少相对爆款数据，未猜测播放表现");
  if (score.questionSampleCount === 0) reasons.push("缺少评论问题密度，未猜测用户疑问");

  const sortedSignals = [...recentSignals].sort((a, b) =>
    (b.publishedAt || b.observedAt).localeCompare(a.publishedAt || a.observedAt)
  );
  return {
    id: concept.id,
    concept: concept.name,
    parent: concept.parent,
    recommendedTitle: concept.recommendedTitle,
    recommendedPool: pool,
    selectionStatus: "not_selected",
    score,
    confidence,
    heatGate: {
      passed: hardGatePassed,
      fastGatePassed,
      creators7: creators7.length,
      creators14: creators14.length,
      creators30: creators30.length,
      platforms: Array.from(new Set(creators30.map((creator) => creator.platform))),
      weightedCreatorCoverage: round(
        creators30.reduce((total, creator) => total + creator.weight, 0),
        1
      )
    },
    conceptIndependence: independence,
    eventShare: round(eventShare, 2),
    eventDominated,
    reasons,
    productDecisions: concept.productDecisions,
    primarySources: concept.primarySources,
    creatorEvidence: creators30.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)),
    signalCount: recentSignals.length,
    evidenceSignals: sortedSignals.slice(0, 10).map((signal) => ({
      id: signal.id,
      creatorId: signal.creatorId,
      creatorName: sourceMap.get(signal.creatorId)?.name ?? signal.creatorId,
      platform: sourceMap.get(signal.creatorId)?.platform ?? "unknown",
      title: signal.title,
      sourceUrl: signal.sourceUrl,
      publishedAt: signal.publishedAt,
      datePrecision: signal.datePrecision,
      angle: signal.angle,
      event: signal.event ?? null
    }))
  };
}

const POOL_ORDER = new Map([
  ["formal_candidate", 0],
  ["continue_watching", 1],
  ["observation_pool", 2],
  ["already_covered", 3]
]);

export function discoverTrendCandidates({
  signals,
  sources,
  taxonomy,
  config,
  coveredConceptIds = [],
  now = new Date()
}) {
  const currentTime = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(currentTime.getTime())) throw new Error("invalid trend discovery time");
  const sourceMap = new Map(
    sources.creators.filter((creator) => creator.enabled !== false).map((creator) => [creator.id, creator])
  );
  const conceptMap = new Map(taxonomy.concepts.map((concept) => [concept.id, concept]));
  const grouped = new Map(taxonomy.concepts.map((concept) => [concept.id, []]));
  const unmappedSignals = [];

  for (const signal of signals) {
    if (!sourceMap.has(signal.creatorId)) continue;
    const conceptIds = inferConceptIds(signal, taxonomy).filter((conceptId) => conceptMap.has(conceptId));
    if (conceptIds.length === 0) unmappedSignals.push(signal);
    for (const conceptId of conceptIds) grouped.get(conceptId).push(signal);
  }

  const covered = new Set(coveredConceptIds);
  const candidates = taxonomy.concepts
    .map((concept) => buildCandidate(concept, grouped.get(concept.id), sourceMap, config, currentTime))
    .filter((candidate) => candidate.signalCount > 0)
    .map((candidate) =>
      covered.has(candidate.id)
        ? {
            ...candidate,
            recommendedPool: "already_covered",
            productionState: "already_covered",
            reasons: [...candidate.reasons, "该概念已经进入过视频生产，不重复占用新一期推荐位"]
          }
        : { ...candidate, productionState: "new" }
    )
    .sort(
      (a, b) =>
        POOL_ORDER.get(a.recommendedPool) - POOL_ORDER.get(b.recommendedPool) ||
        b.score.score - a.score.score ||
        b.heatGate.creators14 - a.heatGate.creators14 ||
        a.eventShare - b.eventShare ||
        a.concept.localeCompare(b.concept)
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  return {
    generatedAt: currentTime.toISOString(),
    summary: {
      signalCount: signals.length,
      creatorCount: new Set(signals.map((signal) => sourceMap.get(signal.creatorId)?.coverageGroup).filter(Boolean))
        .size,
      mappedSignalCount: signals.length - unmappedSignals.length,
      unmappedSignalCount: unmappedSignals.length,
      formalCandidateCount: candidates.filter((candidate) => candidate.recommendedPool === "formal_candidate")
        .length,
      continueWatchingCount: candidates.filter(
        (candidate) => candidate.recommendedPool === "continue_watching"
      ).length,
      alreadyCoveredCount: candidates.filter(
        (candidate) => candidate.recommendedPool === "already_covered"
      ).length
    },
    candidates,
    unmappedSignals: unmappedSignals.slice(0, 20).map((signal) => ({
      id: signal.id,
      creatorId: signal.creatorId,
      title: signal.title
    }))
  };
}
