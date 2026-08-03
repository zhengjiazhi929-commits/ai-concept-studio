const state = {
  config: null,
  episodes: [],
  episode: null,
  events: [],
  collector: null,
  trends: null,
  research: null,
  cloud: null,
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
  topic: "选题",
  facts: "事实",
  script: "脚本",
  visual: "视觉",
  voice: "声音",
  final: "终审"
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
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function renderHeader() {
  const badge = document.querySelector("#systemBadge");
  const message = state.config ? state.cloud?.summary || "正在检查云端备份" : "连接失败";
  badge.innerHTML = `<span></span>${escapeHtml(message)}`;
  badge.classList.toggle("offline", !state.config);
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
      .map((step) => step.requiresApproval || step.gate)
      .filter(Boolean)
  );
  const approvalMarkup = Object.entries(episode.approvals)
    .map(([gate, approval]) => {
      const approved = approval.status === "approved";
      const canApproveFinal =
        gate === "final" && episode.qa.status === "passed" && episode.voice.status === "ready";
      const actionable = !approved && (waitingGates.has(gate) || canApproveFinal);
      return `<div class="approval-chip ${approved ? "approved" : "pending"}">
        <span>${approvalLabels[gate] || escapeHtml(gate)}</span>
        ${actionable
          ? `<button data-action="approve" data-gate="${escapeHtml(gate)}">批准</button>`
          : `<strong>${approved ? "已批准" : "待确认"}</strong>`}
      </div>`;
    })
    .join("");
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
    </div>
    <div class="approval-summary">
      <div><span>人工闸门</span><small>关键决定始终由你批准</small></div>
      <div class="approval-gates">${approvalMarkup}</div>
    </div>
    <div class="notice ${episode.voice.status === "unconfigured" ? "warning" : "success"}">
      ${episode.voice.status === "unconfigured"
        ? "旁白尚未配置：可以先生成无旁白视觉验证版，正式样片不会绕过声音审批。"
        : "旁白已经就绪，可以进入正式预览。"}
    </div>`;
}

function renderPreview() {
  const panel = document.querySelector("#previewPanel");
  const episode = state.episode;
  const poster = episode?.assets?.find((asset) => asset.type === "image")?.path;
  const posterUrl = poster ? assetUrl(poster) : "";
  if (!episode?.render?.outputPath) {
    panel.innerHTML = `
      <div class="preview-placeholder" ${posterUrl ? `style="background-image:url('${escapeHtml(posterUrl)}')"` : ""}>
        <div class="preview-shade"></div>
        <span>视觉验证版</span>
        <strong>${episode ? "等待运行渲染 Agent" : "等待导入样例"}</strong>
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
        <span class="qa-pill ${episode.qa.status}">${episode.qa.status === "passed" ? "QA 通过" : "等待 QA"}</span>
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
    : "证据已达到事实审批门槛";
  container.innerHTML = `
    <div class="research-topic">
      <div>
        <span>已选概念</span>
        <strong>${escapeHtml(selection.concept)}</strong>
        <p>${escapeHtml(selection.recommendedTitle)}</p>
      </div>
      <span class="research-state ${readiness?.readyForFactApproval ? "ready" : "pending"}">${readiness?.readyForFactApproval ? "可提交事实审批" : pack ? "正在补证" : "等待首次运行"}</span>
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
      <strong>${readiness?.readyForFactApproval ? "事实闸门已就绪" : "当前不能批准事实"}</strong>
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
  const factsApproved = state.research?.episode?.factsApproval?.status === "approved";
  researchButton.disabled = state.busy || !researchSelection || factsApproved;
  researchButton.textContent = !researchSelection
    ? "先选择一个正式候选"
    : factsApproved
      ? "事实已批准"
      : state.research?.pack
        ? "继续核验研究资料"
        : "运行研究 Agent";
}

async function refresh({ quiet = false } = {}) {
  try {
    const [configBody, episodesBody, eventsBody, collectorBody, trendsBody, researchBody, cloudBody] = await Promise.all([
      api("/api/config"),
      api("/api/episodes"),
      api("/api/events"),
      api("/api/collector"),
      api("/api/trends"),
      api("/api/research"),
      api("/api/cloud")
    ]);
    state.config = configBody;
    state.episodes = episodesBody.episodes;
    state.events = eventsBody.events;
    state.collector = collectorBody;
    state.trends = trendsBody;
    state.research = researchBody;
    state.cloud = cloudBody;
    if (state.episodes[0]) {
      state.episode = (await api(`/api/episodes/${state.episodes[0].id}`)).episode;
    } else {
      state.episode = null;
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
          ? "研究证据已达到门槛，等待你批准事实"
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
  if (action === "approve" && state.episode) {
    void withBusy(async () => {
      const gate = button.dataset.gate;
      await api(`/api/episodes/${state.episode.id}/approvals/${gate}`, {
        method: "POST",
        body: JSON.stringify({ note: "在本地控制台批准" })
      });
      showToast(`${approvalLabels[gate] || gate}审批已通过`, "success");
    });
  }
});

await refresh();
state.pollTimer = window.setInterval(() => void refresh({ quiet: true }), 2500);
