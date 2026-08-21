const activeOperations = new Map();

export function acquireEpisodeOperation(episodeId, kind, options = {}) {
  const existing = activeOperations.get(episodeId);
  if (existing) {
    const error = new Error(
      options.conflictMessage ?? "这一期已有 Agent 操作正在运行，请等待它完成"
    );
    error.code = "episode_operation_active";
    error.activeKind = existing.kind;
    throw error;
  }
  const token = Symbol(`${episodeId}:${kind}`);
  activeOperations.set(episodeId, { kind, token });
  return () => {
    if (activeOperations.get(episodeId)?.token === token) activeOperations.delete(episodeId);
  };
}

export function episodeOperation(episodeId) {
  const operation = activeOperations.get(episodeId);
  return operation ? { kind: operation.kind } : null;
}

export function isEpisodeOperationActive(episodeId) {
  return activeOperations.has(episodeId);
}

export function claimPersistedEpisodeOperation(episode, operation) {
  const existing = episode.control?.activeOperation;
  if (existing && existing.id !== operation.id) {
    const error = new Error("这一期已有持久化 Agent 操作正在运行，请等待或先执行中断恢复");
    error.code = "episode_operation_active";
    error.activeKind = existing.kind;
    throw error;
  }
  episode.control.activeOperation = {
    id: operation.id,
    kind: operation.kind,
    startedAt: (operation.now instanceof Date
      ? operation.now
      : new Date(operation.now ?? Date.now())).toISOString()
  };
  return episode;
}

export function releasePersistedEpisodeOperation(episode, operationId) {
  if (episode.control?.activeOperation?.id === operationId) {
    episode.control.activeOperation = null;
    return true;
  }
  return false;
}
