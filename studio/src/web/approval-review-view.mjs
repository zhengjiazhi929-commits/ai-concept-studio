const FORMAL_GATE_TARGETS = new Set([
  "research",
  "script",
  "storyboard",
  "assets",
  "final"
]);

const targetLabels = {
  research: "研究",
  script: "脚本",
  storyboard: "分镜",
  assets: "素材与声音",
  final: "最终成片",
  "visual-proof": "视觉样片",
  "asset-execution": "素材执行方案"
};

const fieldLabels = {
  artifactVersion: "候选版本",
  artifactHash: "候选内容哈希",
  reviewReportId: "机器审核报告",
  candidateVersion: "候选版本",
  candidateHash: "候选哈希",
  machineReviewId: "机器审核报告",
  planHash: "方案内容哈希",
  status: "状态",
  decision: "结论",
  checkedAt: "检查时间",
  confidence: "置信度",
  version: "版本",
  id: "标识",
  title: "标题",
  purpose: "用途",
  assetType: "素材类型",
  sceneIds: "覆盖镜头",
  required: "是否必需",
  kind: "制作方式",
  executor: "执行器",
  externalProvider: "外部 Provider",
  externalModel: "外部模型",
  notes: "说明",
  mode: "执行模式",
  maximumPaidCostUsd: "外部费用上限（USD）",
  currency: "币种",
  pricingConfirmed: "价格是否确认",
  humanApprovalRequiredBeforeExecution: "执行前需人工批准",
  invalidatesOnPlanChange: "方案变化后批准失效",
  externalApiCalls: "外部 API 调用",
  sourceRequirement: "来源要求",
  rightsRequirement: "权利要求"
};

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null || value === "" ? [] : [value];
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function labelForField(key) {
  return fieldLabels[key] ?? String(key)
    .replaceAll(/([a-z])([A-Z])/gu, "$1 $2")
    .replaceAll("_", " ");
}

function displayScalar(value) {
  if (value === true) return "是";
  if (value === false) return "否";
  if (value === null || value === undefined || value === "") return "未登记";
  return String(value);
}

function displayJson(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="approval-empty-inline">无</span>';
    if (value.every((entry) => !isPlainObject(entry) && !Array.isArray(entry))) {
      return `<ul class="approval-plain-list">${value
        .map((entry) => `<li>${escapeHtml(displayScalar(entry))}</li>`)
        .join("")}</ul>`;
    }
    return `<div class="approval-generic-cards">${value
      .map((entry) => `<article>${renderValue(entry)}</article>`)
      .join("")}</div>`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '<span class="approval-empty-inline">无</span>';
    return `<dl class="approval-data-list">${entries
      .map(([key, entry]) => `<div><dt>${escapeHtml(labelForField(key))}</dt><dd>${renderValue(entry)}</dd></div>`)
      .join("")}</dl>`;
  }
  return `<span>${escapeHtml(displayScalar(value))}</span>`;
}

function renderCollection(title, value, options = {}) {
  const entries = asArray(value);
  const empty = entries.length === 0 || (isPlainObject(value) && Object.keys(value).length === 0);
  return `<section class="approval-review-section ${options.tone ? `tone-${escapeHtml(options.tone)}` : ""}">
    <div class="approval-section-heading">
      <h3>${escapeHtml(title)}</h3>
      ${options.summary ? `<span>${escapeHtml(options.summary)}</span>` : ""}
    </div>
    ${empty
      ? `<p class="approval-empty">${escapeHtml(options.emptyText ?? "无")}</p>`
      : renderValue(value)}
  </section>`;
}

function targetFromReview(review, requestedTarget) {
  const value = String(requestedTarget ?? review?.type ?? "");
  const normalized = value.startsWith("approval-review:")
    ? value.slice("approval-review:".length)
    : value;
  if (normalized === "assetExecution") return "asset-execution";
  if (normalized === "visualProof") return "visual-proof";
  return normalized;
}

export function approvalReviewRequestIsCurrent({
  requestToken,
  currentToken,
  requestedEpisodeId,
  selectedEpisodeId,
  openEpisodeId,
  requestedTarget,
  openTarget,
  dialogOpen
} = {}) {
  return Boolean(
    dialogOpen &&
    requestToken === currentToken &&
    requestedEpisodeId &&
    requestedEpisodeId === selectedEpisodeId &&
    requestedEpisodeId === openEpisodeId &&
    requestedTarget &&
    requestedTarget === openTarget
  );
}

