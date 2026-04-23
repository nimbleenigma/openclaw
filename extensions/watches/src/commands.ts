import { randomBytes } from "node:crypto";
import type {
  OpenClawPluginApi,
  OpenClawPluginCommandDefinition,
  PluginCommandContext,
} from "../api.js";
import type { WatchesConfig } from "./config.js";
import { parseWatchCommand, parseWatchesCommand } from "./parse.js";
import type { CreateWatchInput, WatchRecord } from "./types.js";

export type WatchesCommandDeps = {
  api: Pick<OpenClawPluginApi, "runtime">;
  getStore: () => {
    createWatch(input: CreateWatchInput): WatchRecord;
    countActiveForOwner(ownerKey: string): number;
    listWatches(params?: {
      ownerKey?: string;
      includeAll?: boolean;
      limit?: number;
    }): WatchRecord[];
    cancelWatch(params: {
      id: string;
      ownerKey?: string;
      now: number;
      allowAnyOwner?: boolean;
    }): WatchRecord | undefined;
  };
  config: WatchesConfig;
  now?: () => number;
  wakeScheduler?: () => void;
};

function nowMs(deps: WatchesCommandDeps): number {
  return deps.now?.() ?? Date.now();
}

export function resolveWatchOwnerKey(ctx: PluginCommandContext): string {
  const sender = ctx.senderId?.trim();
  if (sender) {
    return `${ctx.channel}:${sender}`;
  }
  const from = ctx.from?.trim();
  if (from) {
    return `${ctx.channel}:${from}`;
  }
  const sessionKey = ctx.sessionKey?.trim();
  if (sessionKey) {
    return `session:${sessionKey}`;
  }
  return `channel:${ctx.channel}`;
}

function isAdminContext(ctx: PluginCommandContext): boolean {
  return ctx.gatewayClientScopes?.includes("operator.admin") === true;
}

function generateWatchId(): string {
  return `w_${randomBytes(4).toString("hex")}`;
}

function captureDeliveryTarget(ctx: PluginCommandContext) {
  return {
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    channel: ctx.channel,
    to: ctx.from ?? ctx.to,
    accountId: ctx.accountId,
    threadId: ctx.messageThreadId,
    senderId: ctx.senderId,
  };
}

function formatTimestamp(value?: number): string {
  return value ? new Date(value).toISOString() : "(none)";
}

function formatWatchLine(watch: WatchRecord): string {
  const next = watch.status === "active" ? ` next ${formatTimestamp(watch.nextCheckAt)}` : "";
  return `- ${watch.id} ${watch.status} ${watch.kind}: ${watch.title}${next}`;
}

function usage(): string {
  return [
    "Usage:",
    "/watch models <model> until available",
    '/watch url <url> contains "<text>"',
    "/watch url <url> changed",
    "/watches",
    "/watch cancel <id>",
  ].join("\n");
}

function createWatchCommand(deps: WatchesCommandDeps): OpenClawPluginCommandDefinition {
  return {
    name: "watch",
    description: "Create or cancel a temporary watch.",
    acceptsArgs: true,
    handler: async (ctx) => {
      const parsed = parseWatchCommand(ctx.args);
      if (parsed.action === "help") {
        return { text: usage() };
      }
      if (parsed.action === "error") {
        return { text: `${parsed.message}\n\n${usage()}` };
      }

      const store = deps.getStore();
      const ownerKey = resolveWatchOwnerKey(ctx);
      const now = nowMs(deps);

      if (parsed.action === "cancel") {
        const cancelled = store.cancelWatch({
          id: parsed.id,
          ownerKey,
          now,
          allowAnyOwner: isAdminContext(ctx),
        });
        if (!cancelled) {
          return { text: `No watch found for ${parsed.id}.` };
        }
        if (cancelled.status !== "cancelled") {
          return { text: `Watch ${cancelled.id} is already ${cancelled.status}.` };
        }
        deps.wakeScheduler?.();
        return { text: `Watch ${cancelled.id} cancelled.` };
      }

      const activeCount = store.countActiveForOwner(ownerKey);
      if (activeCount >= deps.config.maxActivePerOwner) {
        return {
          text: `You already have ${activeCount} active watches. Cancel one before adding another.`,
        };
      }

      const watch = store.createWatch({
        id: generateWatchId(),
        ownerKey,
        deliveryTarget: captureDeliveryTarget(ctx),
        title: parsed.title,
        kind: parsed.kind,
        source: parsed.source,
        condition: parsed.condition,
        intervalSeconds: deps.config.defaultIntervalSeconds,
        nextCheckAt: now,
        expiresAt: now + deps.config.defaultExpiryMs,
        createdAt: now,
      });
      deps.wakeScheduler?.();
      return {
        text:
          `Watch ${watch.id} created.\n` +
          `- ${watch.title}\n` +
          `- next check: ${formatTimestamp(watch.nextCheckAt)}\n` +
          `- expires: ${formatTimestamp(watch.expiresAt)}`,
      };
    },
  };
}

function createWatchesCommand(deps: WatchesCommandDeps): OpenClawPluginCommandDefinition {
  return {
    name: "watches",
    description: "List your active temporary watches.",
    acceptsArgs: true,
    handler: async (ctx) => {
      const parsed = parseWatchesCommand(ctx.args);
      const ownerKey = resolveWatchOwnerKey(ctx);
      const watches = deps.getStore().listWatches({
        ownerKey,
        includeAll: parsed.includeAll,
        limit: 50,
      });
      if (watches.length === 0) {
        return { text: parsed.includeAll ? "No watches found." : "No active watches." };
      }
      const title = parsed.includeAll ? "Watches:" : "Active watches:";
      return { text: [title, ...watches.map(formatWatchLine)].join("\n") };
    },
  };
}

export function createWatchesCommands(deps: WatchesCommandDeps): OpenClawPluginCommandDefinition[] {
  return [createWatchCommand(deps), createWatchesCommand(deps)];
}
