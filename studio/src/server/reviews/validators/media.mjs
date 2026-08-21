import { reviewCheck } from "../checks.mjs";
import { isSha256 } from "../../../shared/integrity.mjs";

function qaFailureOwner(episode) {
  const owners = new Set(
    (episode.qa?.checks ?? [])
      .filter((check) => check.passed === false)
      .map((check) => check.ownerAgentId)
      .filter(Boolean)
  );
  return owners.size === 1 ? [...owners][0] : null;
}

export function validateMediaForReview(episode) {
  const failedQaOwner = qaFailureOwner(episode);
  const renderBytes = episode.render?.bytes;
  const renderSha256 = episode.render?.sha256;
  const qaBytes = (episode.qa?.checks ?? []).find((item) => item.id === "render-bytes");
  const qaSha256 = (episode.qa?.checks ?? []).find((item) => item.id === "render-sha256");
  const integrityPassed = (
    Number.isSafeInteger(renderBytes) &&
    renderBytes > 50_000 &&
    isSha256(renderSha256) &&
    qaBytes?.passed === true &&
    qaBytes.actual === renderBytes &&
    qaBytes.expected === renderBytes &&
    qaSha256?.passed === true &&
    qaSha256.actual === renderSha256 &&
    qaSha256.expected === renderSha256
  );
  return [
    reviewCheck("render-complete", "渲染状态完成", episode.render?.status === "complete", {
      actual: episode.render?.status ?? "missing",
      expected: "complete",
      ownerAgentId: "render-agent"
    }),
    reviewCheck("render-output", "成片路径存在", Boolean(episode.render?.outputPath), {
      actual: episode.render?.outputPath ?? null,
      expected: "版本化 MP4 路径",
      ownerAgentId: "render-agent"
    }),
    reviewCheck("render-integrity", "成片与 QA 绑定同一文件摘要", integrityPassed, {
      actual: {
        bytes: renderBytes ?? null,
        sha256: renderSha256 ?? null,
        qaBytesPassed: qaBytes?.passed === true,
        qaSha256Passed: qaSha256?.passed === true
      },
      expected: "渲染记录与 QA 均绑定同一份有效 MP4 的字节数和 SHA-256",
      ownerAgentId: "render-agent",
      suggestedFix: "由 Render Agent 重新生成或登记成片摘要，再由 QA Agent 重新检查"
    }),
    reviewCheck("qa-passed", "技术与内容 QA 通过", episode.qa?.status === "passed", {
      actual: episode.qa?.status ?? "missing",
      expected: "passed",
      ownerAgentId: failedQaOwner,
      suggestedFix: failedQaOwner
        ? `退回 ${failedQaOwner} 修复 QA 报告中的阻断问题后重新生成成片`
        : "检查 QA 报告中的失败项，并退回实际产出 Agent 修复"
    })
  ];
}
