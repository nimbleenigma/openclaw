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

  it("parses URL regex watches", () => {
    expect(parseWatchCommand('url https://example.com matches "GPT-5\\.5\\s+API"')).toEqual({
      action: "create",
      kind: "url",
      source: { url: "https://example.com/" },
      condition: { type: "matches", pattern: "GPT-5\\.5\\s+API", flags: "i" },
      title: "URL matches: /GPT-5\\.5\\s+API/i",
    });
    expect(parseWatchCommand('url https://example.com matches "/GPT-5\\.5/m"')).toEqual({
      action: "create",
      kind: "url",
      source: { url: "https://example.com/" },
      condition: { type: "matches", pattern: "GPT-5\\.5", flags: "m" },
      title: "URL matches: /GPT-5\\.5/m",
    });
  });

  it("rejects invalid regex watches clearly", () => {
    expect(parseWatchCommand('url https://example.com matches "[unterminated"')).toMatchObject({
      action: "error",
      message: expect.stringContaining("Regex pattern is invalid"),
    });
    expect(parseWatchCommand('url https://example.com matches "/hello/g"')).toEqual({
      action: "error",
      message: "Regex flags can only include i and m.",
    });
  });

  it("parses cancel, show, and list flags", () => {
    expect(parseWatchCommand("cancel w_123")).toEqual({ action: "cancel", id: "w_123" });
    expect(parseWatchCommand("show w_123")).toEqual({ action: "show", id: "w_123" });
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
