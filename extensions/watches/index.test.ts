import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/plugins/plugin-api.js";
import type { OpenClawPluginCommandDefinition, OpenClawPluginServiceContext } from "./api.js";
import registerWatches from "./index.js";

describe("watches plugin registration", () => {
  it("registers watch commands and scheduler service", async () => {
    const commands: OpenClawPluginCommandDefinition[] = [];
    let service:
      | {
          id: string;
          start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
          stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
        }
      | undefined;

    const api = createTestPluginApi({
      id: "watches",
      runtime: {
        state: { resolveStateDir: () => "/tmp/openclaw-watches-test" },
        system: {
          notifyCapturedTarget: vi.fn(),
        },
      } as never,
      registerCommand: (command) => commands.push(command),
      registerService: (nextService) => {
        service = nextService;
      },
    });

    registerWatches.register(api);

    expect(commands.map((command) => command.name).toSorted()).toEqual(["watch", "watches"]);
    expect(service?.id).toBe("watches-scheduler");
  });
});
