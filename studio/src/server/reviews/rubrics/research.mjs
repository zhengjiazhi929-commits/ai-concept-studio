import { reviewCheck } from "../checks.mjs";

export function reviewResearchArtifact(episode) {
  const readiness = episode.research?.readiness;
  return [
    reviewCheck("research-ready", "研究证据达到审批门槛", readiness?.readyForFactApproval === true, {
      actual: readiness?.reasons ?? [],
      expected: "readyForFactApproval=true",
      message: (readiness?.reasons ?? []).join("；")
    }),
    reviewCheck("research-sources", "事实来源已登记", (episode.sourceDocs?.length ?? 0) >= 2, {
      actual: episode.sourceDocs?.length ?? 0,
      expected: ">= 2"
    })
  ];
}
