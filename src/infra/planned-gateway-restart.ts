import { resolveSilentReplyRewriteText } from "../shared/silent-reply-policy.js";

export const PLANNED_GATEWAY_RESTART_FALLBACK_TEXT =
  "Gateway restart is in progress; I should resume shortly.";

const DEFAULT_PLANNED_GATEWAY_RESTART_TTL_MS = 120_000;

const plannedRestartExpiresAtBySessionKey = new Map<string, number>();

function normalizeSessionKey(sessionKey: string | undefined): string | undefined {
  const normalized = sessionKey?.trim();
  return normalized || undefined;
}

function resolveSessionLookupKeys(sessionKey: string | undefined): string[] {
  const normalized = normalizeSessionKey(sessionKey);
  if (!normalized) {
    return [];
  }
  const keys = [normalized];
  const threadIndex = normalized.indexOf(":thread:");
  if (threadIndex > 0) {
    keys.push(normalized.slice(0, threadIndex));
  }
  return [...new Set(keys)];
}

function pruneExpiredPlannedGatewayRestarts(nowMs: number) {
  for (const [sessionKey, expiresAt] of plannedRestartExpiresAtBySessionKey) {
    if (expiresAt <= nowMs) {
      plannedRestartExpiresAtBySessionKey.delete(sessionKey);
    }
  }
}

export function markPlannedGatewayRestart(params: {
  sessionKey?: string;
  nowMs?: number;
  ttlMs?: number;
}): boolean {
  const keys = resolveSessionLookupKeys(params.sessionKey);
  if (keys.length === 0) {
    return false;
  }
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs =
    typeof params.ttlMs === "number" && Number.isFinite(params.ttlMs) && params.ttlMs > 0
      ? Math.floor(params.ttlMs)
      : DEFAULT_PLANNED_GATEWAY_RESTART_TTL_MS;
  const expiresAt = nowMs + ttlMs;
  for (const key of keys) {
    plannedRestartExpiresAtBySessionKey.set(key, expiresAt);
  }
  return true;
}

export function clearPlannedGatewayRestart(params: { sessionKey?: string }) {
  for (const key of resolveSessionLookupKeys(params.sessionKey)) {
    plannedRestartExpiresAtBySessionKey.delete(key);
  }
}

export function clearAllPlannedGatewayRestarts() {
  plannedRestartExpiresAtBySessionKey.clear();
}

export function resolvePlannedGatewayRestartFallbackText(params: {
  sessionKey?: string;
  nowMs?: number;
}): string | undefined {
  const nowMs = params.nowMs ?? Date.now();
  pruneExpiredPlannedGatewayRestarts(nowMs);
  return resolveSessionLookupKeys(params.sessionKey).some((key) =>
    plannedRestartExpiresAtBySessionKey.has(key),
  )
    ? PLANNED_GATEWAY_RESTART_FALLBACK_TEXT
    : undefined;
}

export function resolveRestartAwareSilentReplyRewriteText(params: {
  sessionKey?: string;
  seed?: string;
}): string {
  return (
    resolvePlannedGatewayRestartFallbackText({ sessionKey: params.sessionKey }) ??
    resolveSilentReplyRewriteText({ seed: params.seed })
  );
}
