import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { defineTool, untrusted } from "./registry.js";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80")) return true;
  if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
  return false;
}

/** Resolves a URL's host and refuses private/link-local/metadata destinations (SSRF protection). */
export async function assertPublicUrl(raw: string, allowPrivate = false): Promise<URL> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`Unsupported protocol ${url.protocol}`);
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host.toLowerCase()) || host.endsWith(".internal") || host.endsWith(".local")) throw new Error(`Blocked host ${host}`);
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  for (const a of addrs) if (isPrivateAddress(a.address)) throw new Error(`Refusing to connect to private address for ${host}`);
  return url;
}

export interface SafeFetchOptions extends RequestInit {
  timeoutMs?: number;
  maxBytes?: number;
  allowPrivate?: boolean;
  maxRedirects?: number;
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<{ response: Response; body: string; finalUrl: string }> {
  const { timeoutMs = 20_000, maxBytes = 2_000_000, allowPrivate = false, maxRedirects = 5, ...init } = opts;
  let url = await assertPublicUrl(raw, allowPrivate);
  for (let i = 0; i <= maxRedirects; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    if (init.signal) init.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    let res: Response;
    try {
      res = await fetch(url, { ...init, redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "StewardBot/0.1 (+https://github.com/steward-os)", accept: "text/html,application/json,text/plain,*/*", ...(init.headers as Record<string, string> | undefined) } });
    } finally {
      clearTimeout(t);
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Redirect without location");
      url = await assertPublicUrl(new URL(loc, url).toString(), allowPrivate);
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks).toString("utf8");
    return { response: res, body, finalUrl: url.toString() };
  }
  throw new Error("Too many redirects");
}

/** Very small HTML → text conversion for model consumption. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|blockquote|pre)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const webFetchTool = defineTool({
  name: "web.fetch",
  description: "Fetch a public web page or JSON API (GET) and return its readable text content. Use for research and reading documentation. Cannot access private networks.",
  input: z.object({ url: z.string().url(), maxChars: z.number().int().min(500).max(60_000).default(15_000) }),
  risk: "LOW",
  idempotent: true,
  sideEffects: "none",
  timeoutMs: 30_000,
  execute: async ({ url, maxChars }, ctx) => {
    try {
      const { response, body, finalUrl } = await safeFetch(url, { signal: ctx.signal });
      const type = response.headers.get("content-type") ?? "";
      const text = type.includes("html") ? htmlToText(body) : body;
      if (!response.ok) return { ok: false, content: `HTTP ${response.status} from ${finalUrl}\n${untrusted(finalUrl, text, 2000)}`, untrusted: true };
      const title = body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
      return { ok: true, content: untrusted(finalUrl, `${title ? `Title: ${title}\n\n` : ""}${text}`, maxChars), data: { url: finalUrl, status: response.status, title, contentType: type }, untrusted: true };
    } catch (e) {
      return { ok: false, content: `Fetch failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
});

export interface SearchProvider {
  search(query: string, opts: { maxResults: number; signal?: AbortSignal }): Promise<Array<{ title: string; url: string; snippet: string; publishedAt?: string }>>;
}

/** Brave Search API. */
export class BraveSearch implements SearchProvider {
  constructor(private readonly apiKey: string) {}
  async search(query: string, { maxResults, signal }: { maxResults: number; signal?: AbortSignal }) {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`, { headers: { accept: "application/json", "x-subscription-token": this.apiKey }, signal });
    if (!res.ok) throw new Error(`Brave search HTTP ${res.status}`);
    const j = (await res.json()) as { web?: { results?: Array<{ title: string; url: string; description: string; age?: string }> } };
    return (j.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description, publishedAt: r.age }));
  }
}

/** Tavily search API. */
export class TavilySearch implements SearchProvider {
  constructor(private readonly apiKey: string) {}
  async search(query: string, { maxResults, signal }: { maxResults: number; signal?: AbortSignal }) {
    const res = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify({ query, max_results: maxResults }), signal });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const j = (await res.json()) as { results?: Array<{ title: string; url: string; content: string; published_date?: string }> };
    return (j.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content, publishedAt: r.published_date }));
  }
}

/** Self-hosted SearXNG instance (JSON format must be enabled). */
export class SearxngSearch implements SearchProvider {
  constructor(private readonly baseUrl: string) {}
  async search(query: string, { maxResults, signal }: { maxResults: number; signal?: AbortSignal }) {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json`, { signal });
    if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
    const j = (await res.json()) as { results?: Array<{ title: string; url: string; content: string; publishedDate?: string }> };
    return (j.results ?? []).slice(0, maxResults).map((r) => ({ title: r.title, url: r.url, snippet: r.content, publishedAt: r.publishedDate ?? undefined }));
  }
}

/** DuckDuckGo HTML endpoint fallback (no key). Best-effort; rate limited upstream. */
export class DuckDuckGoSearch implements SearchProvider {
  async search(query: string, { maxResults, signal }: { maxResults: number; signal?: AbortSignal }) {
    const { body } = await safeFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { signal });
    const out: Array<{ title: string; url: string; snippet: string }> = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) && out.length < maxResults) {
      let href = m[1]!;
      const uddg = href.match(/uddg=([^&]+)/);
      if (uddg) href = decodeURIComponent(uddg[1]!);
      out.push({ title: htmlToText(m[2]!), url: href, snippet: htmlToText(m[3]!) });
    }
    return out;
  }
}

export const webSearchTool = defineTool({
  name: "web.search",
  description: "Search the public web. Returns titles, URLs and snippets. Follow up with web.fetch to read a result.",
  input: z.object({ query: z.string().min(2).max(400), maxResults: z.number().int().min(1).max(10).default(6) }),
  risk: "LOW",
  idempotent: true,
  sideEffects: "none",
  execute: async ({ query, maxResults }, ctx) => {
    const provider = ctx.services.search as SearchProvider | undefined;
    if (!provider) return { ok: false, content: "No web search provider is configured. Ask the operator to set SEARCH_PROVIDER (brave, tavily, searxng, duckduckgo)." };
    try {
      const results = await provider.search(query, { maxResults, signal: ctx.signal });
      const text = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}${r.publishedAt ? `\n   (${r.publishedAt})` : ""}`).join("\n\n");
      return { ok: true, content: untrusted(`search:${query}`, text || "No results."), data: results, untrusted: true };
    } catch (e) {
      return { ok: false, content: `Search failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
});

export function searchProviderFromEnv(env: NodeJS.ProcessEnv = process.env): SearchProvider | undefined {
  switch ((env.SEARCH_PROVIDER ?? "").toLowerCase()) {
    case "brave":
      return env.BRAVE_SEARCH_API_KEY ? new BraveSearch(env.BRAVE_SEARCH_API_KEY) : undefined;
    case "tavily":
      return env.TAVILY_API_KEY ? new TavilySearch(env.TAVILY_API_KEY) : undefined;
    case "searxng":
      return env.SEARXNG_URL ? new SearxngSearch(env.SEARXNG_URL) : undefined;
    case "duckduckgo":
      return new DuckDuckGoSearch();
    default:
      return undefined;
  }
}
