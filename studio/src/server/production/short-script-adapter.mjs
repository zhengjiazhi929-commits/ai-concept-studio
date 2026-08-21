export const APPROVED_SOURCE_SHORT_SCRIPT_ADAPTER_VERSION =
  "approved-source-short-script-adapter-v1";

function sentences(value) {
  return String(value ?? "")
    .match(/[^。！？；]+[。！？；]?/gu)
    ?.map((item) => item.trim())
    .filter(Boolean) ?? [];
}

function groupSentences(items, groupCount) {
  const groups = [];
  let cursor = 0;
  for (let index = 0; index < groupCount; index += 1) {
    const remainingItems = items.length - cursor;
    const remainingGroups = groupCount - index;
    const size = Math.ceil(remainingItems / remainingGroups);
    groups.push(items.slice(cursor, cursor + size).join(""));
    cursor += size;
  }
  return groups.filter(Boolean);
}

export function adaptApprovedSourceToShortScript(episode) {
  if (episode.derivation?.kind !== "approved-script-section-v1") {
    throw new Error("只有绑定已批准脚本段落的派生 Episode 才能使用确定性短脚本适配器");
  }
  const sourceSections = episode.derivation.sourceSections;
  if (!Array.isArray(sourceSections) || sourceSections.length === 0) {
    throw new Error("派生 Episode 缺少批准源脚本快照");
  }

  const sourceSentences = sourceSections.flatMap((section) => sentences(section.narration));
  if (sourceSentences.length < 2) {
    throw new Error("批准源脚本内容不足，不能形成 60 秒结构化脚本");
  }
  const groupCount = Math.max(2, Math.min(4, Math.ceil(sourceSentences.length / 3)));
  const narrationGroups = groupSentences(sourceSentences, groupCount);
  const evidenceRefs = [...new Set(sourceSections.flatMap((section) => section.evidenceRefs ?? []))];
  const visualDirections = [...new Set(
    sourceSections.map((section) => section.visualDirection).filter(Boolean)
  )];
  const sourceHeading = sourceSections.map((section) => section.heading).join("、");
  const sourcePurpose = sourceSections.map((section) => section.purpose).filter(Boolean).join("；");

  const sections = narrationGroups.map((narration, index) => ({
    id: `S${String(index + 1).padStart(2, "0")}`,
    heading: `${sourceHeading} ${index + 1}/${narrationGroups.length}`,
    purpose: sourcePurpose || "准确压缩已批准脚本",
    narration,
    evidenceRefs,
    visualDirection: visualDirections.join("；")
  }));
  return {
    title: sourceHeading,
    thesis: sourcePurpose || episode.thesis,
    targetDurationSeconds: 60,
    hook: "",
    sections,
    closing: "",
    factCheckNotes: []
  };
}

export function derivedScriptFidelity(episode, scriptDraft) {
  if (episode.derivation?.kind !== "approved-script-section-v1") {
    return { applicable: false, passed: true, invalidFields: [] };
  }
  const sources = (episode.derivation.sourceSections ?? [])
    .map((section) => String(section.narration ?? ""));
  const content = scriptDraft?.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return { applicable: true, passed: false, invalidFields: ["content"] };
  }
  const fields = [
    ["hook", content.hook, true],
    ...((content.sections ?? []).map((section, index) => [
      `sections[${index}].narration`,
      section?.narration,
      false
    ])),
    ["closing", content.closing, true]
  ];
  const invalidFields = fields
    .filter(([, value, optional]) => {
      const text = String(value ?? "").trim();
      if (!text) return !optional;
      return !sources.some((source) => source.includes(text));
    })
    .map(([field]) => field);
  return { applicable: true, passed: invalidFields.length === 0, invalidFields };
}

export function derivedNarrationDuplication(scriptDraft) {
  const content = scriptDraft?.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return { passed: false, duplicates: ["content"] };
  }
  const segments = [
    ["hook", content.hook],
    ...((content.sections ?? []).map((section, index) => [
      `sections[${index}].narration`,
      section?.narration
    ])),
    ["closing", content.closing]
  ].map(([field, value]) => [field, String(value ?? "").trim()]);
  const duplicates = [];
  for (let index = 0; index < segments.length; index += 1) {
    const [field, text] = segments[index];
    if (!text) continue;
    for (let comparison = index + 1; comparison < segments.length; comparison += 1) {
      const [otherField, otherText] = segments[comparison];
      if (otherText && (text === otherText || text.includes(otherText) || otherText.includes(text))) {
        duplicates.push(`${field}<->${otherField}`);
      }
    }
  }
  return { passed: duplicates.length === 0, duplicates };
}

export function derivedVisualDirectionFidelity(episode, scriptDraft) {
  if (episode.derivation?.kind !== "approved-script-section-v1") {
    return { applicable: false, passed: true, invalidSections: [] };
  }
  const approvedDirections = new Set(
    (episode.derivation.sourceSections ?? [])
      .map((section) => String(section.visualDirection ?? "").trim())
      .filter(Boolean)
  );
  const sections = scriptDraft?.content?.sections ?? [];
  const invalidSections = sections
    .filter((section) => !approvedDirections.has(String(section?.visualDirection ?? "").trim()))
    .map((section) => section?.id ?? "unknown");
  return {
    applicable: true,
    passed: sections.length > 0 && invalidSections.length === 0,
    invalidSections
  };
}
