import type { z } from "zod";
import { ProviderError, type ChatResponse } from "./types.js";

/** Extracts the first JSON object/array from model text (handles ```json fences and prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const trimmed = c.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through */
    }
    const start = Math.min(...["{", "["].map((ch) => trimmed.indexOf(ch)).filter((i) => i >= 0));
    if (!Number.isFinite(start)) continue;
    for (let end = trimmed.length; end > start; end--) {
      const ch = trimmed[end - 1];
      if (ch !== "}" && ch !== "]") continue;
      try {
        return JSON.parse(trimmed.slice(start, end));
      } catch {
        /* keep shrinking */
      }
    }
  }
  throw new ProviderError("invalid_request", "Model did not return valid JSON", "gateway", false, undefined, undefined, text.slice(0, 500));
}

export function parseStructured<T>(res: ChatResponse, schema: z.ZodType<T>): T {
  const raw = extractJson(res.text);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ProviderError("invalid_request", `Structured output failed validation: ${parsed.error.message}`, res.provider, false, undefined, undefined, raw);
  return parsed.data;
}
