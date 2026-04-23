import { createHash } from "node:crypto";
import type { WatchCondition } from "./types.js";

export function hashWatchResult(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function truncateSummary(value: string, maxChars = 500): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function evaluateTextCondition(params: {
  condition: WatchCondition;
  text: string;
  previousHash?: string;
}): { triggered: boolean; resultHash: string; summary: string } {
  const resultHash = hashWatchResult(params.text);
  switch (params.condition.type) {
    case "changed": {
      if (!params.previousHash) {
        return {
          triggered: false,
          resultHash,
          summary: "Baseline captured.",
        };
      }
      return {
        triggered: params.previousHash !== resultHash,
        resultHash,
        summary:
          params.previousHash !== resultHash
            ? "Content changed since the baseline."
            : "No content change detected.",
      };
    }
    case "contains": {
      const haystack = params.condition.caseSensitive ? params.text : params.text.toLowerCase();
      const needle = params.condition.caseSensitive
        ? params.condition.text
        : params.condition.text.toLowerCase();
      const matched = haystack.includes(needle);
      return {
        triggered: matched,
        resultHash,
        summary: matched
          ? `Matched text: ${params.condition.text}`
          : `Text not found: ${params.condition.text}`,
      };
    }
    case "available":
      return {
        triggered: false,
        resultHash,
        summary: "Availability conditions are evaluated by model checks.",
      };
  }
  return {
    triggered: false,
    resultHash,
    summary: "Unsupported condition.",
  };
}