export function approvalReviewBelongsToEpisode(review, requestedEpisodeId) {
  return Boolean(
    requestedEpisodeId &&
    typeof review?.episode?.id === "string" &&
    review.episode.id === requestedEpisodeId
  );
}

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function approvalBindingComplete(review, requestedTarget) {
  const target = targetFromReview(review, requestedTarget);
  const binding = review?.binding ?? {};
  if (target === "visual-proof") {
    return Boolean(
      Number.isInteger(binding.candidateVersion) && binding.candidateVersion > 0 &&
      sha256(binding.candidateHash) &&
      typeof binding.machineReviewId === "string" && binding.machineReviewId.length > 0
    );
  }
  if (target === "asset-execution") {
    return Boolean(
      Number.isInteger(binding.candidateVersion) && binding.candidateVersion > 0 &&
      sha256(binding.candidateHash) &&
      typeof binding.machineReviewId === "string" && binding.machineReviewId.length > 0 &&
      sha256(binding.planHash)
    );
  }
  if (!FORMAL_GATE_TARGETS.has(target)) return false;
  return Boolean(
    Number.isInteger(binding.artifactVersion) && binding.artifactVersion > 0 &&
    sha256(binding.artifactHash) &&
    typeof binding.reviewReportId === "string" && binding.reviewReportId.length > 0
  );
}

function statusValue(status, key) {
  return isPlainObject(status) ? status[key] : undefined;
}

export function approvalReviewCanApprove(review, requestedTarget) {
  if (!approvalBindingComplete(review, requestedTarget)) return false;
  if (typeof review?.status?.readyForHumanApproval === "boolean") {
    return review.status.readyForHumanApproval;
  }
  const explicit = statusValue(review?.status, "canApprove");
  if (typeof explicit === "boolean") return explicit;
  const status = typeof review?.status === "string"
    ? review.status
    : statusValue(review?.status, "approvalStatus") ?? statusValue(review?.status, "status");
  const machineStatus = review?.machineReview?.status ?? review?.machineReview?.decision;
  return status === "waiting_approval" && machineStatus === "passed";
}

export function approvalReviewCanReject(review, requestedTarget) {
  const target = targetFromReview(review, requestedTarget);
  if (!approvalBindingComplete(review, target)) return false;
  if (target === "visual-proof") return false;
  const rejectAction = asArray(review?.nextActions).find((action) => action?.id === "reject");
  if (typeof rejectAction?.allowed === "boolean") return rejectAction.allowed;
  const explicit = statusValue(review?.status, "canReject");
  if (typeof explicit === "boolean") return explicit;
  const approvalStatus = review?.approvalObject?.status;
  const status = typeof review?.status === "string"
    ? review.status
    : statusValue(review?.status, "approvalStatus") ?? statusValue(review?.status, "status");
  return approvalStatus === "approved" || status === "waiting_approval";
}

export function renderApprovalSummaryButton({ target, status, available = true } = {}) {
  if (!available) return "";
  return `<button class="approval-review-button" data-action="open-approval-review" data-approval-target="${escapeHtml(target ?? "")}">查看并审批</button>`;
}

function renderBinding(review, target) {
  const binding = review?.binding ?? {};
  const entries = target === "visual-proof"
    ? ["candidateVersion", "candidateHash", "machineReviewId"]
    : target === "asset-execution"
    ? ["candidateVersion", "candidateHash", "machineReviewId", "planHash"]
    : ["artifactVersion", "artifactHash", "reviewReportId"];
  return `<section class="approval-review-section approval-binding">
    <div class="approval-section-heading">
      <h3>本次决定的精确绑定</h3>
      <span>${approvalBindingComplete(review, target) ? "字段完整" : "字段不完整，禁止批准"}</span>
    </div>
    <dl class="approval-binding-grid">${entries.map((key) => `<div>
      <dt>${escapeHtml(labelForField(key))}</dt>
      <dd><code>${escapeHtml(displayScalar(binding[key]))}</code></dd>
    </div>`).join("")}</dl>
  </section>`;
}

function seconds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(3).replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1")}s` : "?";
}

