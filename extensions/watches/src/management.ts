import { randomBytes } from "node:crypto";
import type { WatchesConfig } from "./config.js";
import { MAX_CONDITION_TEXT_CHARS, MAX_MODEL_QUERY_CHARS, parseProviderModel } from "./parse.js";
import { parseWatchRegex } from "./regex.js";
import type {
  CreateWatchInput,
  WatchCondition,
  WatchDeliveryTarget,
  WatchKind,
  WatchRecord,
  WatchSource,
} from "./types.js";

export type WatchManagementStore = {
  createWatch(input: CreateWatchInput): WatchRecord;
  countActiveForOwner(ownerKey: string): number;
  listWatches(params?: { ownerKey?: string; includeAll?: boolean; limit?: number }): WatchRecord[];
  getWatch(id: string): WatchRecord | undefined;
  cancelWatch(params: {
    id: string;
    ownerKey?: string;
    now: number;
    allowAnyOwner?: boolean;
  }): WatchRecord | undefined;
};

export type WatchManagementContext = {
  ownerKey: string;
  deliveryTarget: WatchDeliveryTarget;
  allowAnyOwner?: boolean;
};

export type WatchCreateSpec = {
  kind: WatchKind;
  source: WatchSource;
  condition: WatchCondition;
  title: string;
};

export type WatchManagementDeps = {
  getStore: () => WatchManagementStore;
  config: WatchesConfig;
  now?: () => number;
  idGenerator?: () => string;
  wakeScheduler?: () => void;
};

export class WatchManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchManagementError";
  }
}

function defaultWatchId(): string {
  return `w_${randomBytes(4).toString("hex")}`;
}

function nowMs(deps: WatchManagementDeps): number {
  return deps.now?.() ?? Date.now();
}

function normalizeHttpUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new WatchManagementError("Watch URL must be a valid http or https URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WatchManagementError("Watch URL must use http or https.");
  }
  return parsed.toString();
}

function ensureAccess(watch: WatchRecord, context: WatchManagementContext): boolean {
  return context.allowAnyOwner === true || watch.ownerKey === context.ownerKey;
}

export class WatchManagementService {
  constructor(private readonly deps: WatchManagementDeps) {}

  createParsedWatch(context: WatchManagementContext, spec: WatchCreateSpec): WatchRecord {
    const store = this.deps.getStore();
    const activeCount = store.countActiveForOwner(context.ownerKey);
    if (activeCount >= this.deps.config.maxActivePerOwner) {
      throw new WatchManagementError(
        `You already have ${activeCount} active watches. Cancel one before adding another.`,
      );
    }

    const now = nowMs(this.deps);
    const watch = store.createWatch({
      id: (this.deps.idGenerator ?? defaultWatchId)(),
      ownerKey: context.ownerKey,
      deliveryTarget: context.deliveryTarget,
      title: spec.title,
      kind: spec.kind,
      source: spec.source,
      condition: spec.condition,
      intervalSeconds: this.deps.config.defaultIntervalSeconds,
      nextCheckAt: now,
      expiresAt: now + this.deps.config.defaultExpiryMs,
      createdAt: now,
    });
    this.deps.wakeScheduler?.();
    return watch;
  }

  createModelAvailabilityWatch(
    context: WatchManagementContext,
    params: { model: string },
  ): WatchRecord {
    const query = params.model.trim();
    if (!query) {
      throw new WatchManagementError("Model watch query cannot be empty.");
    }
    if (query.length > MAX_MODEL_QUERY_CHARS) {
      throw new WatchManagementError("Model watch query is too long.");
    }
    return this.createParsedWatch(context, {
      kind: "model",
      source: parseProviderModel(query),
      condition: { type: "available" },
      title: `Model available: ${query}`,
    });
  }

  createUrlContainsWatch(
    context: WatchManagementContext,
    params: { url: string; text: string },
  ): WatchRecord {
    const text = params.text.trim();
    if (!text) {
      throw new WatchManagementError("Contains watch text cannot be empty.");
    }
    if (text.length > MAX_CONDITION_TEXT_CHARS) {
      throw new WatchManagementError("Contains watch text is too long.");
    }
    return this.createParsedWatch(context, {
      kind: "url",
      source: { url: normalizeHttpUrl(params.url) },
      condition: { type: "contains", text, caseSensitive: false },
      title: `URL contains: ${text}`,
    });
  }

  createUrlRegexWatch(
    context: WatchManagementContext,
    params: { url: string; regex: string },
  ): WatchRecord {
    const parsedRegex = parseWatchRegex(params.regex);
    if (!parsedRegex.ok) {
      throw new WatchManagementError(parsedRegex.message);
    }
    return this.createParsedWatch(context, {
      kind: "url",
      source: { url: normalizeHttpUrl(params.url) },
      condition: { type: "matches", pattern: parsedRegex.pattern, flags: parsedRegex.flags },
      title: `URL matches: /${parsedRegex.pattern}/${parsedRegex.flags}`,
    });
  }

  createUrlChangedWatch(context: WatchManagementContext, params: { url: string }): WatchRecord {
    const url = normalizeHttpUrl(params.url);
    return this.createParsedWatch(context, {
      kind: "url",
      source: { url },
      condition: { type: "changed" },
      title: `URL changed: ${url}`,
    });
  }

  listWatches(
    context: WatchManagementContext,
    params: { includeAll?: boolean; limit?: number } = {},
  ): WatchRecord[] {
    return this.deps.getStore().listWatches({
      ownerKey: context.ownerKey,
      includeAll: params.includeAll,
      limit: params.limit,
    });
  }

  showWatch(context: WatchManagementContext, id: string): WatchRecord | undefined {
    const watch = this.deps.getStore().getWatch(id);
    return watch && ensureAccess(watch, context) ? watch : undefined;
  }

  cancelWatch(context: WatchManagementContext, id: string): WatchRecord | undefined {
    const cancelled = this.deps.getStore().cancelWatch({
      id,
      ownerKey: context.ownerKey,
      now: nowMs(this.deps),
      allowAnyOwner: context.allowAnyOwner,
    });
    if (cancelled?.status === "cancelled") {
      this.deps.wakeScheduler?.();
    }
    return cancelled;
  }
}

export function createWatchManagementService(deps: WatchManagementDeps): WatchManagementService {
  return new WatchManagementService(deps);
}
