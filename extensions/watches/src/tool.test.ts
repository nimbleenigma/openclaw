import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginToolContext } from "../api.js";
import { DEFAULT_WATCHES_CONFIG } from "./config.js";
import { createWatchManagementService } from "./management.js";
import { createWatchManagementContextForTool, createWatchesManagementTool } from "./tool.js";
import type { CreateWatchInput, WatchRecord } from "./types.js";

function createMemoryStore() {
  const watches = new Map<string, WatchRecord>();
  return {
    watches,
    createWatch(input: CreateWatchInput): WatchRecord {
      const watch: WatchRecord = {
        id: input.id,
        ownerKey: input.ownerKey,
        ownerSessionKey: input.deliveryTarget.sessionKey,
        ownerSessionId: input.deliveryTarget.sessionId,
        ownerChannel: input.deliveryTarget.channel,
        ownerTo: input.deliveryTarget.to,
        ownerAccountId: input.deliveryTarget.accountId,
        ownerThreadId: input.deliveryTarget.threadId,
        ownerSenderId: input.deliveryTarget.senderId,
        title: input.title,
        kind: input.kind,
        source: input.source,
        condition: input.condition,
        status: "active",
        intervalSeconds: input.intervalSeconds,
        nextCheckAt: input.nextCheckAt,
        expiresAt: input.expiresAt,
        errorCount: 0,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      watches.set(watch.id, watch);
      return watch;
    },
    countActiveForOwner(ownerKey: string): number {
      return [...watches.values()].filter(
        (watch) => watch.ownerKey === ownerKey && watch.status === "active",
      ).length;
    },
    listWatches(params?: { ownerKey?: string; includeAll?: boolean; limit?: number }) {
      return [...watches.values()]
        .filter((watch) => !params?.ownerKey || watch.ownerKey === params.ownerKey)
        .filter((watch) => params?.includeAll || watch.status === "active")
        .slice(0, params?.limit ?? 50);
    },
    getWatch(id: string): WatchRecord | undefined {
      return watches.get(id);
    },
    cancelWatch(params: {
      id: string;
      ownerKey?: string;
      now: number;
      allowAnyOwner?: boolean;
    }): WatchRecord | undefined {
      const watch = watches.get(params.id);
      if (!watch) {
        return undefined;
      }
      if (!params.allowAnyOwner && params.ownerKey && watch.ownerKey !== params.ownerKey) {
        return undefined;
      }
      if (watch.status === "active") {
        watch.status = "cancelled";
        watch.cancelledAt = params.now;
        watch.updatedAt = params.now;
      }
      return watch;
    },
  };
}

function createToolContext(sender = "alice"): OpenClawPluginToolContext {
  return {
    sessionKey: "agent:main",
    sessionId: "session-1",
    requesterSenderId: sender,
    deliveryContext: {
      channel: "telegram",
      to: "chat-1",
      accountId: "acct",
      threadId: "topic-1",
    },
  };
}

function createToolHarness(ctx = createToolContext()) {
  const store = createMemoryStore();
  const wakeScheduler = vi.fn();
  let nextId = 0;
  const manager = createWatchManagementService({
    getStore: () => store,
    config: DEFAULT_WATCHES_CONFIG,
    now: () => 1_000,
    idGenerator: () => `w_${++nextId}`,
    wakeScheduler,
  });
  const tool = createWatchesManagementTool({ manager, ctx });
  return { store, wakeScheduler, manager, tool };
}

function details(result: { details?: unknown }): unknown {
  return result.details;
}

describe("watches_manage tool", () => {
  it("derives watch ownership and notification target from trusted tool context", () => {
    expect(createWatchManagementContextForTool(createToolContext())).toEqual({
      ownerKey: "telegram:alice",
      deliveryTarget: {
        sessionKey: "agent:main",
        sessionId: "session-1",
        channel: "telegram",
        to: "chat-1",
        accountId: "acct",
        threadId: "topic-1",
        senderId: "alice",
      },
    });
  });

  it("creates all supported watch kinds through the assistant tool", async () => {
    const { store, tool, wakeScheduler } = createToolHarness();

    const model = await tool.execute("tool-1", {
      action: "create_model_availability",
      model: "openai/gpt-5.5",
    });
    const contains = await tool.execute("tool-2", {
      action: "create_url_contains",
      url: "https://example.com",
      text: "Example Domain",
    });
    const matches = await tool.execute("tool-3", {
      action: "create_url_matches",
      url: "https://example.com/news",
      regex: "GPT-5\\.5",
    });
    const changed = await tool.execute("tool-4", {
      action: "create_url_changed",
      url: "https://example.com/news",
    });

    expect(details(model)).toMatchObject({
      ok: true,
      watch: { id: "w_1" },
    });
    expect(details(contains)).toMatchObject({
      ok: true,
      watch: { condition: { type: "contains", text: "Example Domain" } },
    });
    expect(details(matches)).toMatchObject({
      ok: true,
      watch: { condition: { type: "matches", pattern: "GPT-5\\.5", flags: "i" } },
    });
    expect(details(changed)).toMatchObject({
      ok: true,
      watch: { condition: { type: "changed" } },
    });
    expect(store.watches.get("w_1")).toMatchObject({
      ownerKey: "telegram:alice",
      ownerSessionKey: "agent:main",
      ownerChannel: "telegram",
      ownerTo: "chat-1",
      ownerThreadId: "topic-1",
      ownerSenderId: "alice",
    });
    expect(wakeScheduler).toHaveBeenCalledTimes(4);
  });

  it("lists, shows, and cancels watches without crossing owner scope", async () => {
    const { manager, store, tool } = createToolHarness();
    const bobTool = createWatchesManagementTool({ manager, ctx: createToolContext("bob") });
    await tool.execute("tool-1", {
      action: "create_url_contains",
      url: "https://example.com",
      text: "hello",
    });

    const bobList = await bobTool.execute("tool-2", { action: "list", include_all: true });
    expect((details(bobList) as { watches: unknown[] }).watches).toEqual([]);
    const bobShow = await bobTool.execute("tool-3", { action: "show", watch_id: "w_1" });
    expect(details(bobShow)).toMatchObject({
      ok: false,
      error: "No watch found for w_1.",
    });

    const aliceList = await tool.execute("tool-4", { action: "list" });
    expect(
      (details(aliceList) as { watches: Array<{ id: string; status: string }> }).watches,
    ).toEqual([expect.objectContaining({ id: "w_1", status: "active" })]);
    const aliceShow = await tool.execute("tool-5", { action: "show", watch_id: "w_1" });
    expect(details(aliceShow)).toMatchObject({
      ok: true,
      watch: { id: "w_1" },
    });

    const cancelled = await tool.execute("tool-6", { action: "cancel", watch_id: "w_1" });
    expect(details(cancelled)).toMatchObject({
      ok: true,
      finalStatus: "cancelled",
    });
    expect(store.watches.get("w_1")?.status).toBe("cancelled");
    const activeAfterCancel = await tool.execute("tool-7", { action: "list" });
    expect((details(activeAfterCancel) as { watches: unknown[] }).watches).toEqual([]);
    const allAfterCancel = await tool.execute("tool-8", { action: "list", include_all: true });
    expect((details(allAfterCancel) as { watches: Array<{ status: string }> }).watches).toEqual([
      expect.objectContaining({ status: "cancelled" }),
    ]);
  });

  it("returns clear validation errors for invalid regex input", async () => {
    const { tool } = createToolHarness();
    const result = await tool.execute("tool-1", {
      action: "create_url_matches",
      url: "https://example.com",
      regex: "[unterminated",
    });

    expect(details(result)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Regex pattern is invalid"),
    });
  });
});
