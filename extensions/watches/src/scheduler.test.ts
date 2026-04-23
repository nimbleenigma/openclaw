import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WATCHES_CONFIG } from "./config.js";
import { WatchesScheduler } from "./scheduler.js";
import { resolveWatchesSqlitePath, WatchesStore } from "./store.sqlite.js";
import type { CheckOutcome, CreateWatchInput, WatchRecord } from "./types.js";

async function withStore(run: (store: WatchesStore) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-watches-scheduler-"));
  const store = new WatchesStore(resolveWatchesSqlitePath(dir));
  try {
    await run(store);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function createInput(params: { id: string; now: number; expiresAt?: number }): CreateWatchInput {
  return {
    id: params.id,
    ownerKey: "telegram:alice",
    deliveryTarget: {
      sessionKey: "agent:main",
      channel: "telegram",
      to: "chat-1",
    },
    title: "URL contains: hello",
    kind: "url",
    source: { url: "https://example.com/" },
    condition: { type: "contains", text: "hello" },
    intervalSeconds: 60,
    nextCheckAt: params.now,
    expiresAt: params.expiresAt ?? params.now + 60_000,
    createdAt: params.now,
  };
}

function createRuntime() {
  return {
    system: {
      notifyCapturedTarget: vi.fn(async () => ({ delivered: true, via: "direct" as const })),
    },
  };
}

describe("WatchesScheduler", () => {
  it("triggers due watches once and notifies the captured target", async () => {
    await withStore(async (store) => {
      store.createWatch(createInput({ id: "w_a", now: 1_000 }));
      const runtime = createRuntime();
      const scheduler = new WatchesScheduler({
        store,
        runtime: runtime as never,
        cfg: {},
        config: DEFAULT_WATCHES_CONFIG,
        claimedBy: "test-worker",
        now: () => 1_000,
        evaluator: async (): Promise<CheckOutcome> => ({
          triggered: true,
          resultHash: "hash-a",
          summary: "matched",
          notification: "Watch triggered",
        }),
      });

      await scheduler.tickOnce();

      expect(store.getWatch("w_a")?.status).toBe("triggered");
      expect(runtime.system.notifyCapturedTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Watch triggered",
          target: expect.objectContaining({ channel: "telegram", to: "chat-1" }),
          idempotencyKey: "watch:w_a:trigger:hash-a",
        }),
      );
    });
  });

  it("keeps non-triggered watches active and schedules the next interval", async () => {
    await withStore(async (store) => {
      store.createWatch(createInput({ id: "w_a", now: 1_000 }));
      const scheduler = new WatchesScheduler({
        store,
        runtime: createRuntime() as never,
        cfg: {},
        config: DEFAULT_WATCHES_CONFIG,
        claimedBy: "test-worker",
        now: () => 2_000,
        evaluator: async () => ({
          triggered: false,
          resultHash: "hash-a",
          summary: "no change",
        }),
      });

      await scheduler.tickOnce();

      const watch = store.getWatch("w_a");
      expect(watch?.status).toBe("active");
      expect(watch?.nextCheckAt).toBe(62_000);
      expect(watch?.claimedBy).toBeUndefined();
    });
  });

  it("expires watches before evaluating them", async () => {
    await withStore(async (store) => {
      store.createWatch(createInput({ id: "w_a", now: 1_000, expiresAt: 1_500 }));
      const evaluator = vi.fn();
      const scheduler = new WatchesScheduler({
        store,
        runtime: createRuntime() as never,
        cfg: {},
        config: DEFAULT_WATCHES_CONFIG,
        claimedBy: "test-worker",
        now: () => 2_000,
        evaluator,
      });

      await scheduler.tickOnce();

      expect(store.getWatch("w_a")?.status).toBe("expired");
      expect(evaluator).not.toHaveBeenCalled();
    });
  });

  it("backs off transient failures and marks terminal failures", async () => {
    await withStore(async (store) => {
      store.createWatch(createInput({ id: "w_a", now: 1_000 }));
      const runtime = createRuntime();
      const config = { ...DEFAULT_WATCHES_CONFIG, maxConsecutiveErrors: 1 };
      const scheduler = new WatchesScheduler({
        store,
        runtime: runtime as never,
        cfg: {},
        config,
        claimedBy: "test-worker",
        now: () => 1_000,
        evaluator: async (_watch: WatchRecord) => {
          throw new Error("network down");
        },
      });

      await scheduler.tickOnce();

      const watch = store.getWatch("w_a");
      expect(watch?.status).toBe("failed");
      expect(watch?.nextCheckAt).toBeUndefined();
      expect(runtime.system.notifyCapturedTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("network down"),
          idempotencyKey: "watch:w_a:failed",
        }),
      );
    });
  });
});
