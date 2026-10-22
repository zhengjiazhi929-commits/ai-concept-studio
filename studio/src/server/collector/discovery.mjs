import {normalizeSearchText} from "../trends/schema.mjs";

const DAY_MS = 86_400_000;
const METHODS = new Set(["verified", "no_recent_items", "blocked", "unverified"]);
const HOSTS = {
  douyin: new Set(["www.douyin.com", "douyin.com", "jingxuan.douyin.com"]),
  bilibili: new Set(["www.bilibili.com", "bilibili.com", "m.bilibili.com", "space.bilibili.com"])
};

function boundedText(value, maximum = 1200) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function platformUrl(value, platform, kind = "public") {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !HOSTS[platform]?.has(url.hostname)) return null;
    if (kind === "work" && !(platform === "douyin"
      ? /^\/(?:m\/)?video\/\d+\/?$/u
      : /^\/video\/BV[a-zA-Z0-9]+\/?$/u).test(url.pathname)) return null;
    if (kind === "author" && !(platform === "douyin"
      ? /^\/user\/[^/]+\/?$/u.test(url.pathname)
      : url.hostname === "space.bilibili.com" && /^\/\d+\/?$/u.test(url.pathname))) return null;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch { return null; }
}

export function matchesConfiguredCreator(name, source) {
  if (!boundedText(name, 160) || !source) return false;
  const expected = [source.name, ...(source.verifiedNameAliases ?? [])].filter(Boolean);
  return expected.some(value => normalizeSearchText(value) === normalizeSearchText(name));
}

