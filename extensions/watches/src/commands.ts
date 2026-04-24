import { randomBytes } from "node:crypto";
import type {
  OpenClawPluginApi,
  OpenClawPluginCommandDefinition,
  PluginCommandContext,
} from "../api.js";
import type { WatchesConfig } from "./config.js";
import { parseWatchCommand, parseWatchesCommand } from "./parse.js";
import type { CreateWatchInput, WatchCondition, WatchRecord, WatchSource } from "./types.js";

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
    getWatch(id: string): WatchRecord | undefined;
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

function compactText(value: string, maxChars = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function canAccessWatch(watch: WatchRecord, ownerKey: string, allowAnyOwner: boolean): boolean {
  return allowAnyOwner || watch.ownerKey === ownerKey;
}

function formatWatchSource(kind: WatchRecord["kind"], source: WatchSource): string {
  if (kind === "url" && "url" in source) {
    return source.url;
  }
  if (kind === "model" && "query" in source) {
    return source.query;
  }
  return "(unknown)";
}

function formatWatchCondition(condition: WatchCondition): string {
  switch (condition.type) {
    case "available":
      return "available";
    case "changed":
      return "changed";
    case "contains":
      return `contains "${condition.text}"`;
    case "matches":
      return `matches /${condition.pattern}/${condition.flags}`;
  }
  return "(unknown)";
}

function formatWatchLine(watch: WatchRecord): string {
  const parts = [`- ${watch.id}`, watch.status, `${watch.kind}: ${watch.title}`];
  if (watch.status === "active") {
    parts.push(`next: ${formatTimestamp(watch.nextCheckAt)}`);
  }
  parts.push(`last: ${watch.lastResultSummary ? compactText(watch.lastResultSummary) : "none"}`);
  if (watch.lastError) {
    parts.push(`error: ${compactText(watch.lastError)}`);
  }
  return parts.join(" | ");
}

function formatWatchDetails(watch: WatchRecord): string {
  const lines = [
    `Watch ${watch.id}`,
    `- status: ${watch.status}`,
    `- title: ${watch.title}`,
    `- kind: ${watch.kind}`,
    `- source: ${formatWatchSource(watch.kind, watch.source)}`,
    `- condition: ${formatWatchCondition(watch.condition)}`,
    `- next check: ${formatTimestamp(watch.nextCheckAt)}`,
    `- expires: ${formatTimestamp(watch.expiresAt)}`,
    `- last check: ${formatTimestamp(watch.lastCheckedAt)}`,
    `- last result: ${watch.lastResultSummary ? compactText(watch.lastResultSummary, 180) : "none"}`,
    `- errors: ${watch.errorCount}`,
  ];
  if (watch.lastError) {
    lines.push(`- last error: ${compactText(watch.lastError, 180)}`);
  }
  return lines.join("\n");
}

function usage(): string {
  return [
    "Usage:",
    "/watch models <model> until available",
    '/watch url <url> contains "<text>"',
    "/watch url <url> changed",
    '/watch url <url> matches "<regex>"',
    "/watches",
    "/watch show <id>",
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

      if (parsed.action === "show") {
        const watch = store.getWatch(parsed.id);
        if (!watch || !canAccessWatch(watch, ownerKey, isAdminContext(ctx))) {
          return { text: `No watch found for ${parsed.id}.` };
        }
        return { text: formatWatchDetails(watch) };
      }

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
          return {
            text:
              `Watch ${cancelled.id} was not cancelled.\n` +
              `- final status: ${cancelled.status}\n` +
              `- ${cancelled.title}`,
          };
        }
        deps.wakeScheduler?.();
        return {
          text:
            `Watch ${cancelled.id} cancelled.\n` +
            "- final status: cancelled\n" +
            `- ${cancelled.title}`,
        };
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
      const baselineNote =
        parsed.condition.type === "changed"
          ? "\n- baseline: first check captures the initial content"
          : "";
      return {
        text:
          `Watch ${watch.id} created.\n` +
          `- ${watch.title}\n` +
          `- next check: ${formatTimestamp(watch.nextCheckAt)}\n` +
          `- expires: ${formatTimestamp(watch.expiresAt)}` +
          baselineNote,
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
