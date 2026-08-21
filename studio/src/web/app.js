import {
  approvalReviewBelongsToEpisode,
  approvalReviewRequestIsCurrent,
  approvalDialogShell,
  buildApprovalDecisionRequest,
  escapeHtml,
  isApprovalBindingConflict,
  renderApprovalReview,
  renderApprovalSummaryButton
} from "./approval-review-view.mjs";

const state = {
  config: null,
  episodes: [],
  episode: null,
  events: [],
  collector: null,
  trends: null,
  research: null,
  cloud: null,
  ai: null,
  approvalReview: null,
  approvalReviewTarget: null,
  approvalReviewEpisodeId: null,
  approvalReviewTrigger: null,
  approvalReviewRequestToken: 0,
  pendingAssetPlanItemId: null,
  busy: false,
  pollTimer: null
};

const statusLabels = {
  pending: "等待",
  ready: "可运行",
  running: "运行中",
  waiting_approval: "待审批",
  blocked: "受阻",
  complete: "完成",
  failed: "失败"
};

const approvalLabels = {
  research: "研究",
  script: "脚本",
  storyboard: "分镜",
  assets: "素材",
  final: "成片"
};

const trendPoolLabels = {
  formal_candidate: "正式候选",
  continue_watching: "继续观察",
  observation_pool: "技术观察池",
  already_covered: "已制作"
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `请求失败：${response.status}`);
    error.status = response.status;
    error.code = typeof body.code === "string" ? body.code : "request_failed";
    throw error;
  }
  return body;
}