// Current discovery sources display China calendar dates. Do not confuse a
// serialized midnight with an exact time, or a crawl timestamp with publication.
function publicationTextMatches(observation, observed) {
  const published = Date.parse(observation.publishedAt);
  if (!Number.isFinite(published)) return false;
  const chinaDay = timestamp => new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 10);
  const text = observation.evidence?.publishedText ?? "";
  if (typeof text !== "string") return false;
  if (observation.datePrecision === "page-date") {
    const matches = [...text.matchAll(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})(?:日)?/gu)];
    if (matches.length !== 1) return false;
    const [, year, month, day] = matches[0];
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` === chinaDay(published);
  }
  if (observation.datePrecision === "relative-day-estimate") {
    const anchor = Date.parse(observation.evidence?.dateReferenceAt);
    if (!Number.isFinite(anchor) || anchor > observed + 300_000 || anchor < observed - 2 * DAY_MS) return false;
    const match = text.match(/^(\d{1,2})天前/u);
    const days = match ? Number(match[1]) : text.startsWith("昨天") ? 1 : text.startsWith("前天") ? 2 : text.startsWith("今天") ? 0 : null;
    return days !== null && chinaDay(anchor - days * DAY_MS) === chinaDay(published);
  }
  return false;
}

export function buildRecentDiscoveryTask({sources, now = new Date(), lookbackDays = 30, sourceResults = []}) {
  const time = new Date(now);
  if (!Number.isFinite(+time) || !Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 45) throw new Error("Invalid discovery window");
  const createdAt = time.toISOString();
  const taskId = `discovery-${createdAt.replaceAll(/[:.]/gu, "-")}`;
  const resultByCreator = new Map(sourceResults.map(result => [result.creatorId, result]));
  const window = {from: new Date(+time - lookbackDays * DAY_MS).toISOString(), to: createdAt, days: lookbackDays};
  return {
    schemaVersion: 2, taskId, createdAt, mode: "recent-public-works-discovery", window,
    requiresCodexContinuation: true, authorizesCandidateSelection: false,
    purpose: "发现作者近期原作品并核对身份、日期和概念，不把固定历史视频重读当作新作品发现",
    rules: [
      "只读取公开页面；不登录、不保存Cookie、不调用私有或付费API、不绕访问限制。",
      "搜索摘要与聚合页只作线索；观察必须有原作品URL、页面作者及原页面发布日期证据。账号链接缺失须明确标记original-work-byline，不冒充账号验证。",
      "按task window核对时间；抓取日期不是发布日期，无日期或无作者证据时标为unverified。",
      "没有查到或被限制如实记录sourceChecks；零结果不等于市场没有讨论。",
      "概念未映射留待复核；缺少互动数据保持缺失；不能代替人工选择和Research。"
    ],
    tasks: sources.creators.filter(source => source.enabled !== false).map(source => ({
      creatorId: source.id, name: source.name, platform: source.platform,
      profileUrl: source.profileUrl,
      entryUrlIsProfile: Boolean(platformUrl(source.profileUrl, source.platform, "author")),
      fixedPageStatus: resultByCreator.get(source.id)?.status ?? "not_checked",
      fixedPageReason: resultByCreator.get(source.id)?.reason ?? null,
      suggestedSearchQuery: `site:${source.platform === "bilibili" ? "bilibili.com" : "douyin.com"} "${source.name}" AI`,
      dateWindow: window, maximumItems: 10, priority: "high"
    })),
    outputTemplate: {schemaVersion: 2, batchId: `assisted-${taskId}`, discoveryTaskId: taskId,
      observedAt: createdAt, method: "Codex公开原作品核验", sourceChecks: [], observations: []}
  };
}

// These checks bind the recorded human/Codex evidence; they do not claim to
// independently verify a remote page or authorize a production gate.
export function validateRecentDiscoveryBatch(batch, {sources, task, now = new Date()}) {
  const errors = [];
  const time = +new Date(now);
  if (!batch || batch.schemaVersion !== 2) return {valid: false, errors: ["discovery batch schemaVersion must be 2"]};
  const observed = Date.parse(batch.observedAt);
  if (!Number.isFinite(observed) || observed > time + 300_000 || observed < time - 2 * DAY_MS) errors.push("discovery observation time must be current (within 48 hours)");
  if (!task || task.schemaVersion !== 2 || batch.discoveryTaskId !== task.taskId) errors.push("discovery batch must bind the current task");
  const from = Date.parse(task?.window?.from);
  const to = Date.parse(task?.window?.to);
  if (!Number.isFinite(time) || !Number.isFinite(from) || !Number.isFinite(to) || from >= to || to > time + 300_000 || to - from > 45 * DAY_MS) errors.push("invalid discovery task window");
  if (!boundedText(batch.batchId, 160) || !/^[a-z0-9-]+$/u.test(batch.batchId)) errors.push("invalid discovery batchId");
  if (!boundedText(batch.method, 300)) errors.push("discovery method is required");
  if (!Array.isArray(batch.observations) || batch.observations.length > 180) errors.push("discovery observations must be a bounded array");
  if (!Array.isArray(batch.sourceChecks) || !batch.sourceChecks.length || batch.sourceChecks.length > 100) errors.push("sourceChecks are required for every attempted scan, including zero results");
  if (errors.length) return {valid: false, errors};
  const sourceMap = new Map(sources.creators.filter(s => s.enabled !== false).map(s => [s.id, s]));
  const checks = new Map();
  for (const check of batch.sourceChecks) {
    const source = sourceMap.get(check?.creatorId);
    if (!source || !METHODS.has(check?.status) || checks.has(check.creatorId)) { errors.push("invalid or duplicate source check"); continue; }
    const checked = Date.parse(check.checkedAt);
    if (!Number.isFinite(checked) || checked > observed + 300_000 || checked < observed - 2 * DAY_MS) errors.push("invalid source check time");
    if (!platformUrl(check.url, source.platform)) errors.push("source check must reference a public platform page");
    checks.set(check.creatorId, check);
  }
  const works = new Set();
  const authors = new Map();
  for (const observation of batch.observations) {
    const source = sourceMap.get(observation?.creatorId);
    if (!source) { errors.push("unknown or disabled observation creator"); continue; }
    const evidence = observation.evidence;
    const work = platformUrl(observation.sourceUrl, source.platform, "work");
    const author = platformUrl(evidence?.authorUrl, source.platform, "author");
    if (!work || works.has(work)) errors.push("a unique original work URL is required (search pages are not works)");
    works.add(work);
    const bylineOnly = evidence?.authorUrl === null && evidence?.identityBasis === "original-work-byline";
    if ((!author && !bylineOnly) || !matchesConfiguredCreator(evidence?.authorName, source)) errors.push("configured creator identity must match page evidence");
    const configuredProfile = platformUrl(source.profileUrl, source.platform, "author");
    if (configuredProfile && configuredProfile !== author) errors.push("author account differs from configured profile");
    const authorKey = author ?? `${source.platform}:byline:${normalizeSearchText(evidence?.authorName ?? "")}`;
    if (authors.has(authorKey) && authors.get(authorKey) !== source.id) errors.push("same account or byline cannot count as independent creators");
    authors.set(authorKey, source.id);
    if (platformUrl(evidence?.url, source.platform, "work") !== work) errors.push("evidence URL must match the original work");
    if (!boundedText(observation.title, 500) || !boundedText(evidence?.publishedText, 160) || !boundedText(evidence?.excerpt)) errors.push("title and original publication evidence are required");
    if (bylineOnly && !(typeof evidence.excerpt === "string" && evidence.excerpt.includes(evidence.authorName) && evidence.excerpt.includes(evidence.publishedText))) errors.push("byline-only evidence must preserve the page byline and original publication text");
    if (observation.conceptIds !== undefined && (!Array.isArray(observation.conceptIds) || observation.conceptIds.length > 20 || observation.conceptIds.some(id => !boundedText(id, 100)))) errors.push("conceptIds must be a bounded list");
    if (observation.metrics !== undefined && (!observation.metrics || typeof observation.metrics !== "object" || Array.isArray(observation.metrics))) errors.push("metrics must be an object or omitted");
    if (!new Set(["page-date", "relative-day-estimate"]).has(observation.datePrecision)) errors.push("publication date cannot be inferred from crawl or observation time");
    if (!publicationTextMatches(observation, observed)) errors.push("publication date must agree with original page date text and any relative-date anchor");
    const published = Date.parse(observation.publishedAt);
    if (!Number.isFinite(published) || published < from || published > Math.min(time, to)) errors.push("work is outside the discovery window or in the future");
    if (checks.get(source.id)?.status !== "verified") errors.push("observations require a verified source check");
  }
  for (const check of checks.values()) {
    if (check.status === "verified" && !batch.observations.some(o => o?.creatorId === check.creatorId)) errors.push("verified source check must include an original work");
  }
  return {valid: errors.length === 0, errors};
}
