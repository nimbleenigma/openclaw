import { describe, expect, it } from "vitest";
import { parseWatchCommand, parseWatchesCommand } from "./parse.js";

describe("watch command parser", () => {
  it("parses model availability watches", () => {
    expect(parseWatchCommand("models openai/gpt-5.5 until available")).toEqual({
      action: "create",
      kind: "model",
      source: { query: "openai/gpt-5.5", provider: "openai", model: "gpt-5.5" },
      condition: { type: "available" },
      title: "Model available: openai/gpt-5.5",
    });
  });

  it("parses URL contains watches", () => {
    expect(parseWatchCommand('url https://example.com contains "GPT-5.5 API"')).toEqual({
      action: "create",
      kind: "url",
      source: { url: "https://example.com/" },
      condition: { type: "contains", text: "GPT-5.5 API", caseSensitive: false },
      title: "URL contains: GPT-5.5 API",
    });
  });

  it("parses URL changed watches", () => {
    expect(parseWatchCommand("url https://example.com/announcements changed")).toMatchObject({
      action: "create",
      kind: "url",
      source: { url: "https://example.com/announcements" },
      condition: { type: "changed" },
    });
  });

  it("parses cancel and list flags", () => {
    expect(parseWatchCommand("cancel w_123")).toEqual({ action: "cancel", id: "w_123" });
    expect(parseWatchesCommand("all")).toEqual({ includeAll: true });
    expect(parseWatchesCommand("")).toEqual({ includeAll: false });
  });

  it("rejects unsafe URL schemes", () => {
    expect(parseWatchCommand('url file:///etc/passwd contains "x"')).toEqual({
      action: "error",
      message: "Watch URL must use http or https.",
    });
  });
});
