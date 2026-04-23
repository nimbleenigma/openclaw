import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { requestHeartbeatNow } from "../../infra/heartbeat-wake.js";
import { sendMessage } from "../../infra/outbound/message.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { normalizeDeliveryContext } from "../../utils/delivery-context.shared.js";
import type { DeliveryContext } from "../../utils/delivery-context.types.js";

export type RuntimeNotificationTarget = DeliveryContext & {
  sessionKey?: string;
};

export type RuntimeNotifyCapturedTargetParams = {
  text: string;
  target: RuntimeNotificationTarget;
  cfg?: OpenClawConfig;
  idempotencyKey?: string;
  reason?: string;
};

export type RuntimeNotifyCapturedTargetResult =
  | { delivered: true; via: "direct" | "system-event" }
  | { delivered: false; via: "none"; error: string };

function normalizeSessionKey(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeText(value: string): string {
  return value.trim();
}

function formatNotificationError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function enqueueSessionNotification(params: {
  text: string;
  sessionKey: string;
  deliveryContext?: DeliveryContext;
  idempotencyKey?: string;
  reason?: string;
}): Promise<RuntimeNotifyCapturedTargetResult> {
  const queued = enqueueSystemEvent(params.text, {
    sessionKey: params.sessionKey,
    contextKey: params.idempotencyKey,
    deliveryContext: params.deliveryContext,
    trusted: true,
  });
  requestHeartbeatNow({
    reason: params.reason ?? "plugin-notification",
    sessionKey: params.sessionKey,
    heartbeat: { target: "last" },
    coalesceMs: 0,
  });
  return queued
    ? { delivered: true, via: "system-event" }
    : { delivered: false, via: "none", error: "duplicate system event" };
}

export async function notifyCapturedTarget(
  params: RuntimeNotifyCapturedTargetParams,
): Promise<RuntimeNotifyCapturedTargetResult> {
  const text = normalizeText(params.text);
  if (!text) {
    return { delivered: false, via: "none", error: "empty notification text" };
  }

  const sessionKey = normalizeSessionKey(params.target.sessionKey);
  const deliveryContext = normalizeDeliveryContext(params.target);
  if (deliveryContext?.channel && deliveryContext.to) {
    try {
      await sendMessage({
        channel: deliveryContext.channel,
        to: deliveryContext.to,
        accountId: deliveryContext.accountId,
        threadId: deliveryContext.threadId,
        content: text,
        cfg: params.cfg,
        idempotencyKey: params.idempotencyKey,
        requesterSessionKey: sessionKey,
        bestEffort: true,
      });
      return { delivered: true, via: "direct" };
    } catch (error) {
      if (!sessionKey) {
        return {
          delivered: false,
          via: "none",
          error: formatNotificationError(error),
        };
      }
    }
  }

  if (!sessionKey) {
    return {
      delivered: false,
      via: "none",
      error: "notification target requires a channel/to route or sessionKey",
    };
  }

  return await enqueueSessionNotification({
    text,
    sessionKey,
    deliveryContext,
    idempotencyKey: params.idempotencyKey,
    reason: params.reason,
  });
}
