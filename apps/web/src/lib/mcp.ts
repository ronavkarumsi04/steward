/**
 * The parts of the marketplace that are reasoning rather than markup.
 *
 * The rule worth stating, because it is the one this file deliberately does *not* implement: **the form does not
 * validate.** Whether a server may be installed is decided in exactly one place — `validateMcpInstall` in
 * `packages/core` — and the surface's job is to render the refusal it gets back, marking the field each problem
 * names. A second copy of those rules here would be a second opinion about whether a program may be spawned and an
 * address dialled, and the two would drift exactly where it matters most: the address on the deployment's own
 * network, and the transport a stack has switched off.
 *
 * What is here is the shape of a request (which fields belong to which transport), how an install stands next to
 * what it has been asked, the order a founder wants to read tools in, and the sentence an inspection produced.
 * All pure, all asserted in `mcp.test.ts`.
 */

import type { McpInspectionResult, McpInstallForm, McpServerView, McpToolView } from "./types";

/** The catalog's values with the words a founder reads, so a transport is never shown as a wire format's name. */
export const TRANSPORT_LABELS: Record<string, { label: string; hint: string }> = {
  stdio: { label: "A program on this host", hint: "Steward starts the command, talks to it over stdin/stdout, and stops it when the conversation is over." },
  http: { label: "An HTTP endpoint", hint: "A streamable HTTP server, reached at the address you give." },
  sse: { label: "An SSE endpoint", hint: "A server-sent events endpoint, for servers that stream." },
};

export const transportLabel = (transport: string): string => TRANSPORT_LABELS[transport]?.label ?? transport;
export const transportHint = (transport: string): string => TRANSPORT_LABELS[transport]?.hint ?? "";

/** Where a risk band came from, in the words that stop it reading as a fact about the world. */
export function riskSourceLabel(source: string): string {
  return (
    {
      override: "your own classification",
      hint: "the server's own claim about itself",
      name: "its name",
      default: "nothing the server said",
    }[source] ?? source
  );
}

export const RISK_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/**
 * Tools in the order that matters: what can do the most damage first, then by name.
 *
 * A server's tool list arrives in the server's order, which is the order its author thinks in rather than the
 * order a founder reads a new install in. Sorting is a decision — a company that has just installed something
 * wants the six things it may do, worst first — so it is made once, here, instead of wherever the list is rendered.
 */
export function sortTools(tools: McpToolView[]): McpToolView[] {
  return [...tools].sort((a, b) => (RISK_RANK[a.risk] ?? 9) - (RISK_RANK[b.risk] ?? 9) || a.name.localeCompare(b.name));
}

/**
 * An empty form. The transport decides which half of it is real, and the half that is not is not sent at all.
 */
export function emptyForm(): McpInstallForm {
  return { name: "", slug: "", purpose: "", transport: "stdio", command: "", args: "", env: "", url: "", headers: "" };
}

/** The form a founder edits when they change an install. The slug is shown but never sent: it is immutable. */
export function formFrom(server: McpServerView): McpInstallForm {
  return {
    name: server.name,
    slug: server.slug,
    purpose: server.purpose,
    transport: server.transport,
    command: server.transport === "stdio" ? (server.command ?? "") : "",
    args: server.transport === "stdio" ? server.args.join("\n") : "",
    // Both credential fields start *empty* on an edit, because their values are never sent back to a browser.
    // Leaving them empty keeps what is stored; typing replaces the whole set, which the field says out loud.
    env: "",
    url: server.transport === "stdio" ? "" : (server.url ?? ""),
    headers: "",
  };
}

/** One argument per line, because a command line is a list and a text box is the only honest way to ask for one. */
export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** `KEY=value` per line, split on the first `=` so a value may contain one. A line without one is not a variable. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of parseLines(text)) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

/** `Header: value` per line, the way a person writes an HTTP header. */
export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of parseLines(text)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

/**
 * The request body for an install.
 *
 * The transport decides the shape, and the fields that do not belong to it are *absent* rather than empty: a slug
 * that is only sent when creating, an address that is never sent for a program, arguments that are never sent for
 * a URL. The server validates what it receives, and it should receive only what was asked for.
 */
