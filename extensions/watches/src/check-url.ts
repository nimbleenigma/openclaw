import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
import { evaluateTextCondition, truncateSummary } from "./evaluate.js";
import type { CheckOutcome, UrlWatchSource, WatchRecord } from "./types.js";

const TEXTUAL_CONTENT_TYPES = [
  "text/",
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/xhtml+xml",
  "application/rss+xml",
  "application/atom+xml",
  "application/javascript",
];

type FetchUrlTextParams = {
  url: string;
  timeoutMs: number;
  maxBytes: number;
  fetchImpl?: typeof fetch;
};

function assertHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL watches only support http and https URLs");
  }
}

function isTextualContentType(contentType: string | null): boolean {
  if (!contentType) {
    return true;
  }
  const lower = contentType.toLowerCase();
  return TEXTUAL_CONTENT_TYPES.some((prefix) => lower.startsWith(prefix));
}

async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      throw new Error(`URL response exceeds ${maxBytes} bytes`);
    }
  }
  if (!isTextualContentType(response.headers.get("content-type"))) {
    throw new Error("URL response is not text-like content");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error(`URL response exceeds ${maxBytes} bytes`);
    }
    return new TextDecoder().decode(buffer);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`URL response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(out);
}

export async function fetchUrlText(
  params: FetchUrlTextParams,
): Promise<{ finalUrl: string; status: number; text: string }> {
  assertHttpUrl(params.url);
  const { response, finalUrl, release } = await fetchWithSsrFGuard({
    url: params.url,
    init: {
      method: "GET",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml,text/plain,application/json;q=0.9,*/*;q=0.1",
        "user-agent": "OpenClaw Watches/1",
      },
    },
    timeoutMs: params.timeoutMs,
    maxRedirects: 3,
    fetchImpl: params.fetchImpl,
    auditContext: "watches-url",
  });
  try {
    return {
      finalUrl,
      status: response.status,
      text: await readResponseTextWithLimit(response, params.maxBytes),
    };
  } finally {
    await release();
  }
}

export async function checkUrlWatch(params: {
  watch: WatchRecord;
  timeoutMs: number;
  maxBytes: number;
  fetchImpl?: typeof fetch;
}): Promise<CheckOutcome> {
  if (params.watch.kind !== "url") {
    throw new Error(`Expected URL watch, got ${params.watch.kind}`);
  }
  const source = params.watch.source as UrlWatchSource;
  const condition = params.watch.condition;
  const fetched = await fetchUrlText({
    url: source.url,
    timeoutMs: params.timeoutMs,
    maxBytes: params.maxBytes,
    fetchImpl: params.fetchImpl,
  });
  const canonical = `${fetched.status}\n${fetched.finalUrl}\n${fetched.text}`;
  const evaluated = evaluateTextCondition({
    condition,
    text: canonical,
    previousHash: params.watch.lastResultHash,
  });
  const summary = truncateSummary(
    `${evaluated.summary} HTTP ${fetched.status} ${fetched.finalUrl}`,
  );
  if (!evaluated.triggered) {
    return {
      triggered: false,
      resultHash: evaluated.resultHash,
      summary,
      payload: { status: fetched.status, finalUrl: fetched.finalUrl },
    };
  }
  return {
    triggered: true,
    resultHash: evaluated.resultHash,
    summary,
    notification:
      `Watch triggered: ${params.watch.title}\n\n` +
      `${summary}\n\n` +
      truncateSummary(fetched.text, 700),
    payload: { status: fetched.status, finalUrl: fetched.finalUrl },
  };
}
