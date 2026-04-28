import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { buildChannelsTable } from "./channels.js";

describe("buildChannelsTable Telegram SecretRef status", () => {
  it("keeps Telegram allowFrom notes readable when botToken is an unresolved file SecretRef", async () => {
    const cfg = {
      channels: {
        telegram: {
          enabled: true,
          botToken: {
            source: "file",
            provider: "filemain",
            id: "/channels/telegram/botToken",
          },
          allowFrom: ["326307323"],
        },
      },
    } as unknown as OpenClawConfig;

    const result = await buildChannelsTable(cfg, { sourceConfig: cfg });

    expect(result.rows).toEqual([
      expect.objectContaining({
        id: "telegram",
        state: "warn",
      }),
    ]);

    const telegramAccounts = result.details.find((entry) => entry.title === "Telegram accounts");
    expect(telegramAccounts?.rows).toHaveLength(1);
    expect(telegramAccounts?.rows[0]?.Notes).toContain("secret unavailable in this command path");
    expect(telegramAccounts?.rows[0]?.Notes).toContain("allow:326307323");
  });
});