function renderStoryboard(review) {
  const content = review?.content ?? {};
  const draft = content.draft ?? content.storyboardDraft ?? {};
  const scenes = asArray(content.scenes);
  const subtitles = asArray(content.subtitles);
  const rules = asArray(draft.visualRules ?? content.visualRules);
  const checklist = asArray(draft.assetChecklist ?? content.assetChecklist);
  const render = content.renderSpecification ?? content.render ?? {};
  return `
    <section class="approval-review-section">
      <div class="approval-section-heading"><h3>Storyboard ${scenes.length} 镜</h3><span>${escapeHtml(`${seconds(render.durationSeconds ?? scenes.at(-1)?.end)} · ${render.width ?? "?"}×${render.height ?? "?"} · ${render.fps ?? "?"}fps`)}</span></div>
      ${scenes.length ? `<div class="approval-scene-list">${scenes.map((scene) => `<article>
        <div><span>${escapeHtml(scene.id ?? "镜头")}</span><small>${escapeHtml(`${seconds(scene.start)}–${seconds(scene.end)}`)}</small></div>
        <strong>${escapeHtml(scene.title ?? scene.statement ?? "未命名镜头")}</strong>
        ${scene.statement ? `<p>${escapeHtml(scene.statement)}</p>` : ""}
        ${scene.subtitle ? `<blockquote>${escapeHtml(scene.subtitle)}</blockquote>` : ""}
        ${scene.assetHint ? `<small class="approval-muted">画面要求：${escapeHtml(scene.assetHint)}</small>` : ""}
      </article>`).join("")}</div>` : '<p class="approval-empty">没有可审核的镜头，禁止批准。</p>'}
    </section>
    <section class="approval-review-section">
      <div class="approval-section-heading"><h3>完整字幕</h3><span>${subtitles.length} 条</span></div>
      ${subtitles.length ? `<ol class="approval-subtitle-list">${subtitles.map((subtitle) => `<li>
        <time>${escapeHtml(`${seconds(subtitle.start)}–${seconds(subtitle.end)}`)}</time>
        <span>${escapeHtml(subtitle.text ?? "")}</span>
      </li>`).join("")}</ol>` : '<p class="approval-empty">没有字幕。</p>'}
    </section>
    ${renderCollection("视觉规则", rules, { emptyText: "没有登记视觉规则。" })}
    ${renderCollection("素材检查清单", checklist, { emptyText: "没有登记素材检查项。" })}`;
}

function estimatedCostLabel(cost = {}) {
  const amount = Number(cost.maximumCostUsd);
  return Number.isFinite(amount) ? `最高 USD ${amount.toFixed(2)}` : "费用未登记";
}

