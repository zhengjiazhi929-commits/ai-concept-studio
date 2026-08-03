import { createHash } from "node:crypto";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeTitle(value = "") {
  return value
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll(/\s+/gu, " ")
    .trim();
}

async function readLimitedBody(response, maximumBytes) {
  if (!response.body) return { bytes: Buffer.alloc(0), tooLarge: false };
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel("source-too-large").catch(() => {});
        return { bytes: null, tooLarge: true };
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks), tooLarge: false };
}

function accessResult(source, values) {
  return {
    sourceId: source.id,
    access: {
      checkedAt: values.checkedAt,
      status: values.status,
      httpStatus: values.httpStatus ?? null,
      contentType: values.contentType ?? null,
      bytes: values.bytes ?? null,
      sha256: values.sha256 ?? null,
      title: values.title ?? null,
      reason: values.reason ?? null
    }
  };
}

export async function inspectPrimarySource(source, options) {
  const checkedAt = (options.now instanceof Date ? options.now : new Date()).toISOString();
  let parsed;
  try {
    parsed = new URL(source.url);
  } catch {
    return accessResult(source, { checkedAt, status: "invalid", reason: "invalid-url" });
  }
  if (parsed.protocol !== "https:") {
    return accessResult(source, { checkedAt, status: "invalid", reason: "https-required" });
  }

  let lastError = null;
  for (let attempt = 0; attempt <= options.config.retryCount; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.config.timeoutMs);
    try {
      const response = await options.fetchImpl(source.url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml,application/json,text/plain,application/pdf;q=0.9,*/*;q=0.1",
          "user-agent": "AI-Concept-Studio-Research/0.1"
        }
      });
      const finalUrl = new URL(response.url || source.url);
      const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? null;
      if (finalUrl.protocol !== "https:") {
        return accessResult(source, {
          checkedAt,
          status: "needs_assist",
          httpStatus: response.status,
          contentType,
          reason: "redirected-outside-https"
        });
      }
      if (!response.ok) {
        if ((response.status >= 500 || response.status === 429) && attempt < options.config.retryCount) {
          await wait(options.config.retryBackoffMs * (attempt + 1));
          continue;
        }
        return accessResult(source, {
          checkedAt,
          status: "needs_assist",
          httpStatus: response.status,
          contentType,
          reason: `http-${response.status}`
        });
      }
      const allowedContent = new Set([
        "text/html",
        "application/xhtml+xml",
        "application/json",
        "text/plain",
        "application/pdf"
      ]);
      if (contentType && !allowedContent.has(contentType)) {
        return accessResult(source, {
          checkedAt,
          status: "needs_assist",
          httpStatus: response.status,
          contentType,
          reason: "unsupported-content-type"
        });
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (declaredLength > options.config.maxSourceBytes) {
        return accessResult(source, {
          checkedAt,
          status: "needs_assist",
          httpStatus: response.status,
          contentType,
          bytes: declaredLength,
          reason: "source-too-large"
        });
      }
      const body = await readLimitedBody(response, options.config.maxSourceBytes);
      if (body.tooLarge) {
        return accessResult(source, {
          checkedAt,
          status: "needs_assist",
          httpStatus: response.status,
          contentType,
          reason: "source-too-large"
        });
      }
      const text = contentType === "application/pdf" ? "" : body.bytes.toString("utf8");
      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(text);
      return accessResult(source, {
        checkedAt,
        status: "accessible",
        httpStatus: response.status,
        contentType,
        bytes: body.bytes.length,
        sha256: createHash("sha256").update(body.bytes).digest("hex"),
        title: titleMatch ? decodeTitle(titleMatch[1]).slice(0, 240) : null
      });
    } catch (error) {
      lastError = error;
      if (attempt < options.config.retryCount) {
        await wait(options.config.retryBackoffMs * (attempt + 1));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return accessResult(source, {
    checkedAt,
    status: "needs_assist",
    reason: lastError?.name === "AbortError" ? "timeout" : "network-error"
  });
}
