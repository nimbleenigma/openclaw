import type {
  OpenClawPluginApi,
  OpenClawPluginCommandDefinition,
  PluginCommandContext,
} from "../api.js";
import { formatGitHubPrRef } from "./github-pr.js";
import {
  createWatchManagementService,
  type WatchManagementDeps,
  type WatchManagementContext,
} from "./management.js";
import { parseWatchCommand, parseWatchesCommand } from "./parse.js";
import type { UrlWatchSource, WatchCondition, WatchRecord, WatchSource } from "./types.js";

export type WatchesCommandDeps = WatchManagementDeps & {
  api: Pick<OpenClawPluginApi, "runtime">;
};

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

function createManagementContext(ctx: PluginCommandContext): WatchManagementContext {
  return {
    ownerKey: resolveWatchOwnerKey(ctx),
    deliveryTarget: captureDeliveryTarget(ctx),
    allowAnyOwner: isAdminContext(ctx),
  };
}

function formatManagementError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

function isUrlSource(source: WatchSource): source is UrlWatchSource {
  return "url" in source && !("owner" in source);
}

function formatWatchSource(kind: WatchRecord["kind"], source: WatchSource): string {
  if (kind === "url" && isUrlSource(source)) {
    return source.contentMode === "text" ? `${source.url} (page text)` : source.url;
  }
  if (kind === "model" && "query" in source) {
    return source.query;
  }
  if (kind === "github_pr" && "owner" in source) {
    return formatGitHubPrRef(source);
  }
  return "(unknown)";
}

function formatWatchType(kind: WatchRecord["kind"]): string {
  switch (kind) {
    case "github_pr":
      return "GitHub PR";
    case "model":
      return "model";
    case "url":
      return "URL";
  }
  return "watch";
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
    case "github_pr_checks_pass":
      return "checks pass";
    case "github_pr_state_changed":
      return "snapshot changed";
  }
  return "(unknown)";
}

function formatWatchLine(watch: WatchRecord): string {
  const parts = [`- ${watch.id}`, watch.status, watch.title];
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
    `- type: ${formatWatchType(watch.kind)}`,
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
    'Add text for page-text mode, e.g. /watch url <url> text contains "<text>"',
    "/watch github pr <url|owner/repo#number> until checks pass",
    "/watch github pr <url|owner/repo#number> changed",
    "  (PR changed watches fire when the PR snapshot changes: state, draft, merged state, head, or checks.)",
    "/watches",
    "/watch show <id>",
    "/watch cancel <id>",
  ].join("\n");
}

function createWatchCommand(deps: WatchesCommandDeps): OpenClawPluginCommandDefinition {
  const manager = createWatchManagementService(deps);
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

      const managementContext = createManagementContext(ctx);

      if (parsed.action === "show") {
        const watch = manager.showWatch(managementContext, parsed.id);
        if (!watch) {
          return { text: `No watch found for ${parsed.id}.` };
        }
        return { text: formatWatchDetails(watch) };
      }

      if (parsed.action === "cancel") {
        const cancelled = manager.cancelWatch(managementContext, parsed.id);
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
        return {
          text:
            `Watch ${cancelled.id} cancelled.\n` +
            "- final status: cancelled\n" +
            `- ${cancelled.title}`,
        };
      }

      let watch: WatchRecord;
      try {
        watch = manager.createParsedWatch(managementContext, parsed);
      } catch (error) {
        return { text: formatManagementError(error) };
      }
      const baselineNote =
        parsed.condition.type === "changed" || parsed.condition.type === "github_pr_state_changed"
          ? "\n- baseline: first check captures the initial snapshot"
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
  const manager = createWatchManagementService(deps);
  return {
    name: "watches",
    description: "List your active temporary watches.",
    acceptsArgs: true,
    handler: async (ctx) => {
      const parsed = parseWatchesCommand(ctx.args);
      const watches = manager.listWatches(createManagementContext(ctx), {
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
