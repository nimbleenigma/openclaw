import { describe, expect, it, vi, beforeEach } from "vitest";
import { peekSystemEventEntries, resetSystemEventsForTest } from "../../infra/system-events.js";

const sendMessageMock = vi.hoisted(() => vi.fn());
const requestHeartbeatNowMock = vi.hoisted(() => vi.fn());

vi.mock("../../infra/outbound/message.js", () => ({
  sendMessage: sendMessageMock,
}));

vi.mock("../../infra/heartbeat-wake.js", () => ({
  requestHeartbeatNow: requestHeartbeatNowMock,
}));

describe("runtime notification helper", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    requestHeartbeatNowMock.mockReset();
    resetSystemEventsForTest();
  });

  it("sends directly when channel and target are captured", async () => {
    sendMessageMock.mockResolvedValue({ via: "direct" });
    const { notifyCapturedTarget } = await import("./runtime-notifications.js");

    const result = await notifyCapturedTarget({
      text: "Watch triggered",
      target: {
        sessionKey: "agent:main",
        channel: "telegram",
        to: "chat-1",
        accountId: "acct",
        threadId: 42,
      },
      cfg: {},
      idempotencyKey: "watch:w_1:trigger:hash",
    });

    expect(result).toEqual({ delivered: true, via: "direct" });
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        to: "chat-1",
        accountId: "acct",
        threadId: 42,
        content: "Watch triggered",
        idempotencyKey: "watch:w_1:trigger:hash",
      }),
    );
  });

  it("falls back to a session system event when direct delivery fails", async () => {
    sendMessageMock.mockRejectedValue(new Error("channel offline"));
    const { notifyCapturedTarget } = await import("./runtime-notifications.js");

    const result = await notifyCapturedTarget({
      text: "Watch triggered",
      target: {
        sessionKey: "agent:main",
        channel: "telegram",
        to: "chat-1",
      },
      idempotencyKey: "watch:w_1:trigger:hash",
    });

    expect(result).toEqual({ delivered: true, via: "system-event" });
    expect(peekSystemEventEntries("agent:main")).toEqual([
      expect.objectContaining({
        text: "Watch triggered",
        contextKey: "watch:w_1:trigger:hash",
        deliveryContext: { channel: "telegram", to: "chat-1" },
      }),
    ]);
    expect(requestHeartbeatNowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "plugin-notification",
        sessionKey: "agent:main",
        heartbeat: { target: "last" },
        coalesceMs: 0,
      }),
    );
  });
});
