import { afterEach, describe, expect, it } from "vitest";
import {
  PLANNED_GATEWAY_RESTART_FALLBACK_TEXT,
  clearAllPlannedGatewayRestarts,
  clearGlobalPlannedGatewayRestart,
  clearPlannedGatewayRestart,
  markGlobalPlannedGatewayRestart,
  markPlannedGatewayRestart,
  resolvePlannedGatewayRestartFallbackText,
  resolveRestartAwareSilentReplyRewriteText,
} from "./planned-gateway-restart.js";

describe("planned gateway restart fallback", () => {
  afterEach(() => {
    clearAllPlannedGatewayRestarts();
  });

  it("returns restart-aware text for marked sessions only", () => {
    markPlannedGatewayRestart({
      sessionKey: "agent:main:telegram:direct:123",
      nowMs: 10,
      ttlMs: 1_000,
    });

    expect(
      resolvePlannedGatewayRestartFallbackText({
        sessionKey: "agent:main:telegram:direct:123",
        nowMs: 20,
      }),
    ).toBe(PLANNED_GATEWAY_RESTART_FALLBACK_TEXT);
    expect(
      resolvePlannedGatewayRestartFallbackText({
        sessionKey: "agent:main:telegram:direct:456",
        nowMs: 20,
      }),
    ).toBeUndefined();
  });

  it("expires and clears planned restart markers", () => {
    markPlannedGatewayRestart({
      sessionKey: "agent:main:telegram:direct:123",
      nowMs: 10,
      ttlMs: 50,
    });

    expect(
      resolvePlannedGatewayRestartFallbackText({
        sessionKey: "agent:main:telegram:direct:123",
        nowMs: 59,
      }),
    ).toBe(PLANNED_GATEWAY_RESTART_FALLBACK_TEXT);
    expect(
      resolvePlannedGatewayRestartFallbackText({
        sessionKey: "agent:main:telegram:direct:123",
        nowMs: 60,
      }),
    ).toBeUndefined();

    markPlannedGatewayRestart({ sessionKey: "agent:main:telegram:direct:123", nowMs: 100 });
    clearPlannedGatewayRestart({ sessionKey: "agent:main:telegram:direct:123" });

    expect(
      resolvePlannedGatewayRestartFallbackText({
        sessionKey: "agent:main:telegram:direct:123",
        nowMs: 110,
      }),
    ).toBeUndefined();
  });

  it("matches generic thread suffixes through their base session", () => {
    markPlannedGatewayRestart({
      sessionKey: "agent:main:telegram:direct:123:thread:abc",
      nowMs: 10,
    });

    expect(
      resolvePlannedGatewayRestartFallbackText({
        sessionKey: "agent:main:telegram:direct:123",
        nowMs: 20,
      }),
    ).toBe(PLANNED_GATEWAY_RESTART_FALLBACK_TEXT);
  });

  it("uses session markers before the global marker", () => {
    markGlobalPlannedGatewayRestart({
      nowMs: 10,
      ttlMs: 1,
    });
    markPlannedGatewayRestart({
      sessionKey: "agent:main:telegram:direct:123",
      nowMs: 10,
      ttlMs: 1_000,
    });

    expect(
      resolvePlannedGatewayRestartFallbackText({
        sessionKey: "agent:main:telegram:direct:123",
        nowMs: 20,
      }),
    ).toBe(PLANNED_GATEWAY_RESTART_FALLBACK_TEXT);
  });

  it("returns restart-aware text for global planned restarts without a session marker", () => {
    markGlobalPlannedGatewayRestart({
      nowMs: 10,
      ttlMs: 1_000,
    });

    expect(
      resolvePlannedGatewayRestartFallbackText({
        nowMs: 20,
      }),
    ).toBe(PLANNED_GATEWAY_RESTART_FALLBACK_TEXT);
    expect(
      resolvePlannedGatewayRestartFallbackText({
        sessionKey: "agent:main:telegram:direct:123",
        nowMs: 20,
      }),
    ).toBe(PLANNED_GATEWAY_RESTART_FALLBACK_TEXT);
  });

  it("expires and clears global planned restart markers", () => {
    markGlobalPlannedGatewayRestart({
      nowMs: 10,
      ttlMs: 50,
    });

    expect(resolvePlannedGatewayRestartFallbackText({ nowMs: 59 })).toBe(
      PLANNED_GATEWAY_RESTART_FALLBACK_TEXT,
    );
    expect(resolvePlannedGatewayRestartFallbackText({ nowMs: 60 })).toBeUndefined();

    markGlobalPlannedGatewayRestart({ nowMs: 100 });
    clearGlobalPlannedGatewayRestart();

    expect(resolvePlannedGatewayRestartFallbackText({ nowMs: 110 })).toBeUndefined();
  });

  it("delegates expired global markers to normal silent-reply rewrite text", () => {
    markGlobalPlannedGatewayRestart({
      nowMs: 10,
      ttlMs: 1,
    });

    expect(resolvePlannedGatewayRestartFallbackText({ nowMs: 20 })).toBeUndefined();
    expect(
      resolveRestartAwareSilentReplyRewriteText({
        seed: "silent-reply:NO_REPLY",
      }),
    ).not.toBe(PLANNED_GATEWAY_RESTART_FALLBACK_TEXT);
  });

  it("falls back to normal silent-reply rewrite text without an active marker", () => {
    expect(
      resolveRestartAwareSilentReplyRewriteText({
        sessionKey: "agent:main:telegram:direct:123",
        seed: "agent:main:telegram:direct:123:NO_REPLY",
      }),
    ).not.toBe(PLANNED_GATEWAY_RESTART_FALLBACK_TEXT);
  });
});