function assetUrl(path = "") {
  return `/assets/${String(path)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

function formatTime(value) {
  if (!value) return "尚未运行";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatCurrencyCap(entry) {
  const amount = Number(entry?.maximumAmount);
  if (!Number.isFinite(amount)) return null;
  if (entry.currency === "USD") return `USD ${amount.toFixed(2)}`;
  if (entry.currency === "CNY") return `CNY ${amount.toFixed(2)}`;
  return `${entry?.currency ?? "?"} ${amount.toFixed(2)}`;
}

function formatExternalBudget(summary) {
  const nativeCaps = (summary?.nativeCurrencyCaps ?? [])
    .map(formatCurrencyCap)
    .filter(Boolean);
  if (nativeCaps.length > 0) {
    return `原币种上限 ${nativeCaps.join(" + ")} · 系统归一化上限 USD ${summary.maximumPaidCostUsd}`;
  }
  return `最高外部费用 USD ${summary?.maximumPaidCostUsd ?? "-"}`;
}

function showToast(message, tone = "info") {
  const toast = document.querySelector("#toast");
  toast.hidden = false;
  toast.dataset.tone = tone;
  toast.textContent = message;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}

function clearOpenApprovalReview() {
  state.approvalReviewRequestToken += 1;
  state.approvalReview = null;
  state.approvalReviewTarget = null;
  state.approvalReviewEpisodeId = null;
}

function ensureApprovalDialog() {
  let dialog = document.querySelector("#approvalDialog");
  if (dialog) return dialog;
  document.body.insertAdjacentHTML("beforeend", approvalDialogShell());
  dialog = document.querySelector("#approvalDialog");
  dialog.addEventListener("close", () => {
    clearOpenApprovalReview();
    const trigger = state.approvalReviewTrigger;
    state.approvalReviewTrigger = null;
    if (trigger?.isConnected) trigger.focus();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return dialog;
}

function closeApprovalReview() {
  const dialog = document.querySelector("#approvalDialog");
  if (dialog?.open) dialog.close();
  else clearOpenApprovalReview();
}

async function openApprovalReview(target, trigger) {
  const episodeId = state.episode?.id;
  if (!episodeId || !target) return;
  const dialog = ensureApprovalDialog();
  const requestToken = state.approvalReviewRequestToken + 1;
  state.approvalReviewRequestToken = requestToken;
  state.approvalReviewTarget = target;
  state.approvalReviewEpisodeId = episodeId;
  state.approvalReviewTrigger = trigger;
  dialog.innerHTML = `<div class="approval-dialog-loading" role="status">
    <strong id="approvalDialogTitle">正在读取当前审批详情</strong>
    <span id="approvalDialogDescription">读取完成前不能提交任何决定。</span>
  </div>`;
  if (!dialog.open) dialog.showModal();
  try {
    const body = await api(
      `/api/episodes/${encodeURIComponent(episodeId)}/approval-review/${encodeURIComponent(target)}`
    );
    if (!approvalReviewRequestIsCurrent({
      requestToken,
      currentToken: state.approvalReviewRequestToken,
      requestedEpisodeId: episodeId,
      selectedEpisodeId: state.episode?.id,
      openEpisodeId: state.approvalReviewEpisodeId,
      requestedTarget: target,
      openTarget: state.approvalReviewTarget,
      dialogOpen: dialog.open
    })) return;
    if (!body.review) throw new Error("服务端没有返回可审核详情");
    if (!approvalReviewBelongsToEpisode(body.review, episodeId)) {
      throw new Error("审批详情所属 Episode 与当前选择不一致，已拒绝显示");
    }
    state.approvalReview = body.review;
    dialog.innerHTML = renderApprovalReview(body.review, target);
    window.requestAnimationFrame(() => dialog.querySelector(".approval-dialog-close")?.focus());
  } catch (error) {
    if (!approvalReviewRequestIsCurrent({
      requestToken,
      currentToken: state.approvalReviewRequestToken,
      requestedEpisodeId: episodeId,
      selectedEpisodeId: state.episode?.id,
      openEpisodeId: state.approvalReviewEpisodeId,
      requestedTarget: target,
      openTarget: state.approvalReviewTarget,
      dialogOpen: dialog.open
    })) return;
    clearOpenApprovalReview();
    dialog.innerHTML = `<div class="approval-dialog-error" role="alert">
      <strong id="approvalDialogTitle">审批详情读取失败</strong>
      <p id="approvalDialogDescription">${escapeHtml(error.message)}</p>
      <button class="secondary" data-action="close-approval-review">关闭</button>
    </div>`;
    window.requestAnimationFrame(() => dialog.querySelector("button")?.focus());
  }
}

function submitOpenApproval(decision) {
  const review = state.approvalReview;
  const target = state.approvalReviewTarget;
  const episodeId = state.approvalReviewEpisodeId;
  const dialog = document.querySelector("#approvalDialog");
  const note = dialog?.querySelector("#approvalDecisionNote")?.value ?? "";
  let request;
  try {
    request = buildApprovalDecisionRequest({ episodeId, target, review, decision, note });
  } catch (error) {
    showToast(error.message, "error");
    if (error.code === "approval_feedback_required") {
      dialog?.querySelector("#approvalDecisionNote")?.focus();
    }
    return;
  }
  void withBusy(async () => {
    try {
      await api(request.path, {
        method: "POST",
        body: JSON.stringify(request.body)
      });
    } catch (error) {
      if (isApprovalBindingConflict(error)) {
        closeApprovalReview();
        showToast("候选已变化，本次决定未提交。请重新打开审批详情并从头阅读。", "error");
        return;
      }
      throw error;
    }
    closeApprovalReview();
    showToast(
      decision === "approved" ? "当前精确版本已批准" : "已按当前精确版本退回上层 Agent 修改",
      "success"
    );
  });
}

function renderHeader() {
  const badge = document.querySelector("#systemBadge");
  const switcher = document.querySelector("#providerSwitch");
  const primaryAi = state.ai?.providers?.find((provider) => provider.primary);
  const aiSummary = primaryAi
    ? `${primaryAi.label}${primaryAi.configured ? "已连接" : "未配置"}`
    : "AI 状态未知";
  const message = state.config
    ? `${state.cloud?.summary || "正在检查云端备份"} · ${aiSummary}`
    : "连接失败";
  badge.innerHTML = `<span></span>${escapeHtml(message)}`;
  badge.classList.toggle("offline", !state.config);
  switcher.innerHTML = state.ai?.providers?.length
    ? `<span>AI 主通道</span>${state.ai.providers
        .filter((provider) => provider.enabled)
        .map(
          (provider) => `<button
            data-action="switch-provider"
            data-provider="${escapeHtml(provider.id)}"
            class="${provider.primary ? "active" : ""}"
            aria-pressed="${provider.primary ? "true" : "false"}"
            title="${provider.configured ? "密钥已配置" : "密钥未配置"}"
            ${state.busy || provider.primary ? "disabled" : ""}
          >${escapeHtml(provider.label)}<i class="${provider.configured ? "configured" : "unconfigured"}"></i></button>`
        )
        .join("")}`
    : "<span>AI 通道读取中</span>";
}

function renderEpisode() {
  const panel = document.querySelector("#episodePanel");
  const episode = state.episode;
  if (!episode) {
    panel.innerHTML = `
      <div class="empty-state">
        <p class="section-label">尚未创建一期</p>
        <h2>先导入 Agentic Coding 黄金样例</h2>
        <p>它会成为后续所有 Agent 的测试标准。</p>
        <button class="primary" data-action="import">导入黄金样例</button>
      </div>`;
    return;
  }

  const complete = episode.pipeline.filter((step) => step.status === "complete").length;
  const progress = Math.round((complete / episode.pipeline.length) * 100);
  const next = episode.pipeline.find((step) => step.status === "ready");
  const waitingGates = new Set(
    episode.pipeline
      .filter((step) => step.status === "waiting_approval")
      .map((step) => step.requiresApproval)
      .filter(Boolean)
  );
  const approvalMarkup = Object.entries(episode.approvals)
    .map(([gate, approval]) => {
      const approved = approval.status === "approved";
      const rejected = approval.status === "rejected";
      const machineReviewPassed =
        state.episode.control?.reviewEnabled === false ||
        state.episode.reviews?.[gate]?.status === "passed";
      const canApproveFinal =
        gate === "final" && episode.qa.status === "passed" && machineReviewPassed;
      const actionable =
        !approved && machineReviewPassed && (waitingGates.has(gate) || canApproveFinal);
      const version = approval.currentVersion ? `v${approval.currentVersion}` : "";
      const reviewStatus = actionable
        ? "waiting_approval"
        : approved
          ? "approved"
          : rejected
            ? "rejected"
            : "pending";
      return `<div class="approval-chip ${approved ? "approved" : rejected ? "rejected" : "pending"}">
        <div class="approval-chip-copy">
          <span>${approvalLabels[gate] || escapeHtml(gate)} ${version}</span>
          <strong>${approved ? "已批准" : rejected ? "已驳回" : "待确认"}</strong>
          ${approval.feedback ? `<small title="${escapeHtml(approval.feedback)}">意见：${escapeHtml(approval.feedback)}</small>` : ""}
        </div>
        <div class="approval-actions">
          ${renderApprovalSummaryButton({
            target: gate,
            status: reviewStatus,
            available: true
          })}
        </div>
      </div>`;
    })
    .join("");
  const visualProof = episode.reviewCheckpoints?.visualProof;
  const visualProofWaiting = visualProof?.status === "waiting_approval" &&
    visualProof?.machineReview?.status === "passed";
  const visualProofApproved = visualProof?.status === "approved";
  const visualProofMarkup = visualProof
    ? `<div class="execution-checkpoint ${visualProofApproved ? "approved" : visualProofWaiting ? "pending" : "blocked"}">
        <div>
          <span>视觉样片检查点 · v${visualProof.currentCandidate?.version ?? "-"}</span>
          <strong>${visualProofApproved ? "已人工批准" : visualProofWaiting ? "机器审核通过，等待你批准" : "机器检查未通过"}</strong>
          <small>只审批当前视觉样片，不批准最终成片，也不会自动发布。</small>
        </div>
        <div class="approval-actions">
          ${renderApprovalSummaryButton({
            target: "visual-proof",
            status: visualProofWaiting ? "waiting_approval" : visualProof.status,
            available: true
          })}
        </div>
      </div>`
    : "";
  const assetExecution = episode.reviewCheckpoints?.assetExecution;
  const assetExecutionSummary = assetExecution?.currentCandidate?.summary;
  const assetExecutionWaiting = assetExecution?.status === "waiting_approval" &&
    assetExecution?.machineReview?.status === "passed";
  const assetExecutionApproved = assetExecution?.status === "approved";
  const assetExecutionMarkup = assetExecution
    ? `<div class="execution-checkpoint ${assetExecutionApproved ? "approved" : assetExecutionWaiting ? "pending" : "blocked"}">
        <div>
          <span>生成前素材与费用检查点 · v${assetExecution.currentCandidate?.version ?? "-"}</span>
          <strong>${assetExecutionApproved ? "已人工批准" : assetExecutionWaiting ? "机器审核通过，等待你批准" : assetExecution.status === "rejected" ? "已驳回，退回 Asset Agent" : "机器检查未通过"}</strong>
          <small>制作方式：${escapeHtml((assetExecutionSummary?.productionMethods ?? []).join("、") || "待登记")} · 外部 API ${assetExecutionSummary?.externalApiCallCount ?? "-"} 次 · ${escapeHtml(formatExternalBudget(assetExecutionSummary))}</small>
        </div>
        <div class="approval-actions">
          ${renderApprovalSummaryButton({
            target: "asset-execution",
            status: assetExecutionWaiting
              ? "waiting_approval"
              : assetExecutionApproved
                ? "approved"
                : assetExecution.status,
            available: true
          })}
        </div>
      </div>`
    : "";
  const assetItems = episode.production?.assetPlan?.content?.items ?? [];
  const uploadedPlanItemIds = new Set(
    (episode.assets ?? []).map((asset) => asset.planItemId).filter(Boolean)
  );
  const materialItems = assetItems.filter(
    (item) => item.assetType !== "voice"
  );
  const firstMissingMaterialId = materialItems.find(
    (item) => item.required && !uploadedPlanItemIds.has(item.id)
  )?.id;
  const materialOptions = materialItems
    .map(
      (item) => `<option value="${escapeHtml(item.id)}" ${item.id === firstMissingMaterialId ? "selected" : ""}>
        ${escapeHtml(item.id)} · ${escapeHtml(item.purpose)}${uploadedPlanItemIds.has(item.id) ? "（已上传，可替换）" : ""}
      </option>`
    )
    .join("");
  const missingMaterials = materialItems.filter(
    (item) => item.required && !uploadedPlanItemIds.has(item.id)
  ).length;
  const materialUploadEnabled = !assetExecution || assetExecutionApproved;
  const materialNotice = assetItems.length
    ? `<div class="notice ${missingMaterials ? "warning" : "success"}">
        <div>
          <strong>素材清单 v${episode.production.assetPlan.version ?? 1}</strong>
          <span>${missingMaterials ? `还有 ${missingMaterials} 项必需素材待上传` : "必需素材均已登记，可在审批前继续替换"}</span>
        </div>
        ${materialItems.length
          ? `<div class="upload-controls">
              <select id="assetPlanItem" aria-label="选择素材清单条目">${materialOptions}</select>
              <button class="agent-button" data-action="asset-upload" ${materialUploadEnabled ? "" : "disabled"}>${materialUploadEnabled ? "选择素材文件" : "先批准素材与费用方案"}</button>
              <input id="assetFile" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg" hidden>
            </div>`
          : ""}
      </div>`
    : "";
  const voiceReady = episode.voice.status === "ready";
  const qualityScore = episode.qa?.quality?.score ?? episode.production?.quality?.storyboard?.score;
  panel.innerHTML = `
    <div class="episode-card-head">
      <div>
        <p class="section-label">${episode.id === "golden-001" ? "黄金样例 001" : "本期研究草稿"} · ${escapeHtml(episode.concept)}</p>
        <h2>${escapeHtml(episode.title)}</h2>
      </div>
      <span class="phase-tag">${episode.status === "approved" ? "已终审" : "制作中"}</span>
    </div>
    <p class="thesis">${escapeHtml(episode.thesis)}</p>
    <div class="progress-copy"><span>系统完成度</span><strong>${progress}%</strong></div>
    <div class="progress-track"><span style="width:${progress}%"></span></div>
    <div class="episode-meta">
      <div><span>已完成模块</span><strong>${complete}/${episode.pipeline.length}</strong></div>
      <div><span>视频规格</span><strong>${episode.render.width} × ${episode.render.height}</strong></div>
      <div><span>当前下一步</span><strong>${escapeHtml(next?.label || (episode.voice.status === "unconfigured" ? "选择旁白方案" : "等待人工决定"))}</strong></div>
      <div><span>内容质量</span><strong>${qualityScore === undefined ? "待检查" : `${qualityScore} 分`}</strong></div>
    </div>
    <div class="approval-summary">
      <div><span>人工闸门</span><small>关键决定始终由你批准</small></div>
      <div class="approval-gates">${approvalMarkup}</div>
    </div>
    ${visualProofMarkup}
    ${assetExecutionMarkup}
    ${materialNotice}
    <div class="notice ${voiceReady ? "success" : "warning"}">
      <div>
        <strong>${voiceReady ? "旁白已就绪" : "旁白尚未配置"}</strong>
        <span>${voiceReady ? "可试听后连同素材一起审批；需要时也可上传新版本。" : "正式成片不会绕过素材与声音审批。"}</span>
      </div>
      <button class="agent-button" data-action="voice-upload" ${materialUploadEnabled ? "" : "disabled"}>${materialUploadEnabled ? (voiceReady ? "替换旁白" : "上传旁白") : "先批准素材与费用方案"}</button>
      <input id="voiceFile" type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg" hidden>
    </div>`;
}

function renderPreview() {
  const panel = document.querySelector("#previewPanel");
  const episode = state.episode;
  const poster = episode?.assets?.find((asset) => asset.type === "image")?.path;
  const posterUrl = poster ? assetUrl(poster) : "";
  if (!episode?.render?.outputPath || episode.render.status !== "complete") {
    const previewMessage =
      episode?.render?.status === "stale"
        ? "素材或审批已变化，等待重新渲染"
        : episode
          ? "等待运行渲染 Agent"
          : "等待导入样例";
    panel.innerHTML = `
      <div class="preview-placeholder" ${posterUrl ? `style="background-image:url('${escapeHtml(posterUrl)}')"` : ""}>
        <div class="preview-shade"></div>
        <span>视觉验证版</span>
        <strong>${previewMessage}</strong>
        <small>${episode ? `${episode.render.durationSeconds ? `${episode.render.durationSeconds} 秒 · ` : ""}${episode.render.fps}fps` : "9:16"}</small>
      </div>`;
    return;
  }

  const outputRelative = episode.render.outputPath.replace(/^outputs\/studio\//u, "");
  const videoUrl = `/outputs/${outputRelative}?v=${encodeURIComponent(episode.render.renderedAt || Date.now())}`;
  panel.innerHTML = `
    <div class="video-wrap">
      <video controls preload="metadata" ${posterUrl ? `poster="${escapeHtml(posterUrl)}"` : ""} src="${videoUrl}"></video>
      <div class="video-meta">
        <div>
          <span>视觉验证版</span>
          <strong>${episode.render.muted ? "无旁白 · 等待声音审批" : "已包含旁白"}</strong>
        </div>
        <span class="qa-pill ${episode.qa.status}">${episode.qa.status === "passed" ? `QA ${episode.qa.quality?.score ?? ""} 分` : "等待 QA"}</span>
      </div>
    </div>`;
}

function renderPipeline() {
  const container = document.querySelector("#pipeline");
  if (!state.episode) {
    container.innerHTML = '<div class="empty-line">导入一期后显示完整流水线</div>';
    return;
  }
  container.innerHTML = state.episode.pipeline
    .map(
      (step, index) => `
        <div class="pipeline-step status-${step.status}">
          <div class="step-index">${String(index + 1).padStart(2, "0")}</div>
          <div>
            <strong>${escapeHtml(step.label)}</strong>
            <span>${statusLabels[step.status] || step.status}</span>
          </div>
        </div>`
    )
    .join("");
}

function renderAgents() {
  const container = document.querySelector("#agents");
  if (!state.episode) {
    container.innerHTML = '<div class="empty-line">还没有可运行的 Agent</div>';
    return;
  }
  container.innerHTML = state.episode.pipeline
    .map((step) => {
      const gateApproved = !step.gate || state.episode.approvals[step.gate]?.status === "approved";
      const canRun =
        ["ready", "failed", "blocked"].includes(step.status) ||
        (step.status === "waiting_approval" && gateApproved);
      const disabled = state.busy || step.status === "running" || !canRun;
      return `
        <div class="agent-row">
          <div class="agent-icon">${escapeHtml(step.label.slice(0, 1))}</div>
          <div class="agent-copy">
            <div><strong>${escapeHtml(step.label)}</strong><span class="status-dot status-${step.status}">${statusLabels[step.status]}</span></div>
            <p>${escapeHtml(step.message || (step.mode === "imported-approved-artifact" ? "已从黄金样例导入并校验" : "尚未运行"))}</p>
            ${step.attempts ? `<small>已运行 ${step.attempts} 次${step.lastError ? " · 可重试" : ""}</small>` : ""}
            ${step.status === "running" ? `<div class="mini-progress"><span style="width:${Math.round((step.progress || 0) * 100)}%"></span></div>` : ""}
          </div>
          <button class="agent-button" data-action="run-agent" data-agent="${step.agent}" ${disabled ? "disabled" : ""}>
            ${step.status === "failed" ? "重试" : step.status === "blocked" ? "继续补证" : step.status === "waiting_approval" ? "待审批" : "运行"}
          </button>
        </div>`;
    })
    .join("");
}

function renderEvents() {
  const container = document.querySelector("#events");
  if (state.events.length === 0) {
    container.innerHTML = '<div class="empty-line">暂无运行记录</div>';
    return;
  }
  container.innerHTML = state.events
    .slice(0, 12)
    .map(
      (event) => `
        <div class="event-row">
          <span class="event-mark"></span>
          <div>
            <strong>${escapeHtml(event.message || event.type)}</strong>
            <span>${formatTime(event.at)}${event.agentId ? ` · ${escapeHtml(event.agentId)}` : ""}</span>
          </div>
        </div>`
    )
    .join("");
}

function renderTrendRadar() {
  const container = document.querySelector("#trendRadar");
  const trendState = state.trends;
  const run = trendState?.run;
  if (!run) {
    container.innerHTML = `
      <div class="trend-empty">
        <strong>还没有运行热点发现</strong>
        <span>系统会从公开创作者信号里抽取技术概念，不会把单个产品发布直接当成选题。</span>
      </div>`;
    return;
  }

  const visibleCandidates = run.candidates
    .filter((candidate) => candidate.recommendedPool !== "already_covered")
    .slice(0, 6);
  container.innerHTML = `
    <div class="trend-summary">
      <div><span>信号</span><strong>${run.summary.signalCount}</strong></div>
      <div><span>独立创作者组</span><strong>${run.summary.creatorCount}</strong></div>
      <div><span>正式候选</span><strong>${run.summary.formalCandidateCount}</strong></div>
      <div><span>已做概念</span><strong>${run.summary.alreadyCoveredCount || 0}</strong></div>
      <div class="trend-method">
        <span>最近运行</span>
        <strong>${formatTime(run.generatedAt)}</strong>
        <small>缺失播放量和评论数据不会被猜测</small>
      </div>
    </div>
    <div class="candidate-grid">
      ${visibleCandidates
        .map((candidate) => {
          const selected = candidate.selectionStatus === "selected_for_research";
          const canSelect = candidate.recommendedPool === "formal_candidate" && !selected;
          const creatorNames = candidate.creatorEvidence
            .slice(0, 4)
            .map((creator) => escapeHtml(creator.name))
            .join("、");
          return `
            <article class="candidate-card pool-${candidate.recommendedPool} ${selected ? "selected" : ""}">
              <div class="candidate-topline">
                <span class="candidate-rank">${String(candidate.rank).padStart(2, "0")}</span>
                <span class="pool-label">${trendPoolLabels[candidate.recommendedPool] || candidate.recommendedPool}</span>
                <span class="confidence-label">${candidate.confidence.level === "high" ? "高" : candidate.confidence.level === "medium" ? "中" : "低"}置信度</span>
              </div>
              <h3>${escapeHtml(candidate.concept)}</h3>
              <p class="candidate-title">${escapeHtml(candidate.recommendedTitle)}</p>
              <div class="candidate-metrics">
                <div><span>已知维度</span><strong>${candidate.score.rawScore}/${candidate.score.availablePoints}</strong></div>
                <div><span>14 天创作者</span><strong>${candidate.heatGate.creators14}</strong></div>
                <div><span>事件占比</span><strong>${Math.round(candidate.eventShare * 100)}%</strong></div>
              </div>
              <p class="creator-evidence">近期信号：${creatorNames || "待补充"}</p>
              <p class="data-gap">${escapeHtml(candidate.reasons.find((reason) => reason.includes("缺少")) || "已获得相对表现数据")}</p>
              ${selected
                ? '<button class="selected-button" disabled>已选为研究候选</button>'
                : `<button class="candidate-button" data-action="select-trend" data-candidate="${candidate.id}" ${canSelect ? "" : "disabled"}>${canSelect ? "选为研究候选" : "继续观察"}</button>`}
            </article>`;
        })
        .join("")}
    </div>`;
}

function renderCollector() {
  const container = document.querySelector("#collectorStatus");
  const collector = state.collector;
  if (!collector) {
    container.innerHTML = '<div class="empty-line">正在读取观察源状态</div>';
    return;
  }
  const summary = collector.summary;
  const needsAssist = collector.sources.filter(
    (source) => source.status === "needs_assist" && !source.fresh
  );
  const staleSources = collector.sources.filter((source) => !source.fresh);
  const failed = collector.sources.filter(
    (source) => source.status === "failed" || source.status === "degraded"
  );
  const latest = collector.latestRun;
  const names = staleSources
    .slice(0, 6)
    .map((source) => escapeHtml(source.name))
    .join("、");
  container.innerHTML = `
    <div class="collector-summary">
      <div><span>观察源</span><strong>${summary.configuredSources}</strong></div>
      <div><span>近期有信号</span><strong>${summary.freshSources}</strong></div>
      <div><span>程序直读</span><strong>${summary.directSuccess}</strong></div>
      <div><span>Codex 辅助</span><strong>${summary.assistedSuccess}</strong></div>
      <div><span>待更新</span><strong>${summary.staleSources}</strong></div>
      <div><span>本轮异常</span><strong>${summary.failed + (summary.degraded || 0)}</strong></div>
    </div>
    <div class="collector-detail ${failed.length ? "has-failure" : ""}">
      <div>
        <strong>${latest ? `最近运行：${formatTime(latest.finishedAt)}` : "尚未运行公开页面采集"}</strong>
        <span>${latest ? `本轮发现 ${latest.summary.observationsFound} 条观察，新增 ${latest.summary.signalsAdded} 条信号，更新 ${latest.summary.signalsUpdated} 条` : "首次运行会检查全部公开来源，并把无法直接读取的平台交给 Codex 辅助。"}</span>
      </div>
      <p>${staleSources.length ? `待补近期内容：${names}${staleSources.length > 6 ? ` 等 ${staleSources.length} 个来源` : ""}${needsAssist.length ? `；其中 ${needsAssist.length} 个需 Codex 辅助` : ""}` : "全部观察源都有 7 天内的新信号。"}</p>
      <small>不使用账号 Cookie；读取不到就明确标记，不猜测作品和互动数据。</small>
    </div>`;
}

function renderResearch() {
  const container = document.querySelector("#researchWorkbench");
  const research = state.research;
  const selection = research?.selection;
  const pack = research?.pack;
  if (!selection) {
    container.innerHTML = `
      <div class="research-empty">
        <strong>等待你选择研究主题</strong>
        <span>只有热点雷达中的正式候选可以进入研究；创作者视频仍只作为热度信号。</span>
      </div>`;
    return;
  }

  const readiness = pack?.readiness;
  const accessible = pack?.sources?.filter((source) => source.access.status === "accessible").length ?? 0;
  const sources = pack?.sources ?? selection.primarySources?.map((source, index) => ({
    id: `planned-${index}`,
    label: source.label,
    url: source.url,
    sourceType: "待分类",
    evidenceStatus: "unreviewed",
    access: { status: "unchecked" }
  })) ?? [];
  const reasonText = readiness?.reasons?.length
    ? readiness.reasons.join("；")
    : "证据已达到研究审批门槛";
  container.innerHTML = `
    <div class="research-topic">
      <div>
        <span>已选概念</span>
        <strong>${escapeHtml(selection.concept)}</strong>
        <p>${escapeHtml(selection.recommendedTitle)}</p>
      </div>
      <span class="research-state ${readiness?.readyForFactApproval ? "ready" : "pending"}">${readiness?.readyForFactApproval ? "可提交研究审批" : pack ? "正在补证" : "等待首次运行"}</span>
    </div>
    <div class="research-summary">
      <div><span>计划来源</span><strong>${sources.length}</strong></div>
      <div><span>网页可读取</span><strong>${accessible}</strong></div>
      <div><span>已核验证据</span><strong>${readiness?.verifiedSourceCount ?? 0}</strong></div>
      <div><span>支持主张</span><strong>${readiness?.supportedClaimCount ?? 0}</strong></div>
      <div><span>交叉核验</span><strong>${readiness?.crossSourceClaimCount ?? 0}</strong></div>
    </div>
    <div class="research-source-list">
      ${sources.map((source) => `
        <div class="research-source-row">
          <div>
            <strong>${escapeHtml(source.label)}</strong>
            <span>${escapeHtml(source.sourceType)} · ${escapeHtml(source.url)}</span>
          </div>
          <div class="source-badges">
            <span class="source-badge status-${source.access.status}">${source.access.status === "accessible" ? "可读取" : source.access.status === "unchecked" ? "待检查" : "需辅助"}</span>
            <span class="source-badge evidence-${source.evidenceStatus}">${source.evidenceStatus === "verified" ? "证据已核验" : "尚未提取事实"}</span>
          </div>
        </div>`).join("")}
    </div>
    <div class="research-gate ${readiness?.readyForFactApproval ? "ready" : "pending"}">
      <strong>${readiness?.readyForFactApproval ? "研究闸门已就绪" : "当前不能批准研究结论"}</strong>
      <p>${escapeHtml(reasonText)}</p>
      <small>直接读取网页只证明资料可访问；来源里的主张、定位和适用边界仍需 Codex 或人工核验。</small>
    </div>`;
}

function renderAll() {
  renderHeader();
  renderEpisode();
  renderPreview();
  renderPipeline();
  renderAgents();
  renderEvents();
  renderCollector();
  renderTrendRadar();
  renderResearch();

  const nextButton = document.querySelector('[data-action="run-next"]');
  const nextStep = state.episode?.pipeline.find((step) => step.status === "ready");
  nextButton.disabled = state.busy || !nextStep;
  nextButton.textContent = nextStep ? `运行：${nextStep.label}` : "暂无可运行步骤";
  const researchButton = document.querySelector('[data-action="run-research"]');
  const researchSelection = state.research?.selection;
  const researchApproved = state.research?.episode?.researchApproval?.status === "approved";
  researchButton.disabled = state.busy || !researchSelection || researchApproved;
  researchButton.textContent = !researchSelection
    ? "先选择一个正式候选"
    : researchApproved
      ? "研究已批准"
      : state.research?.pack
        ? "继续核验研究资料"
        : "运行研究 Agent";
}

async function refresh({ quiet = false } = {}) {
  try {
    const [configBody, episodesBody, eventsBody, collectorBody, trendsBody, researchBody, cloudBody, aiBody] = await Promise.all([
      api("/api/config"),
      api("/api/episodes"),
      api("/api/events"),
      api("/api/collector"),
      api("/api/trends"),
      api("/api/research"),
      api("/api/cloud"),
      api("/api/ai/status")
    ]);
    state.config = configBody;
    state.episodes = episodesBody.episodes;
    state.events = eventsBody.events;
    state.collector = collectorBody;
    state.trends = trendsBody;
    state.research = researchBody;
    state.cloud = cloudBody;
    state.ai = aiBody;
    if (state.episodes[0]) {
      state.episode = (await api(`/api/episodes/${state.episodes[0].id}`)).episode;
    } else {
      state.episode = null;
    }
    if (
      state.approvalReviewEpisodeId &&
      state.approvalReviewEpisodeId !== state.episode?.id
    ) {
      closeApprovalReview();
    }
    renderAll();
  } catch (error) {
    if (!quiet) showToast(error.message, "error");
    state.config = null;
    renderAll();
  }
}

async function withBusy(action) {
  if (state.busy) return;
  state.busy = true;
  document.body.classList.add("is-busy");
  renderAgents();
  try {
    await action();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.busy = false;
    document.body.classList.remove("is-busy");
    await refresh({ quiet: true });
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;

  if (action === "refresh") void refresh();
  if (action === "import") {
    void withBusy(async () => {
      await api("/api/import/golden", { method: "POST", body: "{}" });
      showToast("黄金样例已同步为可执行一期", "success");
    });
  }
  if (action === "run-next" && state.episode) {
    void withBusy(async () => {
      showToast("系统正在运行下一步，视频渲染可能需要几分钟");
      await api(`/api/episodes/${state.episode.id}/run-next`, { method: "POST", body: "{}" });
      showToast("下一步已完成", "success");
    });
  }
  if (action === "run-agent" && state.episode) {
    void withBusy(async () => {
      const agent = button.dataset.agent;
      showToast(`${button.closest(".agent-row").querySelector("strong").textContent}正在运行`);
      await api(`/api/episodes/${state.episode.id}/agents/${agent}/run`, {
        method: "POST",
        body: "{}"
      });
      showToast("Agent 已完成本轮运行", "success");
    });
  }
  if (action === "run-trends") {
    void withBusy(async () => {
      showToast("正在重新计算近期概念热度");
      await api("/api/trends/run", { method: "POST", body: "{}" });
      showToast("热点概念发现完成", "success");
    });
  }
  if (action === "run-collector") {
    void withBusy(async () => {
      showToast("正在更新公开创作者信号；部分平台会转入 Codex 辅助队列");
      const result = await api("/api/collector/run", { method: "POST", body: "{}" });
      showToast(
        `采集完成：${result.run.summary.directSuccess} 个直读，${result.run.summary.assistedRequired} 个需辅助`,
        "success"
      );
    });
  }
  if (action === "run-research") {
    void withBusy(async () => {
      showToast("正在检查一手资料并建立事实证据任务");
      const result = await api("/api/research/run", {
        method: "POST",
        body: JSON.stringify({ episodeId: state.research?.selection?.episodeId })
      });
      showToast(
        result.output.status === "waiting_approval"
          ? "研究证据已达到门槛，等待你批准研究结论"
          : "研究计划已建立，证据缺口已明确列出",
        "success"
      );
    });
  }
  if (action === "select-trend") {
    void withBusy(async () => {
      const candidateId = button.dataset.candidate;
      await api(`/api/trends/candidates/${candidateId}/select`, {
        method: "POST",
        body: JSON.stringify({ note: "在概念雷达中选择" })
      });
      showToast("候选已进入研究阶段", "success");
    });
  }
  if (action === "open-approval-review") {
    void openApprovalReview(button.dataset.approvalTarget, button);
  }
  if (action === "close-approval-review") closeApprovalReview();
  if (action === "approve-open-approval") submitOpenApproval("approved");
  if (action === "reject-open-approval") submitOpenApproval("rejected");
  if (action === "switch-provider") {
    void withBusy(async () => {
      const providerId = button.dataset.provider;
      await api("/api/ai/primary", {
        method: "POST",
        body: JSON.stringify({ providerId })
      });
      showToast(`AI 主通道已切换为 ${button.textContent.trim()}`, "success");
    });
  }
  if (action === "asset-upload" && state.episode) {
    const selector = document.querySelector("#assetPlanItem");
    if (!selector?.value) {
      showToast("素材清单中没有可上传的画面条目", "error");
      return;
    }
    state.pendingAssetPlanItemId = selector.value;
    document.querySelector("#assetFile")?.click();
  }
  if (action === "voice-upload" && state.episode) {
    document.querySelector("#voiceFile")?.click();
  }
});

document.addEventListener("change", (event) => {
  if (!state.episode) return;
  if (event.target.id === "assetFile") {
    const file = event.target.files?.[0];
    const planItemId = state.pendingAssetPlanItemId;
    if (!file || !planItemId) return;
    void withBusy(async () => {
      showToast(`正在上传素材 ${planItemId}`);
      await api(`/api/episodes/${state.episode.id}/assets/upload`, {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-file-name": encodeURIComponent(file.name),
          "x-plan-item-id": encodeURIComponent(planItemId)
        },
        body: file
      });
      state.pendingAssetPlanItemId = null;
      showToast("素材已登记，请重新运行素材 Agent 核验清单", "success");
    });
    return;
  }
  if (event.target.id !== "voiceFile") return;
  const file = event.target.files?.[0];
  if (!file) return;
  void withBusy(async () => {
    showToast("正在上传旁白文件");
    await api(`/api/episodes/${state.episode.id}/voice/upload`, {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name)
      },
      body: file
    });
    showToast("旁白已登记，请运行旁白 Agent；机器审核通过后再进行人工审批", "success");
  });
});

await refresh();
state.pollTimer = window.setInterval(() => void refresh({ quiet: true }), 2500);
