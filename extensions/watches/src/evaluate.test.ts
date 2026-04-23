import { describe, expect, it, vi } from "vitest";
import { checkModelAvailability, findAvailableModel } from "./check-model.js";
import { checkUrlWatch, fetchUrlText } from "./check-url.js";
import { evaluateTextCondition, hashWatchResult } from "./evaluate.js";
import type { WatchRecord } from "./types.js";

function createUrlWatch(overrides: Partial<WatchRecord> = {}): WatchRecord {
  return {
    id: "w_test",
    ownerKey: "test",
    title: "URL contains: hello",
    kind: "url",
    source: { url: "https://example.com/" },
    condition: { type: "contains", text: "hello", caseSensitive: false },
    status: "active",
    intervalSeconds: 60,
    nextCheckAt: 1,
    expiresAt: 10_000,
    errorCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createModelWatch(overrides: Partial<WatchRecord> = {}): WatchRecord {
  return {
    id: "w_model",
    ownerKey: "test",
    title: "Model available: gpt-5.5",
    kind: "model",
    source: { query: "gpt-5.5", model: "gpt-5.5" },
    condition: { type: "available" },
    status: "active",
    intervalSeconds: 60,
    nextCheckAt: 1,
    expiresAt: 10_000,
    errorCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("watch condition evaluation", () => {
  it("captures a baseline before changed URL watches trigger", () => {
    const initial = evaluateTextCondition({
      condition: { type: "changed" },
      text: "alpha",
    });
    expect(initial.triggered).toBe(false);
    const changed = evaluateTextCondition({
      condition: { type: "changed" },
      text: "beta",
      previousHash: initial.resultHash,
    });
    expect(changed.triggered).toBe(true);
  });

  it("matches URL contains conditions deterministically", () => {
    const result = evaluateTextCondition({
      condition: { type: "contains", text: "GPT-5.5" },
      text: "gpt-5.5 is here",
    });
    expect(result.triggered).toBe(true);
  });
});

describe("model availability checks", () => {
  const catalog = [
    { provider: "openai", id: "gpt-5.4", name: "GPT-5.4" },
    { provider: "openai", id: "gpt-5.5", name: "GPT-5.5" },
  ];

  it("finds available models by normalized model id", () => {
    expect(findAvailableModel(catalog, { query: "GPT-5.5", model: "GPT-5.5" })?.id).toBe("gpt-5.5");
  });

  it("returns a triggered outcome when the catalog contains the watched model", async () => {
    const loadCatalog = vi.fn(async () => catalog);
    const outcome = await checkModelAvailability({
      watch: createModelWatch(),
      cfg: {},
      loadCatalog,
    });
    expect(outcome.triggered).toBe(true);
    expect(outcome.summary).toContain("openai/gpt-5.5");
  });
});

describe("URL checks", () => {
  it("triggers contains watches from bounded text fetches", async () => {
    const fetchImpl = vi.fn(async () => new Response("hello from the page"));
    const outcome = await checkUrlWatch({
      watch: createUrlWatch(),
      timeoutMs: 1000,
      maxBytes: 1024,
      fetchImpl,
    });
    expect(outcome.triggered).toBe(true);
    expect(outcome.resultHash).toBe(
      hashWatchResult("200\nhttps://example.com/\nhello from the page"),
    );
  });

  it("rejects oversized URL responses", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("too large", {
          headers: { "content-length": "999" },
        }),
    );
    await expect(
      fetchUrlText({
        url: "https://example.com/",
        timeoutMs: 1000,
        maxBytes: 10,
        fetchImpl,
      }),
    ).rejects.toThrow("exceeds");
  });

  it("blocks private-network URL targets before fetch", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope"));
    await expect(
      fetchUrlText({
        url: "http://127.0.0.1/",
        timeoutMs: 1000,
        maxBytes: 1024,
        fetchImpl,
      }),
    ).rejects.toThrow(/Blocked|private|internal/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
