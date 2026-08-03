import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { publicRoot, workspaceRoot } from "../../shared/paths.mjs";
import { validateEpisode } from "../../shared/schema.mjs";
import { renderPreview } from "../renderer.mjs";
import { runPreviewQa } from "../qa.mjs";
import { runTrendRadarAgent } from "../trends/agent.mjs";

function outcome(status, message, extras = {}) {
  return { status, message, artifacts: [], findings: [], ...extras };
}

export const agents = {
  "trend-agent": {
    id: "trend-agent",
    label: "热点发现 Agent",
    async run(episode) {
      if (episode.approvals.topic.status !== "approved") {
        const { run, runPath } = await runTrendRadarAgent();
        return outcome(
          "waiting_approval",
          `发现 ${run.summary.formalCandidateCount} 个正式候选，请在概念雷达中选择后人工批准`,
          {
            requiresApproval: "topic",
            artifacts: [runPath],
            patch: {
              trendDiscovery: {
                runId: run.id,
                candidateIds: run.candidates
                  .filter((candidate) => candidate.recommendedPool === "formal_candidate")
                  .map((candidate) => candidate.id)
              }
            }
          }
        );
      }
      return outcome("complete", "选题已批准，可以进入研究与事实核验");
    }
  },
  "research-agent": {
    id: "research-agent",
    label: "研究 Agent",
    async run(episode) {
      if (episode.sourceDocs.length < 3) return outcome("failed", "一手来源和主张证据不足");
      if (episode.approvals.facts.status !== "approved") {
        return outcome("waiting_approval", "关键事实需要人工批准", {
          requiresApproval: "facts"
        });
      }
      return outcome("complete", `已登记 ${episode.sourceDocs.length} 份带哈希的研究文档`);
    }
  },
  "script-agent": {
    id: "script-agent",
    label: "脚本 Agent",
    async run(episode) {
      const hasScript = episode.sourceDocs.some((source) => source.path.endsWith("07-script.md"));
      if (!hasScript) return outcome("failed", "没有找到脚本真源");
      if (episode.approvals.script.status !== "approved") {
        return outcome("waiting_approval", "脚本需要人工批准", {
          requiresApproval: "script"
        });
      }
      return outcome("complete", "脚本真源已登记并通过人工审批");
    }
  },
  "storyboard-agent": {
    id: "storyboard-agent",
    label: "分镜 Agent",
    async run(episode) {
      const validation = validateEpisode(episode);
      if (!validation.valid) return outcome("failed", validation.errors.join("；"));
      if (episode.approvals.visual.status !== "approved") {
        return outcome("waiting_approval", "视觉与分镜需要人工批准", {
          requiresApproval: "visual"
        });
      }
      return outcome("complete", `${episode.scenes.length} 个预览场景时间轴连续`);
    }
  },
  "asset-agent": {
    id: "asset-agent",
    label: "素材 Agent",
    async run(episode) {
      const missing = [];
      for (const asset of episode.assets) {
        try {
          await access(resolve(publicRoot, asset.path));
        } catch {
          missing.push(asset.path);
        }
      }
      if (missing.length > 0) return outcome("failed", `缺少素材：${missing.join(", ")}`);
      return outcome("complete", `${episode.assets.length} 项真实素材已定位并可读取`);
    }
  },
  "voice-agent": {
    id: "voice-agent",
    label: "旁白 Agent",
    async run(episode) {
      if (episode.voice.status !== "ready" || !episode.voice.audioPath) {
        return outcome("waiting_approval", "需要先选择并授权旁白方案", {
          requiresApproval: "voice"
        });
      }
      try {
        await access(resolve(workspaceRoot, episode.voice.audioPath));
      } catch {
        return outcome("failed", "旁白文件不存在");
      }
      return outcome("complete", "旁白文件已就绪");
    }
  },
  "render-agent": {
    id: "render-agent",
    label: "渲染 Agent",
    async run(episode, context) {
      const result = await renderPreview(episode, context);
      return outcome("complete", "视觉验证版 MP4 已生成", {
        artifacts: [result.outputPath],
        patch: {
          render: {
            ...episode.render,
            status: "complete",
            progress: 1,
            outputPath: result.relativeOutputPath,
            renderedAt: new Date().toISOString(),
            muted: episode.voice.status !== "ready"
          }
        }
      });
    }
  },
  "qa-agent": {
    id: "qa-agent",
    label: "QA Agent",
    async run(episode) {
      const report = await runPreviewQa(episode);
      return outcome(report.passed ? "complete" : "failed", report.summary, {
        artifacts: [report.reportPath],
        findings: report.checks,
        patch: {
          qa: {
            status: report.passed ? "passed" : "failed",
            reportPath: report.relativeReportPath,
            checkedAt: new Date().toISOString(),
            checks: report.checks
          }
        }
      });
    }
  }
};

export function getAgent(agentId) {
  const agent = agents[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  return agent;
}
