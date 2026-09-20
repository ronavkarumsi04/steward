import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PolicyDimension, RiskLevel } from "@steward/schema";

export type AuthKind = "oauth2" | "api_key" | "token" | "basic" | "webhook_url" | "smtp";

export interface OAuth2Config {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  pkce: boolean;
  /** Extra params for the authorize request (e.g. access_type=offline). */
  authorizeParams?: Record<string, string>;
  /** Some providers want client auth in the body instead of Basic. */
  clientAuth: "basic" | "body";
  revokeUrl?: string;
}

export interface IntegrationAction {
  name: string;
  description: string;
  risk: RiskLevel;
  dimension?: PolicyDimension;
  externallyVisible: boolean;
}

export interface IntegrationDefinition {
  id: string;
  name: string;
  category: "source_control" | "deploy" | "database" | "email" | "messaging" | "social" | "payments" | "crm" | "docs" | "identity" | "ads" | "analytics" | "generic";
  authKind: AuthKind;
  oauth?: OAuth2Config;
  /** Fields the user fills in for non-OAuth auth (labels/hints only; values are encrypted). */
  fields?: Array<{ key: string; label: string; secret: boolean; placeholder?: string; help?: string }>;
  docsUrl: string;
  actions: IntegrationAction[];
  webhook?: { signatureHeader: string; scheme: "hmac_sha256_hex" | "hmac_sha256_base64" | "stripe" | "svix" | "slack" | "twilio" | "ed25519" | "token" };
  status: "implemented" | "framework" | "planned";
}

export interface IntegrationSecret {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
  scope?: string;
  /** API key / token / password style secrets. */
  fields?: Record<string, string>;
  /** Provider account metadata (non-secret). */
  account?: Record<string, unknown>;
}

// ---------- OAuth helpers ----------
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl(cfg: OAuth2Config, p: { clientId: string; redirectUri: string; state: string; codeChallenge?: string; scopes?: string[] }): string {
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("state", p.state);
  const scopes = p.scopes ?? cfg.scopes;
  if (scopes.length) u.searchParams.set("scope", scopes.join(" "));
  if (cfg.pkce && p.codeChallenge) {
    u.searchParams.set("code_challenge", p.codeChallenge);
    u.searchParams.set("code_challenge_method", "S256");
  }
  for (const [k, v] of Object.entries(cfg.authorizeParams ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  [k: string]: unknown;
}

async function tokenRequest(cfg: OAuth2Config, clientId: string, clientSecret: string | undefined, params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (cfg.clientAuth === "basic" && clientSecret) headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  else {
    body.set("client_id", clientId);
    if (clientSecret) body.set("client_secret", clientSecret);
  }
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers, body });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    json = Object.fromEntries(new URLSearchParams(text));
  }
  if (!res.ok || json.error) throw new OAuthError(String(json.error ?? `HTTP ${res.status}`), String(json.error_description ?? text.slice(0, 300)), res.status);
  return json as TokenResponse;
}

export class OAuthError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(`${code}: ${message}`);
  }
}

export function exchangeCode(cfg: OAuth2Config, p: { clientId: string; clientSecret?: string; code: string; redirectUri: string; codeVerifier?: string }): Promise<TokenResponse> {
  return tokenRequest(cfg, p.clientId, p.clientSecret, { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, ...(p.codeVerifier ? { code_verifier: p.codeVerifier } : {}) });
}

export function refreshAccessToken(cfg: OAuth2Config, p: { clientId: string; clientSecret?: string; refreshToken: string }): Promise<TokenResponse> {
  return tokenRequest(cfg, p.clientId, p.clientSecret, { grant_type: "refresh_token", refresh_token: p.refreshToken });
}

export function secretFromToken(t: TokenResponse, account?: Record<string, unknown>): IntegrationSecret {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : undefined,
    tokenType: t.token_type,
    scope: t.scope,
    account,
  };
}

export function tokenNeedsRefresh(s: IntegrationSecret, skewMs = 60_000): boolean {
  return Boolean(s.refreshToken && s.expiresAt && new Date(s.expiresAt).getTime() - skewMs < Date.now());
}

// ---------- Webhook verification ----------
function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verifyHmacSha256Hex(secret: string, payload: string | Buffer, signature: string, prefix = ""): boolean {
  const expected = prefix + createHmac("sha256", secret).update(payload).digest("hex");
  return safeEq(expected, signature);
}

export function verifyHmacSha256Base64(secret: string, payload: string | Buffer, signature: string, prefix = ""): boolean {
  const expected = prefix + createHmac("sha256", secret).update(payload).digest("base64");
  return safeEq(expected, signature);
}

/** Stripe-Signature: t=timestamp,v1=sig[,v1=sig] */
export function verifyStripeSignature(secret: string, payload: string, header: string, toleranceSec = 300, now = Date.now()): boolean {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2) as [string, string]).filter((x) => x.length === 2));
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return sigs.some((s) => safeEq(s, expected));
}

/** Svix (Resend etc.): headers svix-id, svix-timestamp, svix-signature ("v1,base64 ..."). Secret "whsec_<base64>". */
export function verifySvixSignature(secret: string, payload: string, headers: { id: string; timestamp: string; signature: string }, toleranceSec = 300, now = Date.now()): boolean {
  const ts = Number(headers.timestamp);
  if (!ts || Math.abs(now / 1000 - ts) > toleranceSec) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${payload}`).digest("base64");
  return headers.signature.split(" ").some((part) => {
    const [ver, sig] = part.split(",", 2);
    return ver === "v1" && sig !== undefined && safeEq(sig, expected);
  });
}

/** Slack: v0=HMAC(secret, "v0:timestamp:body") */
export function verifySlackSignature(secret: string, payload: string, timestamp: string, signature: string, toleranceSec = 300, now = Date.now()): boolean {
  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSec) return false;
  return verifyHmacSha256Hex(secret, `v0:${timestamp}:${payload}`, signature, "v0=");
}

/** Twilio: base64(HMAC-SHA1(authToken, url + sorted form params)) */
export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string): boolean {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  return safeEq(expected, signature);
}

// ---------- Small HTTP helper for provider clients ----------
export class IntegrationHttpError extends Error {
  constructor(public readonly provider: string, public readonly status: number, public readonly body: string, public readonly retryAfterMs?: number) {
    super(`${provider} HTTP ${status}: ${body.slice(0, 300)}`);
  }
  get needsReauth() {
    return this.status === 401;
  }
  get rateLimited() {
    return this.status === 429;
  }
}

export async function apiJson<T>(provider: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30_000);
  init.signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { accept: "application/json", ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...(init.headers as Record<string, string> | undefined) } });
    const text = await res.text();
    if (!res.ok) {
      const ra = res.headers.get("retry-after");
      throw new IntegrationHttpError(provider, res.status, text, ra ? Number(ra) * 1000 : undefined);
    }
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(t);
  }
}

/** Deterministic idempotency key for an external mutation. */
export function idempotencyKey(...parts: Array<string | number | undefined>): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 40);
}
