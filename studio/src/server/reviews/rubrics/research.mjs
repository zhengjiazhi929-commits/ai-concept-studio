import { reviewCheck } from "../checks.mjs";
import { inspectInlineResearchEvidence } from "../approval-artifact-integrity.mjs";

export function reviewResearchArtifact(episode) {
  const readiness = episode.research?.readiness;
  const inlineEvidence = inspectInlineResearchEvidence(episode);
  const sourceRegistryPassed = inlineEvidence.applicable
    ? inlineEvidence.passed
    : (episode.sourceDocs?.length ?? 0) >= 2;
  return [
    reviewCheck("research-ready", "研究证据达到审批门槛", readiness?.readyForFactApproval === true, {
      actual: readiness?.reasons ?? [],
      expected: "readyForFactApproval=true",
      message: (readiness?.reasons ?? []).join("；")
    }),
    reviewCheck("research-sources", "事实来源已登记并与主张闭合", sourceRegistryPassed, {
      actual: inlineEvidence.applicable
        ? {
            documentCount: inlineEvidence.documentCount,
            sourceCount: inlineEvidence.sourceCount,
            claimCount: inlineEvidence.claimCount,
            issues: inlineEvidence.issues
          }
        : { documentCount: episode.sourceDocs?.length ?? 0 },
      expected: "至少两份完整本地证据；来源和主张 ID 唯一且引用闭合",
      message: inlineEvidence.issues.map((issue) => issue.message).join("；")
    })
  ];
}
