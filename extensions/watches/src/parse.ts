import type { ModelWatchSource, UrlWatchSource, WatchCondition, WatchKind } from "./types.js";

export type ParsedWatchCommand =
  | { action: "help" }
  | { action: "cancel"; id: string }
  | {
      action: "create";
      kind: WatchKind;
      source: ModelWatchSource | UrlWatchSource;
      condition: WatchCondition;
      title: string;
    }
  | { action: "error"; message: string };

export type ParsedWatchesCommand = {
  includeAll: boolean;
};

const MAX_CONDITION_TEXT_CHARS = 512;
const MAX_MODEL_QUERY_CHARS = 128;

function trimCommandArgs(args?: string): string {
  return args?.trim() ?? "";
}

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function splitFirstToken(value: string): { token: string; rest: string } {
  const trimmed = value.trim();
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  return {
    token: match?.[1] ?? "",
    rest: match?.[2]?.trim() ?? "",
  };
}

function parseProviderModel(query: string): ModelWatchSource {
  const trimmed = query.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex > 0 && slashIndex < trimmed.length - 1) {
    return {
      query: trimmed,
      provider: trimmed.slice(0, slashIndex).trim(),
      model: trimmed.slice(slashIndex + 1).trim(),
    };
  }
  return { query: trimmed, model: trimmed };
}

function parseModelWatch(rest: string): ParsedWatchCommand {
  const untilMatch = /\s+until\s+available\s*$/i.exec(rest);
  if (!untilMatch) {
    return { action: "error", message: "Usage: /watch models <model> until available" };
  }
  const query = rest.slice(0, untilMatch.index).trim();
  if (!query) {
    return { action: "error", message: "Usage: /watch models <model> until available" };
  }
  if (query.length > MAX_MODEL_QUERY_CHARS) {
    return { action: "error", message: "Model watch query is too long." };
  }
  const source = parseProviderModel(query);
  return {
    action: "create",
    kind: "model",
    source,
    condition: { type: "available" },
    title: `Model available: ${query}`,
  };
}

function parseUrlWatch(rest: string): ParsedWatchCommand {
  const first = splitFirstToken(rest);
  if (!first.token) {
    return { action: "error", message: 'Usage: /watch url <url> contains "<text>"' };
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(first.token);
  } catch {
    return { action: "error", message: "Watch URL must be a valid http or https URL." };
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { action: "error", message: "Watch URL must use http or https." };
  }
  const source: UrlWatchSource = { url: parsedUrl.toString() };
  const conditionText = first.rest.trim();
  if (/^changed$/i.test(conditionText)) {
    return {
      action: "create",
      kind: "url",
      source,
      condition: { type: "changed" },
      title: `URL changed: ${parsedUrl.toString()}`,
    };
  }
  const containsMatch = /^contains\s+([\s\S]+)$/i.exec(conditionText);
  if (!containsMatch) {
    return { action: "error", message: 'Usage: /watch url <url> contains "<text>"' };
  }
  const text = stripMatchingQuotes(containsMatch[1] ?? "");
  if (!text) {
    return { action: "error", message: "Contains watch text cannot be empty." };
  }
  if (text.length > MAX_CONDITION_TEXT_CHARS) {
    return { action: "error", message: "Contains watch text is too long." };
  }
  return {
    action: "create",
    kind: "url",
    source,
    condition: { type: "contains", text, caseSensitive: false },
    title: `URL contains: ${text}`,
  };
}

export function parseWatchCommand(args?: string): ParsedWatchCommand {
  const trimmed = trimCommandArgs(args);
  if (!trimmed || /^help$/i.test(trimmed)) {
    return { action: "help" };
  }

  const first = splitFirstToken(trimmed);
  const action = first.token.toLowerCase();
  if (action === "cancel") {
    const id = first.rest.trim();
    if (!id) {
      return { action: "error", message: "Usage: /watch cancel <id>" };
    }
    return { action: "cancel", id };
  }
  if (action === "models" || action === "model") {
    return parseModelWatch(first.rest);
  }
  if (action === "url") {
    return parseUrlWatch(first.rest);
  }
  return { action: "error", message: "Usage: /watch models <model> until available" };
}

export function parseWatchesCommand(args?: string): ParsedWatchesCommand {
  const trimmed = trimCommandArgs(args);
  return { includeAll: /^all$/i.test(trimmed) };
}
