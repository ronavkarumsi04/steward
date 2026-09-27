/**
 * Where a browser may be pointed.
 *
 * Two layers, deliberately. The first is a matter of syntax and needs no network: only `http` and `https`, no
 * credentials in the URL (a `https://user:pass@host` is a password in an event log), a bounded length, no control
 * characters. The second is a matter of reachability and needs the resolver: the host must not be private,
 * link-local, loopback or a cloud metadata endpoint, which is the same rule `web.fetch` follows and the same
 * helper enforces — `assertPublicUrl` from `@steward/tools`, imported rather than reimplemented, because a second
 * SSRF guard is a second chance to get it wrong.
 *
 * The one thing this is *not* is a curated allow-list of sites. The guard exists to stop a page from reaching the
 * network the deployment lives on, not to decide which parts of the public web are interesting: a company that
 * cannot read a competitor's pricing page has not been protected, it has been inconvenienced. What a session may
 * do on a page is bounded elsewhere — by the closed action set and by the founder's Stop.
 */

import { assertPublicUrl, isPrivateAddress } from "@steward/tools";
import { hasControlCharacters } from "./actions.js";

export interface TargetPolicy {
  /** Development and self-hosted stacks that really do want to browse their own network set this. */
  allowPrivateAddresses?: boolean;
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * The syntactic half: returns a sentence saying what is wrong, or null when the URL is acceptable.
 * Kept separate from the resolver check so it can be asserted without a network.
 */
export function urlShapeProblem(raw: string): string | null {
  if (!raw.trim()) return "a URL is required";
  if (raw.length > 2000) return "a URL cannot be longer than 2000 characters";
  if (hasControlCharacters(raw)) return "a URL cannot contain control characters";
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return `${raw.trim().slice(0, 120)} is not a URL: it needs a scheme, like https://example.com/pricing`;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return `a browser here opens http and https pages, not ${url.protocol.replace(":", "")}`;
  if (!url.hostname) return "a URL needs a host";
  if (url.username || url.password) {
    return "a URL cannot carry credentials: a username and password in the address would be recorded in the run's history. Connect the service under Integrations instead, or sign in with a session the founder owns.";
  }
  if (url.hostname.endsWith(".local") || url.hostname === "localhost" || url.hostname.endsWith(".internal")) {
    return `${url.hostname} is an internal name, and a page on the public internet is what this browser is for`;
  }
  return null;
}

/**
 * The reachability half. Resolves the host and refuses private, loopback, link-local and metadata destinations.
 * `allowPrivate` is the explicit, visible escape hatch for a stack that wants to browse its own network.
 */
export async function browserTargetProblem(raw: string, policy: TargetPolicy = {}): Promise<string | null> {
  const shape = urlShapeProblem(raw);
  if (shape) return shape;
  const url = new URL(raw.trim());

  // The shape check already refused names like `localhost`, but an address can also be written as a literal.
  if (isPrivateAddress(url.hostname.replace(/^\[|\]$/g, "")) && !policy.allowPrivateAddresses) {
    return `${url.hostname} is a private address, and this browser will not reach into the network the deployment runs on. Set BROWSER_ALLOW_PRIVATE=true if this stack is meant to browse its own intranet.`;
  }
  if (policy.allowPrivateAddresses) return null;

  try {
    await assertPublicUrl(url.toString());
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : `${url.host} could not be resolved`;
  }
}

/** Whether this stack lets a browser reach private addresses. Reported to founders rather than hidden in an env var. */
export function allowsPrivateTargets(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.BROWSER_ALLOW_PRIVATE ?? "").trim().toLowerCase() === "true";
}
