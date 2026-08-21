import { productionProfileForEpisode } from "../../shared/production-profiles.mjs";
import {
  derivedNarrationDuplication,
  derivedScriptFidelity,
  derivedVisualDirectionFidelity
} from "./short-script-adapter.mjs";
import { derivedStoryboardFidelity } from "./short-storyboard-adapter.mjs";

function compactLength(value) {
  return String(value ?? "").replace(/[\s，。！？；：、“”‘’（）《》…—,.!?;:'"()\[\]{}-]/gu, "").length;
}

function qualityCheck(id, label, passed, severity, actual, expected, message = "", options = {}) {
  return {
    id,
    label,
    passed,
    severity,
    actual,
    expected,
    message,
    location: options.location ?? id,
    suggestedFix: options.suggestedFix ?? "",
    ownerAgentId: options.ownerAgentId ?? null
  };
}

function hasStage(stage, ...stages) {
  return stages.includes(stage);
}

const subtitleSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
const leadingClosingPunctuation = /^[，。！？；：、）》】,.!?;:)\]]/u;
const trailingOpeningPunctuation = /[（《【(\[]$/u;

export function subtitleBoundaryIssues(subtitles = []) {
  const texts = subtitles.map((subtitle) => String(subtitle?.text ?? ""));
  const joined = texts.join("");
  const validBoundaries = new Set(
    [...subtitleSegmenter.segment(joined)].map((item) => item.index)
  );
  validBoundaries.add(joined.length);
  const issues = [];
  let offset = 0;
  for (let index = 0; index < texts.length - 1; index += 1) {
    offset += texts[index].length;
    const previous = texts[index].trimEnd();
    const next = texts[index + 1].trimStart();
    const reasons = [];
    if (!validBoundaries.has(offset)) reasons.push("word-split");
    if (leadingClosingPunctuation.test(next)) reasons.push("leading-punctuation");
    if (trailingOpeningPunctuation.test(previous)) reasons.push("trailing-opening-punctuation");
    if (reasons.length > 0) {
      issues.push({ index, offset, reasons });
    }
  }
  return issues;
}

export function evaluateProductionQuality(episode, options = {}) {
  const stage = options.stage ?? "qa";
  const profile = productionProfileForEpisode(episode);
  const checks = [];
  const scenes = Array.isArray(episode.scenes) ? episode.scenes : [];
  const subtitles = [...(Array.isArray(episode.subtitles) ? episode.subtitles : [])].sort(
    (a, b) => a.start - b.start
  );
  const duration = Number(episode.render?.durationSeconds ?? scenes.at(-1)?.end ?? 0);
  const add = (...arguments_) => checks.push(qualityCheck(...arguments_));
  let scriptNarrationCharacters = null;
  let scriptNarrationDensity = null;

  add("concept", "概念与标题明确", Boolean(episode.concept && episode.title), "error", episode.title || "", "非空");
  add("thesis", "核心论点明确", compactLength(episode.thesis) >= 12, "error", compactLength(episode.thesis), ">= 12 个有效字符");
  add("audience", "目标受众明确", compactLength(episode.audience) >= 8, "warning", compactLength(episode.audience), ">= 8 个有效字符");
  add(
    "sources",
    "事实来源已登记",
    (episode.sourceDocs?.length ?? 0) >= 3,
    "error",
    episode.sourceDocs?.length ?? 0,
    ">= 3"
  );

  if (hasStage(stage, "script")) {
    const draft = episode.production?.scriptDraft;
    const importedScript = episode.sourceDocs?.some((source) => source.path?.endsWith("07-script.md"));
    add(
      "script-draft",
      "脚本真源或结构化草稿存在",
      Boolean(importedScript || draft?.artifactPath),
      "error",
      importedScript ? "imported" : draft?.artifactPath || "missing",
      "已登记"
    );

    const content = draft?.content;
    const structuredDraft = content && typeof content === "object" && !Array.isArray(content)
      ? content
      : null;
    if (structuredDraft) {
      const sections = Array.isArray(structuredDraft.sections) ? structuredDraft.sections : [];
      const sectionCountPassed =
        sections.length >= profile.scriptSections.minimum &&
        sections.length <= profile.scriptSections.maximum;
      add(
        "script-section-count",
        "结构化脚本章节数量合理",
        sectionCountPassed,
        "error",
        sections.length,
        `${profile.scriptSections.minimum}–${profile.scriptSections.maximum}`,
        sectionCountPassed
          ? ""
          : `脚本当前有 ${sections.length} 节，不符合“${profile.label}”结构`,
        {
          location: "production.scriptDraft.content.sections",
          suggestedFix: `由 Script Agent 把脚本调整为 ${profile.scriptSections.minimum}–${profile.scriptSections.maximum} 个职责明确、顺序连贯的章节`
        }
      );

      const targetDurationSeconds = Number(structuredDraft.targetDurationSeconds);
      const profileDurationPassed =
        Number.isInteger(targetDurationSeconds) &&
        targetDurationSeconds >= profile.targetDurationSeconds.minimum &&
        targetDurationSeconds <= profile.targetDurationSeconds.maximum;
      add(
        "script-profile-contract",
        "脚本符合 Episode 生产规格",
        profileDurationPassed,
        "error",
        targetDurationSeconds,
        profile.targetDurationSeconds.minimum === profile.targetDurationSeconds.maximum
          ? profile.targetDurationSeconds.minimum
          : `${profile.targetDurationSeconds.minimum}–${profile.targetDurationSeconds.maximum}`,
        profileDurationPassed
          ? ""
          : `脚本时长不符合“${profile.label}”规格`,
        {
          location: "production.scriptDraft.content.targetDurationSeconds",
          suggestedFix: "由 Script Agent 按 Episode 已锁定生产规格重新生成"
        }
      );
      scriptNarrationCharacters = compactLength([
        structuredDraft.hook,
        ...sections.map((section) => section?.narration),
        structuredDraft.closing
      ].join("\n"));
      scriptNarrationDensity = Number.isFinite(targetDurationSeconds) && targetDurationSeconds > 0
        ? scriptNarrationCharacters / targetDurationSeconds
        : Number.NaN;
      const narrationDensityPassed = Number.isFinite(scriptNarrationDensity)
        && scriptNarrationDensity >= 2.5
        && scriptNarrationDensity <= 5.5;
      add(
        "script-narration-density",
        "目标时长与实际旁白量匹配",
        narrationDensityPassed,
        "error",
        Number.isFinite(scriptNarrationDensity) ? Number(scriptNarrationDensity.toFixed(2)) : null,
        "2.5–5.5 个有效字/秒",
        narrationDensityPassed
          ? ""
          : `目标 ${Number.isFinite(targetDurationSeconds) ? targetDurationSeconds : "未知"} 秒，当前约 ${scriptNarrationCharacters} 个有效旁白字，内容量与目标时长不匹配`,
        {
          location: "production.scriptDraft.content",
          suggestedFix: "由 Script Agent 在保持证据约束的前提下补足或压缩各节旁白，使有效字数与目标时长匹配"
        }
      );

      const sectionsWithEvidence = sections.filter(
        (section) => Array.isArray(section?.evidenceRefs) && section.evidenceRefs.length > 0
      ).length;
      const evidenceRefsPassed = sections.length > 0 && sectionsWithEvidence === sections.length;
      add(
        "script-evidence-refs",
        "每个脚本章节都绑定研究证据",
        evidenceRefsPassed,
        "error",
        sectionsWithEvidence,
        sections.length,
        evidenceRefsPassed
          ? ""
          : `${sections.length - sectionsWithEvidence} 个章节没有绑定研究证据`,
        {
          location: "production.scriptDraft.content.sections",
          suggestedFix: "由 Script Agent 为每个章节补充至少一个有效 evidenceRefs，无法找到证据的主张应删除或移入待核验项"
        }
      );

      if (episode.derivation?.kind === "approved-script-section-v1") {
        const duplication = derivedNarrationDuplication(draft);
        const fidelity = derivedScriptFidelity(episode, draft);
        const visualFidelity = derivedVisualDirectionFidelity(episode, draft);
        const sourceBindingPassed =
          draft?.generationKind === "deterministic-approved-source-adapter" &&
          draft?.sourceSnapshotHash === episode.derivation.sourceSnapshotHash;
        add(
          "script-derived-source-binding",
          "派生脚本绑定批准源快照",
          sourceBindingPassed,
          "error",
          draft?.sourceSnapshotHash ?? null,
          episode.derivation.sourceSnapshotHash,
          sourceBindingPassed ? "" : "派生脚本没有绑定创建时的批准源脚本快照",
          {
            location: "production.scriptDraft.sourceSnapshotHash",
            suggestedFix: "由 Script Agent 从当前派生源快照重新生成新版本"
          }
        );
        add(
          "script-derived-source-fidelity",
          "派生旁白只复用批准源脚本文字",
          fidelity.passed,
          "error",
          fidelity.invalidFields,
          "hook、各节旁白与 closing 均来自批准源脚本",
          fidelity.passed
            ? ""
            : `以下字段含有批准源脚本之外的内容：${fidelity.invalidFields.join("、")}`,
          {
            location: "production.scriptDraft.content",
            suggestedFix: "退回 Script Agent，只允许压缩、分组或重排批准源脚本原文"
          }
        );
        add(
          "script-derived-narration-duplication",
          "派生脚本没有重复口播片段",
          duplication.passed,
          "error",
          duplication.duplicates,
          "hook、正文和 closing 之间不重复",
          duplication.passed
            ? ""
            : `以下口播片段重复：${duplication.duplicates.join("、")}`,
          {
            location: "production.scriptDraft.content",
            suggestedFix: "由 Script Agent 去除 hook、正文和 closing 之间重复出现的批准源句子"
          }
        );
        add(
          "script-derived-visual-fidelity",
          "派生视觉方向沿用批准脚本",
          visualFidelity.passed,
          "error",
          visualFidelity.invalidSections,
          "每节 visualDirection 必须来自批准源脚本",
          visualFidelity.passed
            ? ""
            : `以下章节引入了未经脚本批准的视觉方向：${visualFidelity.invalidSections.join("、")}`,
          {
            location: "production.scriptDraft.content.sections",
            suggestedFix: "退回 Script Agent，恢复批准源脚本中的视觉方向；新的比喻必须先走脚本 Gate"
          }
        );
      }
    } else if (importedScript) {
      for (const [id, label] of [
        ["script-section-count", "结构化脚本章节数量合理"],
        ["script-narration-density", "目标时长与实际旁白量匹配"],
        ["script-evidence-refs", "每个脚本章节都绑定研究证据"]
      ]) {
        add(
          id,
          label,
          true,
          "error",
          "legacy-imported-script",
          "结构化新稿必检；受信任的导入脚本沿用原验收",
          "",
          { location: "sourceDocs" }
        );
      }
    }
  }

  if (hasStage(stage, "storyboard", "voice", "qa")) {
    const generatedStoryboard = Boolean(episode.production?.storyboardDraft?.artifactPath);
    const sceneCountPassed = generatedStoryboard
      ? scenes.length >= profile.storyboardScenes.minimum &&
        scenes.length <= profile.storyboardScenes.maximum
      : scenes.length >= 6;
    add(
      "scene-count",
      "场景数量",
      sceneCountPassed,
      "error",
      scenes.length,
      generatedStoryboard
        ? `${profile.storyboardScenes.minimum}–${profile.storyboardScenes.maximum}`
        : ">= 6"
    );
    for (const type of ["title", "evidence", "statement", "summary"]) {
      add(
        `scene-type-${type}`,
        `${type} 场景存在`,
        scenes.some((scene) => scene.type === type),
        "error",
        scenes.filter((scene) => scene.type === type).length,
        ">= 1"
      );
    }
    add(
      "scene-copy",
      "每个场景有可读主文案",
      scenes.every((scene) => compactLength(scene.title || scene.statement) >= 4),
      "error",
      scenes.filter((scene) => compactLength(scene.title || scene.statement) >= 4).length,
      scenes.length
    );

    const evidenceScenes = scenes.filter((scene) => scene.type === "evidence");
    add(
      "evidence-labels",
      "证据场景带来源提示",
      evidenceScenes.length > 0 && evidenceScenes.every((scene) => scene.label || scene.assetHint),
      "warning",
      evidenceScenes.filter((scene) => scene.label || scene.assetHint).length,
      evidenceScenes.length
    );

    const assetPaths = new Set((episode.assets ?? []).map((asset) => asset.path));
    const resolvedEvidence = evidenceScenes.filter(
      (scene) => scene.asset && assetPaths.has(scene.asset)
    ).length;
    add(
      "evidence-assets",
      "证据场景已绑定真实素材",
      evidenceScenes.length > 0 && resolvedEvidence === evidenceScenes.length,
      stage === "storyboard" ? "warning" : "error",
      resolvedEvidence,
      evidenceScenes.length,
      "分镜阶段可先用素材提示，最终 QA 必须绑定真实素材",
      {
        ownerAgentId: "asset-agent",
        location: "scenes",
        suggestedFix: "由 Asset Agent 补齐素材清单映射，并确保每个 evidence 场景绑定已登记文件"
      }
    );

    let previousEnd = 0;
    let subtitleTimelineValid = subtitles.length > 0;
    let maxRate = 0;
    let overlyLongLines = 0;
    let overlyBriefLines = 0;
    let leadingWhitespaceLines = 0;
    for (const subtitle of subtitles) {
      if (Math.abs(subtitle.start - previousEnd) > 0.2 || subtitle.end <= subtitle.start) {
        subtitleTimelineValid = false;
      }
      const subtitleDuration = Math.max(0.1, subtitle.end - subtitle.start);
      maxRate = Math.max(maxRate, compactLength(subtitle.text) / subtitleDuration);
      if (compactLength(subtitle.text) > 28) overlyLongLines += 1;
      if (subtitleDuration < 0.75) overlyBriefLines += 1;
      if (/^\s/u.test(String(subtitle.text ?? ""))) leadingWhitespaceLines += 1;
      previousEnd = subtitle.end;
    }
    if (Math.abs(previousEnd - duration) > 0.35) subtitleTimelineValid = false;
    add(
      "subtitle-timeline",
      "字幕时间轴连续",
      subtitleTimelineValid,
      "error",
      previousEnd,
      duration,
      "",
      { ownerAgentId: "storyboard-agent", location: "subtitles" }
    );
    add("subtitle-rate", "字幕语速适合阅读", maxRate <= 8.5, "warning", Number(maxRate.toFixed(2)), "<= 8.5 字/秒");
    add("subtitle-length", "字幕单条长度克制", overlyLongLines === 0, "warning", overlyLongLines, "0 条超过 28 字");
    add(
      "subtitle-min-duration",
      "字幕具有足够停留时间",
      overlyBriefLines === 0,
      "error",
      overlyBriefLines,
      "0 条短于 0.75 秒",
      overlyBriefLines === 0 ? "" : `${overlyBriefLines} 条字幕停留时间短于 0.75 秒，真实画面会闪跳`,
      {
        ownerAgentId: "storyboard-agent",
        location: "subtitles",
        suggestedFix: "由 Storyboard Agent 重新平衡相邻字幕，避免孤立短尾句"
      }
    );
    add(
      "subtitle-leading-whitespace",
      "字幕不以空白字符开头",
      leadingWhitespaceLines === 0,
      "error",
      leadingWhitespaceLines,
      0,
      leadingWhitespaceLines === 0 ? "" : `${leadingWhitespaceLines} 条字幕以空白字符开头`,
      {
        ownerAgentId: "storyboard-agent",
        location: "subtitles",
        suggestedFix: "把分段边界的空格移到上一条字幕末尾，保持旁白原文不变"
      }
    );
    const boundaryIssues = subtitleBoundaryIssues(subtitles);
    add(
      "subtitle-boundaries",
      "字幕按词语和标点边界切分",
      boundaryIssues.length === 0,
      "error",
      boundaryIssues.length,
      0,
      boundaryIssues.length === 0
        ? ""
        : `${boundaryIssues.length} 处字幕从词语中间断开或把闭合标点放在下一条开头`,
      {
        ownerAgentId: "storyboard-agent",
        location: "subtitles",
        suggestedFix: "由 Storyboard Agent 按中文词语和标点边界重新拆分字幕，禁止固定字符数硬切"
      }
    );

    const scriptContent = episode.production?.scriptDraft?.content;
    const structuredScript = scriptContent
      && typeof scriptContent === "object"
      && !Array.isArray(scriptContent)
      ? scriptContent
      : null;
    if (structuredScript) {
      const scriptSections = Array.isArray(structuredScript.sections)
        ? structuredScript.sections
        : [];
      const scriptCharacters = compactLength([
        structuredScript.hook,
        ...scriptSections.map((section) => section?.narration),
        structuredScript.closing
      ].join("\n"));
      const subtitleCharacters = compactLength(subtitles.map((subtitle) => subtitle.text).join("\n"));
      const coverage = scriptCharacters > 0 ? subtitleCharacters / scriptCharacters : Number.NaN;
      const coveragePassed = Number.isFinite(coverage) && coverage >= 0.75 && coverage <= 1.25;
      add(
        "storyboard-script-coverage",
        "分镜字幕量承接已批准脚本",
        coveragePassed,
        "error",
        Number.isFinite(coverage) ? Number(coverage.toFixed(2)) : null,
        "0.75–1.25",
        coveragePassed
          ? ""
          : `已批准脚本约 ${scriptCharacters} 个有效字，分镜字幕约 ${subtitleCharacters} 个有效字，内容覆盖不足或异常膨胀`,
        {
          location: "subtitles",
          suggestedFix: "由 Storyboard Agent 重新拆分已批准脚本，确保字幕覆盖主要旁白且不新增无证据内容"
        }
      );

      if (episode.derivation?.kind === "approved-script-section-v1") {
        const fidelity = derivedStoryboardFidelity(episode);
        add(
          "storyboard-derived-script-binding",
          "派生分镜绑定已批准脚本版本",
          fidelity.bindingPassed && fidelity.currentArtifactIsLatest,
          "error",
          {
            version: episode.production?.storyboardDraft?.sourceScriptVersion ?? null,
            artifactHash:
              episode.production?.storyboardDraft?.sourceScriptArtifactHash ?? null,
            reviewReportId:
              episode.production?.storyboardDraft?.sourceScriptReviewReportId ?? null
          },
          {
            version: episode.approvals?.script?.currentVersion ?? null,
            artifactHash: episode.approvals?.script?.artifactHash ?? null,
            reviewReportId: episode.approvals?.script?.reviewReportId ?? null
          },
          fidelity.bindingPassed && fidelity.currentArtifactIsLatest
            ? ""
            : fidelity.error || "分镜没有绑定当前已批准脚本，或当前指针没有指向最新候选",
          {
            location: "production.storyboardDraft",
            suggestedFix: "退回 Storyboard Agent，从当前已批准脚本版本重新生成分镜"
          }
        );
        add(
          "storyboard-derived-script-fidelity",
          "派生分镜字幕与镜头文案忠于已批准脚本",
          fidelity.sceneCopyIssues.length === 0 && fidelity.subtitlePassed,
          "error",
          {
            sceneCopyIssues: fidelity.sceneCopyIssues,
            subtitlePassed: fidelity.subtitlePassed
          },
          "字幕逐字承接批准脚本，镜头文案只使用受控适配结果",
          fidelity.sceneCopyIssues.length === 0 && fidelity.subtitlePassed
            ? ""
            : "分镜含有脚本之外的改写、遗漏或镜头文案漂移",
          {
            location: "scenes",
            suggestedFix: "退回 Storyboard Agent，只拆分和可视化已批准脚本，不得临时改写脚本"
          }
        );
        add(
          "storyboard-derived-visual-contract",
          "派生分镜继承已确认视觉规则",
          fidelity.visualRulesPassed,
          "error",
          fidelity.visualRulesPassed,
          true,
          fidelity.visualRulesPassed ? "" : "分镜没有完整登记当前视觉约束",
          {
            location: "production.storyboardDraft.visualRules",
            suggestedFix: "恢复已确认的卡片、字幕、进度条和动画表现规则"
          }
        );
        add(
          "storyboard-derived-display-chrome",
          "画面不显示左上角小字和来源排",
          fidelity.displayChromePassed,
          "error",
          fidelity.displayChromePassed,
          true,
          fidelity.displayChromePassed ? "" : "场景显示了禁止出现的角标、来源排或重复元数据",
          {
            location: "scenes",
            suggestedFix: "清空场景 kicker 与 label，来源信息只保留在审核数据中"
          }
        );
      }
    } else {
      add(
        "storyboard-script-coverage",
        "分镜字幕量承接已批准脚本",
        true,
        "error",
        "legacy-imported-script",
        "结构化新稿必检；受信任的导入脚本沿用原验收",
        "",
        { location: "sourceDocs" }
      );
    }
  }

  if (hasStage(stage, "voice", "qa")) {
    const voiceReady = episode.voice?.status === "ready";
    add(
      "voice-plan",
      "旁白方案已批准",
      voiceReady,
      stage === "qa" && episode.previewMode !== "visual-proof" ? "error" : "warning",
      episode.voice?.status ?? "missing",
      "ready",
      episode.previewMode === "visual-proof"
        ? "视觉验证版尚未配置旁白"
        : "正式样片必须先批准旁白方案",
      { ownerAgentId: "voice-agent", location: "voice" }
    );
    if (voiceReady) {
      add(
        "voice-file",
        "旁白文件路径存在",
        Boolean(episode.voice.audioPath),
        "error",
        episode.voice.audioPath || "",
        "非空",
        "",
        { ownerAgentId: "voice-agent" }
      );
      const voiceDuration = Number(episode.voice.durationSeconds);
      const durationTolerance = Math.max(2, duration * 0.05);
      const durationPassed = Number.isFinite(voiceDuration)
        && voiceDuration > 0
        && Math.abs(voiceDuration - duration) <= durationTolerance;
      add(
        "voice-duration",
        "旁白与画面时长匹配",
        durationPassed,
        "error",
        Number.isFinite(voiceDuration) ? voiceDuration : null,
        `${duration} ± ${Number(durationTolerance.toFixed(1))} 秒`,
        durationPassed
          ? ""
          : "旁白必须具有可验证时长，并与画面总时长保持在 5% 误差内",
        {
          ownerAgentId: "voice-agent",
          location: "voice.durationSeconds",
          suggestedFix: "重新上传可解析且时长匹配的旁白文件"
        }
      );
    } else {
      add(
        "voice-duration",
        "旁白与画面时长匹配",
        episode.previewMode === "visual-proof",
        "error",
        episode.previewMode === "visual-proof" ? "muted-visual-proof" : null,
        episode.previewMode === "visual-proof" ? "允许无旁白" : `${duration} 秒可验证音频`,
        episode.previewMode === "visual-proof" ? "" : "正式样片缺少可验证旁白",
        { ownerAgentId: "voice-agent", location: "voice" }
      );
    }
  }

  const errors = checks.filter((item) => !item.passed && item.severity === "error");
  const warnings = checks.filter((item) => !item.passed && item.severity === "warning");
  const score = Math.max(0, 100 - errors.length * 15 - warnings.length * 4);
  return {
    stage,
    passed: errors.length === 0,
    score,
    grade: score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : "D",
    checks,
    errors: errors.map((item) => item.message || item.label),
    warnings: warnings.map((item) => item.message || item.label),
    metrics: {
      sceneCount: scenes.length,
      subtitleCount: subtitles.length,
      durationSeconds: duration,
      sourceCount: episode.sourceDocs?.length ?? 0,
      scriptNarrationCharacters,
      scriptNarrationCharactersPerSecond: Number.isFinite(scriptNarrationDensity)
        ? Number(scriptNarrationDensity.toFixed(2))
        : null
    }
  };
}
