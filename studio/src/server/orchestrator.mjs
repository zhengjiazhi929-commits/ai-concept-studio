import { appendEvent, readEpisode, writeEpisode } from "../shared/store.mjs";
import { getAgent } from "./agents/registry.mjs";

const activeRuns = new Set();

function mergePatch(target, patch) {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch ?? {})) {
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? mergePatch(target?.[key] ?? {}, value)
        : value;
  }
  return result;
}

export async function runAgent(episodeId, agentId) {
  const runKey = episodeId;
  if (activeRuns.has(runKey)) throw new Error("这一期已有 Agent 正在运行，请等待它完成");
  activeRuns.add(runKey);

  try {
    let episode = await readEpisode(episodeId);
    const stepIndex = episode.pipeline.findIndex((step) => step.agent === agentId);
    if (stepIndex === -1) throw new Error(`Episode has no step for ${agentId}`);

    const step = episode.pipeline[stepIndex];
    episode.pipeline[stepIndex] = {
      ...step,
      status: "running",
      message: "正在运行",
      startedAt: new Date().toISOString()
    };
    episode.updatedAt = new Date().toISOString();
    await writeEpisode(episode);
    await appendEvent({
      type: "agent.started",
      episodeId,
      agentId,
      message: `${step.label}开始运行`
    });

    const agent = getAgent(agentId);
    const output = await agent.run(episode, {
      onProgress: async (progress, message) => {
        const current = await readEpisode(episodeId);
        const index = current.pipeline.findIndex((item) => item.agent === agentId);
        current.pipeline[index] = { ...current.pipeline[index], progress, message };
        current.updatedAt = new Date().toISOString();
        await writeEpisode(current);
      }
    });

    episode = await readEpisode(episodeId);
    const finalStepIndex = episode.pipeline.findIndex((item) => item.agent === agentId);
    episode = mergePatch(episode, output.patch);
    episode.pipeline[finalStepIndex] = {
      ...episode.pipeline[finalStepIndex],
      status: output.status,
      message: output.message,
      progress: output.status === "complete" ? 1 : episode.pipeline[finalStepIndex].progress,
      lastRunAt: new Date().toISOString(),
      artifacts: output.artifacts ?? [],
      findings: output.findings ?? [],
      requiresApproval: output.requiresApproval ?? null
    };
    if (agentId === "render-agent" && output.status === "complete") {
      const qaIndex = episode.pipeline.findIndex((item) => item.agent === "qa-agent");
      if (qaIndex >= 0 && episode.pipeline[qaIndex].status === "pending") {
        episode.pipeline[qaIndex] = {
          ...episode.pipeline[qaIndex],
          status: "ready",
          message: "预览已生成，可以执行技术质量检查"
        };
      }
    }
    episode.history.push({
      at: new Date().toISOString(),
      type: "agent-run",
      agentId,
      status: output.status,
      message: output.message
    });
    episode.updatedAt = new Date().toISOString();
    await writeEpisode(episode);
    await appendEvent({
      type: "agent.finished",
      episodeId,
      agentId,
      status: output.status,
      message: output.message
    });
    return { episode, output };
  } catch (error) {
    const episode = await readEpisode(episodeId).catch(() => null);
    if (episode) {
      const index = episode.pipeline.findIndex((item) => item.agent === agentId);
      if (index >= 0) {
        episode.pipeline[index] = {
          ...episode.pipeline[index],
          status: "failed",
          message: error instanceof Error ? error.message : "Agent 运行失败",
          lastRunAt: new Date().toISOString()
        };
        episode.updatedAt = new Date().toISOString();
        await writeEpisode(episode);
      }
    }
    await appendEvent({
      type: "agent.failed",
      episodeId,
      agentId,
      message: error instanceof Error ? error.message : "Agent 运行失败"
    });
    throw error;
  } finally {
    activeRuns.delete(runKey);
  }
}

export async function runNextReadyAgent(episodeId) {
  const episode = await readEpisode(episodeId);
  const step = episode.pipeline.find((item) => item.status === "ready");
  if (!step) throw new Error("当前没有可以自动运行的下一步");
  return runAgent(episodeId, step.agent);
}

export async function approveGate(episodeId, gate, note = "") {
  const episode = await readEpisode(episodeId);
  if (!Object.hasOwn(episode.approvals, gate)) throw new Error(`Unknown approval gate: ${gate}`);
  episode.approvals[gate] = {
    ...episode.approvals[gate],
    status: "approved",
    at: new Date().toISOString(),
    note
  };

  const waitingStepIndex = episode.pipeline.findIndex(
    (step) => step.gate === gate && step.status === "waiting_approval"
  );
  if (waitingStepIndex >= 0) {
    episode.pipeline[waitingStepIndex] = {
      ...episode.pipeline[waitingStepIndex],
      status: "ready",
      message: "人工审批已通过，可以继续运行"
    };
  }
  if (gate === "final" && episode.qa.status === "passed" && episode.voice.status === "ready") {
    episode.status = "approved";
  }
  episode.updatedAt = new Date().toISOString();
  episode.history.push({
    at: new Date().toISOString(),
    type: "approval",
    gate,
    note
  });
  await writeEpisode(episode);
  await appendEvent({ type: "approval.granted", episodeId, gate, message: note || `${gate} 已批准` });
  return episode;
}

export function isRunning(episodeId, agentId) {
  return activeRuns.has(episodeId);
}