export function bodyFromForm(form: McpInstallForm, opts: { editing: boolean }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: form.name.trim(),
    purpose: form.purpose.trim(),
    transport: form.transport,
    ...(opts.editing ? {} : { slug: form.slug.trim().toLowerCase() }),
  };
  if (form.transport === "stdio") {
    const env = parseEnv(form.env);
    return { ...body, command: form.command.trim(), args: parseLines(form.args), url: null, headers: {}, ...(opts.editing && !Object.keys(env).length ? {} : { env }) };
  }
  const headers = parseHeaders(form.headers);
  return { ...body, command: null, args: [], env: {}, url: form.url.trim(), ...(opts.editing && !Object.keys(headers).length ? {} : { headers }) };
}

/**
 * How an install stands.
 *
 * `never_inspected` and `unreachable` are different states and the difference is the whole point of inspecting:
 * one is a server nobody has asked, the other is a server that was asked and did not answer. Both offer a founder
 * nothing to grant, which is why neither reads as "installed and ready".
 */
export type McpStanding = "paused" | "unreachable" | "never_inspected" | "empty" | "ready";

export function standing(server: Pick<McpServerView, "enabled" | "error" | "inspectedAt" | "tools">): McpStanding {
  if (!server.enabled) return "paused";
  if (server.error) return "unreachable";
  if (!server.inspectedAt) return "never_inspected";
  if (!server.tools.length) return "empty";
  return "ready";
}

export function standingLabel(state: McpStanding): string {
  return {
    // The consequence lives in the band rather than only in the notice above it, because the notice is transient:
    // a founder who reloads or looks at a card later still has to be told that pausing took the tools away.
    paused: "Paused — no agent can call any of its tools",
    unreachable: "Could not be reached",
    never_inspected: "Installed, not inspected",
    empty: "Inspected, and it offers no tools",
    ready: "Inspected",
  }[state];
}

export function standingTone(state: McpStanding): "ok" | "accent" | "warn" | "danger" | "neutral" {
  return { paused: "neutral", unreachable: "danger", never_inspected: "warn", empty: "warn", ready: "ok" }[state] as "ok" | "accent" | "warn" | "danger" | "neutral";
}

/** The sentence an inspection produced, in one line a founder can read without opening anything. */
export function describeInspection(result: Pick<McpInspectionResult, "ok" | "error" | "added" | "removed" | "changed" | "omitted" | "total">): string {
  if (!result.ok) return result.error ?? "The server could not be reached.";
  const parts: string[] = [`${result.total} tool(s) recorded.`];
  if (result.added.length) parts.push(`${result.added.length} new.`);
  if (result.changed.length) parts.push(`${result.changed.length} changed since last time.`);
  if (result.removed.length) parts.push(`${result.removed.length} no longer offered, so a grant on those now matches nothing.`);
  if (result.omitted) parts.push(`${result.omitted} not recorded, because of this deployment's limits.`);
  return parts.join(" ");
}

/** The pattern a whole-server grant is written as — the same string the runtime matches against. */
export const serverPattern = (slug: string): string => `mcp.${slug}.*`;

/** Every agent that holds anything from this server, which is what the toolbar's summary line asks. */
export function holders(server: McpServerView): Array<{ agentId: string; agentName: string }> {
  const seen = new Map<string, string>();
  for (const tool of server.tools) for (const grant of tool.grantedTo) seen.set(grant.agentId, grant.agentName);
  return [...seen].map(([agentId, agentName]) => ({ agentId, agentName })).sort((a, b) => a.agentName.localeCompare(b.agentName));
}

/** How many of a server's tools an agent may call, which is what a revoke button has to be able to say. */
export const heldCount = (server: McpServerView, agentId: string): number => server.tools.filter((tool) => tool.grantedTo.some((grant) => grant.agentId === agentId)).length;

/** The one-line summary of a grant, for the toolbar above a tool list. */
export function grantSummary(server: McpServerView): string {
  const rows = holders(server).map(({ agentId, agentName }) => `${agentName} (${heldCount(server, agentId)} of ${server.tools.length})`);
  return rows.length ? `Granted to ${rows.join(", ")}.` : "Not granted to anyone yet, so no agent may call any of it.";
}
