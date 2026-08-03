function decodeHtml(value = "") {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

function extractMeta(html, key) {
  const escaped = key.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "iu"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "iu")
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return decodeHtml(match[1]);
  }
  return "";
}

function extractJsonObjectAfter(html, marker) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  let start = markerIndex + marker.length;
  while (/\s/u.test(html[start] ?? "")) start += 1;
  if (html[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function metricValue(value) {
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function parseBilibiliPage(html, source, observedAt) {
  const state = extractJsonObjectAfter(html, "window.__INITIAL_STATE__=");
  const video = state?.videoData ?? state?.videoInfo ?? null;
  if (!video?.title || !video?.pubdate) {
    return {
      status: "assisted_required",
      reason: "bilibili-metadata-missing",
      observations: []
    };
  }
  const stat = video.stat ?? {};
  const metrics = Object.fromEntries(
    Object.entries({
      views: metricValue(stat.view),
      likes: metricValue(stat.like),
      comments: metricValue(stat.reply),
      favorites: metricValue(stat.favorite),
      shares: metricValue(stat.share),
      coins: metricValue(stat.coin),
      danmaku: metricValue(stat.danmaku)
    }).filter(([, value]) => value !== undefined)
  );
  const bvid = video.bvid || state?.bvid;
  return {
    status: "success",
    reason: null,
    observations: [
      {
        creatorId: source.id,
        title: decodeHtml(video.title),
        sourceUrl: bvid ? `https://www.bilibili.com/video/${bvid}/` : source.profileUrl,
        publishedAt: new Date(video.pubdate * 1000).toISOString(),
        observedAt,
        datePrecision: "page-date",
        externalId: bvid,
        metrics,
        sourceKind: "collector-bilibili-public-page",
        pageCreatorName: video.owner?.name ?? null
      }
    ]
  };
}

function parseGenericMetadata(html, source, observedAt) {
  const title =
    extractMeta(html, "og:title") ||
    decodeHtml(/<title[^>]*>(.*?)<\/title>/isu.exec(html)?.[1] ?? "");
  const publishedAt =
    extractMeta(html, "article:published_time") || extractMeta(html, "datePublished");
  if (!title || !publishedAt || Number.isNaN(Date.parse(publishedAt))) {
    return { status: "assisted_required", reason: "public-metadata-insufficient", observations: [] };
  }
  return {
    status: "success",
    reason: null,
    observations: [
      {
        creatorId: source.id,
        title,
        sourceUrl: source.profileUrl,
        publishedAt: new Date(publishedAt).toISOString(),
        observedAt,
        datePrecision: "page-date",
        sourceKind: "collector-generic-public-page"
      }
    ]
  };
}

export async function collectPublicSource(source, { config, now, fetchImpl = fetch }) {
  const observedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  if (source.platform === "douyin" && config.directAdapters.douyin === false) {
    return {
      creatorId: source.id,
      status: "assisted_required",
      reason: "client-rendered-list-needs-codex",
      observations: []
    };
  }
  let response;
  let requestError = null;
  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    try {
      response = await fetchImpl(source.profileUrl, {
        redirect: "follow",
        headers: {
          "user-agent": config.userAgent,
          accept: "text/html,application/xhtml+xml",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6"
        },
        signal: AbortSignal.timeout(config.timeoutMs)
      });
      const retryableStatus = response.status === 429 || response.status >= 500;
      if (!retryableStatus || attempt === config.retryCount) break;
    } catch (error) {
      requestError = error;
      if (attempt === config.retryCount) break;
    }
    if (config.retryBackoffMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.retryBackoffMs * (attempt + 1)));
    }
  }
  if (!response) {
    return {
      creatorId: source.id,
      status: "failed",
      reason: requestError?.name === "TimeoutError" ? "request-timeout" : "request-failed",
      observations: []
    };
  }
  if (!response.ok) {
    return {
      creatorId: source.id,
      status: "failed",
      reason: `http-${response.status}`,
      httpStatus: response.status,
      observations: []
    };
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > config.maxResponseBytes) {
    return {
      creatorId: source.id,
      status: "failed",
      reason: "response-too-large",
      httpStatus: response.status,
      observations: []
    };
  }
  const html = await response.text();
  let parsed;
  if (source.platform === "bilibili" && config.directAdapters.bilibili) {
    parsed = parseBilibiliPage(html, source, observedAt);
  } else if (source.platform === "douyin") {
    parsed = {
      status: "assisted_required",
      reason: "client-rendered-list-needs-codex",
      observations: []
    };
  } else if (config.directAdapters.genericMetadata) {
    parsed = parseGenericMetadata(html, source, observedAt);
  } else {
    parsed = { status: "assisted_required", reason: "no-direct-adapter", observations: [] };
  }
  return {
    creatorId: source.id,
    httpStatus: response.status,
    fetchedBytes: html.length,
    ...parsed
  };
}
