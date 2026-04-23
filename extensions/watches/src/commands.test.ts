import { describe, expect, it, vi } from "vitest";
import { createWatchesCommands } from "./commands.js";
import { DEFAULT_WATCHES_CONFIG } from "./config.js";
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

function createContext(args: string, senderId = "alice") {
  return {
    senderId,
    channel: "telegram",
    isAuthorizedSender: true,
    sessionKey: "agent:main",
    sessionId: "main",
    args,
    commandBody: args ? `/watch ${args}` : "/watch",
    config: {},
    from: "chat-1",
    accountId: "acct",
    requestConversationBinding: vi.fn(),
    detachConversationBinding: vi.fn(),
    getCurrentConversationBinding: vi.fn(),
  };
}

describe("watch commands", () => {
  it("creates watches and lists them for the owner", async () => {
    const store = createMemoryStore();
    const wakeScheduler = vi.fn();
    const [watchCommand, watchesCommand] = createWatchesCommands({
      api: { runtime: {} as never },
      getStore: () => store,
      config: DEFAULT_WATCHES_CONFIG,
      now: () => 1_000,
      wakeScheduler,
    });

    const created = await watchCommand.handler(
      createContext('url https://example.com contains "hello"') as never,
    );
    expect(created.text).toContain("created");
    expect(store.watches.size).toBe(1);
    expect(wakeScheduler).toHaveBeenCalled();

    const listed = await watchesCommand.handler(createContext("") as never);
    expect(listed.text).toContain("Active watches:");
    expect(listed.text).toContain("URL contains: hello");
  });

  it("cancels only watches owned by the caller", async () => {
    const store = createMemoryStore();
    const [watchCommand] = createWatchesCommands({
      api: { runtime: {} as never },
      getStore: () => store,
      config: DEFAULT_WATCHES_CONFIG,
      now: () => 1_000,
    });
    await watchCommand.handler(createContext("models gpt-5.5 until available", "alice") as never);
    const id = [...store.watches.keys()][0];

    const denied = await watchCommand.handler(createContext(`cancel ${id}`, "bob") as never);
    expect(denied.text).toContain("No watch found");
    expect(store.watches.get(id)?.status).toBe("active");

    const cancelled = await watchCommand.handler(createContext(`cancel ${id}`, "alice") as never);
    expect(cancelled.text).toContain("cancelled");
    expect(store.watches.get(id)?.status).toBe("cancelled");
  });

  it("enforces the active watch limit per owner", async () => {
    const store = createMemoryStore();
    const [watchCommand] = createWatchesCommands({
      api: { runtime: {} as never },
      getStore: () => store,
      config: { ...DEFAULT_WATCHES_CONFIG, maxActivePerOwner: 1 },
      now: () => 1_000,
    });

    await watchCommand.handler(createContext("models gpt-5.5 until available") as never);
    const blocked = await watchCommand.handler(
      createContext("models gpt-5.6 until available") as never,
    );
    expect(blocked.text).toContain("Cancel one");
  });
});