export function safeApprovalMediaUrl(path) {
  if (typeof path !== "string" || !path.trim() || path.includes("\\") || path.includes("\0")) {
    return null;
  }
  const normalized = path.trim().replace(/^\.\//u, "");
  if (normalized.startsWith("/") || /^[a-z][a-z0-9+.-]*:/iu.test(normalized)) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  let prefix;
  let relativeParts;
  if (normalized.startsWith("outputs/studio/")) {
    prefix = "/outputs/";
    relativeParts = parts.slice(2);
  } else if (normalized.startsWith("studio/public/")) {
    prefix = "/assets/";
    relativeParts = parts.slice(2);
  } else if (normalized.startsWith("public/")) {
    prefix = "/assets/";
    relativeParts = parts.slice(1);
  } else if (normalized.startsWith("episodes/")) {
    prefix = "/assets/";
    relativeParts = parts;
  } else {
    return null;
  }
  if (relativeParts.length === 0) return null;
  return `${prefix}${relativeParts.map((part) => encodeURIComponent(part)).join("/")}`;
}

function mediaKind(record = {}) {
  const declared = String(record.type ?? record.assetType ?? "").toLowerCase();
  const path = String(record.publicPath ?? record.path ?? record.audioPath ?? record.outputPath ?? "");
  if (declared === "image" || /\.(?:png|jpe?g|webp)$/iu.test(path)) return "image";
  if (declared === "video" || /\.(?:mp4|mov|m4v|webm)$/iu.test(path)) return "video";
  if (declared === "audio" || declared === "voice" || /\.(?:wav|mp3|m4a|aac|ogg)$/iu.test(path)) return "audio";
  return null;
}

function renderMediaPreview(record = {}, options = {}) {
  const path = record.publicPath ?? record.path ?? record.audioPath ?? record.outputPath ?? null;
  const url = safeApprovalMediaUrl(path);
  const kind = options.kind ?? mediaKind(record);
  const label = options.label ?? record.id ?? record.title ?? "审批媒体";
  const integrity = [
    path ? `路径：${path}` : null,
    record.bytes ? `${record.bytes} bytes` : null,
    record.sha256 ? `SHA-256：${record.sha256}` : null
  ].filter(Boolean);
  const media = url && kind === "image"
    ? `<img loading="lazy" src="${escapeHtml(url)}" alt="${escapeHtml(label)}">`
    : url && kind === "video"
      ? `<video controls preload="metadata" src="${escapeHtml(url)}" aria-label="${escapeHtml(label)}"></video>`
      : url && kind === "audio"
        ? `<audio controls preload="metadata" src="${escapeHtml(url)}" aria-label="${escapeHtml(label)}"></audio>`
        : "";
  return `<article class="approval-media-card">
    <strong>${escapeHtml(label)}</strong>
    ${media || '<p class="approval-empty">该路径不能作为安全的本地媒体地址内嵌预览，请核对下面的完整性信息。</p>'}
    ${integrity.length ? `<ul>${integrity.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join("")}</ul>` : ""}
  </article>`;
}

function renderPlanItems(items) {
  return items.length ? `<div class="approval-asset-list">${items.map((item) => {
    const method = item.productionMethod ?? {};
    return `<article>
      <div class="approval-item-topline"><span>${escapeHtml(item.id ?? "未命名条目")}</span><small>${escapeHtml(item.required === false ? "可选" : "必需")}</small></div>
      <strong>${escapeHtml(item.purpose ?? "未登记用途")}</strong>
      <dl>
        <div><dt>镜头</dt><dd>${escapeHtml(asArray(item.sceneIds).join("、") || "未绑定")}</dd></div>
        <div><dt>类型</dt><dd>${escapeHtml(item.assetType ?? "未登记")}</dd></div>
        <div><dt>方式</dt><dd>${escapeHtml(method.kind ?? "未登记")}</dd></div>
        <div><dt>执行器</dt><dd>${escapeHtml(method.executor ?? "未登记")}</dd></div>
        <div><dt>Provider / 模型</dt><dd>${escapeHtml([method.externalProvider, method.externalModel].filter(Boolean).join(" / ") || "无外部模型")}</dd></div>
        <div><dt>费用</dt><dd>${escapeHtml(estimatedCostLabel(item.estimatedCost))}</dd></div>
      </dl>
      ${method.notes ? `<p>${escapeHtml(method.notes)}</p>` : ""}
    </article>`;
  }).join("")}</div>` : '<p class="approval-empty">没有制作条目，禁止批准。</p>';
}

function renderAssetExecution(review) {
  const content = review?.content ?? {};
  const planContainer = content.plan ?? content.assetPlan ?? {};
  const plan = planContainer.content ?? planContainer.plan ?? planContainer;
  const candidate = content.candidate ?? content.currentCandidate ?? {};
  const summary = candidate.summary ?? plan.summary ?? {};
  const items = asArray(content.items ?? plan.items);
  const policy = content.executionPolicy ?? plan.executionPolicy ?? {};
  const calls = asArray(content.prompts ?? policy.externalApiCalls ?? summary.externalApiCalls);
  return `
    <section class="approval-review-section">
      <div class="approval-section-heading"><h3>全部制作条目</h3><span>${items.length} 项</span></div>
      ${renderPlanItems(items)}
    </section>
    <section class="approval-review-section">
      <div class="approval-section-heading"><h3>外部调用与费用</h3><span>${calls.length} 次调用 · ${escapeHtml(estimatedCostLabel({ maximumCostUsd: policy.maximumPaidCostUsd ?? summary.maximumPaidCostUsd }))}</span></div>
      ${calls.length ? `<div class="approval-call-list">${calls.map((call) => `<article>
        <strong>${escapeHtml(call.id ?? call.purpose ?? "外部调用")}</strong>
        <span>${escapeHtml([call.providerId ?? call.provider, call.model].filter(Boolean).join(" / ") || "Provider 未登记")}</span>
        ${call.purpose ? `<p>${escapeHtml(call.purpose)}</p>` : ""}
        <dl>
          <div><dt>预计次数</dt><dd>${escapeHtml(displayScalar(call.estimatedCalls))}</dd></div>
          <div><dt>最高 USD</dt><dd>${escapeHtml(displayScalar(call.maximumCostUsd))}</dd></div>
          ${call.billing ? `<div><dt>原币种上限</dt><dd>${escapeHtml(`${call.billing.currency ?? "?"} ${displayScalar(call.billing.maximumAmount)}`)}</dd></div>` : ""}
        </dl>
      </article>`).join("")}</div>` : '<p class="approval-empty success">当前方案登记为 0 次外部 API 调用；审批动作本身不会调用生图、生视频或产生外部费用。</p>'}
      <div class="approval-policy">${renderValue(policy)}</div>
    </section>`;
}

function renderAssets(review) {
  const content = review?.content ?? {};
  const plan = content.assetPlan?.content ?? {};
  const items = asArray(plan.items);
  const assets = asArray(content.assets);
  const voice = content.voiceIntegrity ?? {};
  return `
    <section class="approval-review-section">
      <div class="approval-section-heading"><h3>素材与旁白方案</h3><span>${items.length} 个计划条目 · ${assets.length} 个已登记文件</span></div>
      ${renderPlanItems(items)}
    </section>
    <section class="approval-review-section">
      <div class="approval-section-heading"><h3>已登记素材预览</h3><span>${assets.length} 个</span></div>
      ${assets.length ? `<div class="approval-media-grid">${assets.map((asset) => renderMediaPreview(asset, { label: asset.id ?? asset.planItemId ?? "素材" })).join("")}</div>` : '<p class="approval-empty">没有可预览的已登记素材。</p>'}
    </section>
    <section class="approval-review-section">
      <div class="approval-section-heading"><h3>旁白试听与完整性</h3><span>${escapeHtml(voice.status ?? "未登记")}</span></div>
      ${renderMediaPreview({
        id: "当前旁白",
        type: "audio",
        publicPath: voice.publicPath,
        audioPath: voice.audioPath,
        bytes: voice.bytes,
        sha256: voice.sha256
      }, { kind: "audio", label: "当前待审批旁白" })}
      ${renderValue(voice)}
    </section>`;
}

function renderFinal(review) {
  const content = review?.content ?? {};
  const video = content.video ?? {};
  return `
    <section class="approval-review-section">
      <div class="approval-section-heading"><h3>当前成片</h3><span>${escapeHtml(`${video.width ?? "?"}×${video.height ?? "?"} · ${video.durationSeconds ?? "?"}s · ${video.fps ?? "?"}fps`)}</span></div>
      <div class="approval-final-video">${renderMediaPreview(video, { kind: "video", label: "当前待审批成片" })}</div>
    </section>
    ${renderCollection("最终 QA", content.qa, { emptyText: "没有最终 QA 证据，禁止批准。" })}`;
}

function renderVisualProof(review) {
  const candidate = review?.content?.candidate ?? {};
  return `
    <section class="approval-review-section">
      <div class="approval-section-heading"><h3>当前视觉样片</h3><span>v${escapeHtml(candidate.version ?? "?")} · 来源渲染 v${escapeHtml(candidate.sourceRenderVersion ?? "?")}</span></div>
      <div class="approval-final-video">${renderMediaPreview(candidate.video ?? {}, { kind: "video", label: "当前待审批视觉样片" })}</div>
    </section>
    ${renderCollection("样片候选与证据", candidate, { emptyText: "没有可审核的视觉样片候选，禁止批准。" })}`;
}

function renderMachineReview(machineReview = {}) {
  const checks = asArray(machineReview.checks);
  const warnings = asArray(machineReview.warnings);
  const blockers = asArray(machineReview.blockingIssues);
  const passed = checks.filter((check) => check?.passed === true).length;
  return `
    ${renderCollection("机器警告", warnings, { tone: warnings.length ? "warning" : "neutral", emptyText: "机器审核没有警告。" })}
    ${renderCollection("阻断问题", blockers, { tone: blockers.length ? "danger" : "neutral", emptyText: "机器审核没有阻断问题。" })}
    <section class="approval-review-section">
      <div class="approval-section-heading"><h3>全部机器检查</h3><span>${checks.length ? `${passed}/${checks.length} 通过` : "没有检查证据"}</span></div>
      ${checks.length ? `<div class="approval-check-list">${checks.map((check) => `<article class="${check?.passed === true ? "passed" : "failed"}">
        <div><span>${check?.passed === true ? "通过" : "未通过"}</span><strong>${escapeHtml(check?.label ?? check?.code ?? check?.id ?? "未命名检查")}</strong></div>
        ${check?.message ? `<p>${escapeHtml(check.message)}</p>` : ""}
        ${check?.location ? `<small>位置：${escapeHtml(check.location)}</small>` : ""}
        ${(check?.actual !== undefined || check?.expected !== undefined) ? `<details><summary>查看实际值与预期</summary><dl>
          <div><dt>实际</dt><dd><pre>${escapeHtml(displayJson(check.actual))}</pre></dd></div>
          <div><dt>预期</dt><dd><pre>${escapeHtml(displayJson(check.expected))}</pre></dd></div>
        </dl></details>` : ""}
        ${check?.suggestedFix ? `<small>如未通过：${escapeHtml(check.suggestedFix)}</small>` : ""}
      </article>`).join("")}</div>` : '<p class="approval-empty">缺少机器检查证据，批准保持禁用。</p>'}
    </section>`;
}

function renderGenericContent(review, target) {
  if (target === "storyboard") return renderStoryboard(review);
  if (target === "asset-execution") return renderAssetExecution(review);
  if (target === "assets") return renderAssets(review);
  if (target === "final") return renderFinal(review);
  if (target === "visual-proof") return renderVisualProof(review);
  return renderCollection(`${targetLabels[target] ?? "候选"}内容`, review?.content, {
    emptyText: "没有可审核内容，批准保持禁用。"
  });
}

function renderConsequences(review) {
  const consequences = review?.consequences ?? {};
  const happens = consequences.onApprove ?? consequences.afterApproval ?? consequences.willHappen ?? consequences.next ?? [];
  const doesNotHappen = consequences.doesNotHappen ?? consequences.willNotHappen ?? [];
  const remainder = isPlainObject(consequences)
      ? Object.fromEntries(Object.entries(consequences).filter(([key]) => !new Set([
        "onApprove", "afterApproval", "willHappen", "next", "doesNotHappen", "willNotHappen"
      ]).has(key)))
    : null;
  return `
    ${renderCollection("批准后会发生", happens, { emptyText: "服务端没有登记后续动作。" })}
    ${renderCollection("批准时不会发生", doesNotHappen, { emptyText: "服务端没有登记排除事项。" })}
    ${remainder && Object.keys(remainder).length ? renderCollection("其他影响", remainder) : ""}`;
}

export function renderApprovalReview(review, requestedTarget) {
  const target = targetFromReview(review, requestedTarget);
  const label = targetLabels[target] ?? target ?? "人工审批";
  const canApprove = approvalReviewCanApprove(review, target);
  const canReject = approvalReviewCanReject(review, target);
  const status = typeof review?.status === "string"
    ? review.status
    : review?.status?.label
      ?? `${review?.status?.approvalStatus ?? "待确认"} · 机器审核 ${review?.status?.machineStatus ?? "未登记"}`;
  const episodeTitle = review?.episode?.title ?? review?.episode?.concept ?? "未命名 Episode";
  const episodeId = review?.episode?.id ?? "未登记";
  return `<article class="approval-review" data-approval-target="${escapeHtml(target)}">
    <header class="approval-review-header">
      <div>
        <p class="section-label">人工审批详情</p>
        <h2 id="approvalDialogTitle">${escapeHtml(label)}</h2>
        <p class="approval-review-episode">${escapeHtml(episodeTitle)} · Episode ID：<code>${escapeHtml(episodeId)}</code></p>
        <p id="approvalDialogDescription">请先阅读完整候选、机器审核和影响范围，再作决定。</p>
      </div>
      <span class="approval-review-status">${escapeHtml(status)}</span>
      <button class="approval-dialog-close" data-action="close-approval-review" aria-label="关闭审批详情">×</button>
    </header>
    <div class="approval-review-body">
      ${renderBinding(review, target)}
      ${renderGenericContent(review, target)}
      ${renderCollection("证据", review?.evidence, { emptyText: "没有额外证据。" })}
      ${renderCollection("相对上一版的变化", review?.changes, { emptyText: "没有登记变化。" })}
      ${renderCollection("风险与注意事项", review?.risks, { tone: asArray(review?.risks).length ? "warning" : "neutral", emptyText: "没有登记额外风险。" })}
      ${renderMachineReview(review?.machineReview)}
      ${renderConsequences(review)}
      ${renderCollection("后续步骤", review?.nextActions, { emptyText: "没有登记后续步骤。" })}
    </div>
    <footer class="approval-review-footer">
      <label for="approvalDecisionNote">审批意见 <span>批准可选，退回必填</span></label>
      <textarea id="approvalDecisionNote" rows="3" maxlength="1000" placeholder="记录你批准的理由，或填写需要上层 Agent 修改的具体问题"></textarea>
      <div class="approval-review-actions">
        <button class="secondary" data-action="close-approval-review">关闭</button>
        ${canReject ? '<button class="approval-reject-button" data-action="reject-open-approval">退回上层 Agent 修改</button>' : ""}
        <button class="primary" data-action="approve-open-approval" ${canApprove ? "" : "disabled"}>${canApprove ? "批准此精确版本" : "当前不可批准"}</button>
      </div>
      ${approvalBindingComplete(review, target) ? "" : '<p class="approval-binding-error">精确绑定字段不完整。请关闭并重新运行机器审核，不能绕过。</p>'}
    </footer>
  </article>`;
}

function requireBinding(review, target) {
  if (!approvalBindingComplete(review, target)) {
    const error = new Error("审批详情缺少完整精确绑定，禁止提交");
    error.code = "approval_binding_incomplete";
    throw error;
  }
  return review.binding;
}

export function buildApprovalDecisionRequest({ episodeId, target, review, decision, note = "" }) {
  const normalizedTarget = targetFromReview(review, target);
  const binding = requireBinding(review, normalizedTarget);
  const text = String(note ?? "").trim();
  if (decision === "rejected" && !text) {
    const error = new Error("退回修改时必须填写具体意见");
    error.code = "approval_feedback_required";
    throw error;
  }
  if (!new Set(["approved", "rejected"]).has(decision)) {
    throw new Error("未知审批决定");
  }
  if (normalizedTarget === "visual-proof") {
    if (decision !== "approved") {
      const error = new Error("视觉样片检查点没有直接退回入口");
      error.code = "approval_rejection_unavailable";
      throw error;
    }
    return {
      path: `/api/episodes/${encodeURIComponent(episodeId)}/visual-proof-review/approve`,
      body: {
        candidateHash: binding.candidateHash,
        machineReviewId: binding.machineReviewId,
        note: text || "通过本地审批详情提交批准"
      }
    };
  }
  if (normalizedTarget === "asset-execution") {
    return {
      path: `/api/episodes/${encodeURIComponent(episodeId)}/asset-execution-review/${decision === "approved" ? "approve" : "reject"}`,
      body: {
        candidateHash: binding.candidateHash,
        machineReviewId: binding.machineReviewId,
        ...(decision === "approved"
          ? { note: text || "通过本地审批详情提交批准" }
          : { feedback: text })
      }
    };
  }
  if (!FORMAL_GATE_TARGETS.has(normalizedTarget)) throw new Error("未知人工审批目标");
  return {
    path: `/api/episodes/${encodeURIComponent(episodeId)}/approvals/${encodeURIComponent(normalizedTarget)}${decision === "approved" ? "" : "/reject"}`,
    body: {
      artifactVersion: binding.artifactVersion,
      artifactHash: binding.artifactHash,
      reviewReportId: binding.reviewReportId,
      ...(decision === "approved"
        ? { note: text || "通过本地审批详情提交批准" }
        : { feedback: text })
    }
  };
}

export function isApprovalBindingConflict(error) {
  // Every 409 during an approval decision means the evidence or workflow state
  // may have changed.  Fail closed even when the server reports the generic
  // state-version CAS code instead of a gate-specific binding code.
  return Number(error?.status) === 409;
}

export function approvalDialogShell() {
  return `<dialog class="approval-dialog" id="approvalDialog" aria-labelledby="approvalDialogTitle" aria-describedby="approvalDialogDescription">
    <div class="approval-dialog-loading" role="status">
      <strong id="approvalDialogTitle">正在读取当前审批详情</strong>
      <span id="approvalDialogDescription">读取完成前不能提交任何决定。</span>
    </div>
  </dialog>`;
}
