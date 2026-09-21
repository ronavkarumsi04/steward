import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, createClient, type ApiClient } from "./api";
import type { Me } from "./types";

export const API_URL = (process.env.API_INTERNAL_URL ?? process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

/** API client bound to the current request's session cookie. */
export async function serverApi(): Promise<ApiClient> {
  const jar = await cookies();
  const cookie = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  return createClient({ baseUrl: `${API_URL}/v1`, cookie });
}

export async function getMe(): Promise<Me> {
  const api = await serverApi();
  return api.get<Me>("/auth/me");
}

/**
 * Runs an API call, substituting `fallback` only when the API itself is unreachable (network error).
 * `cookies()` is read before the try so Next's dynamic-rendering bailout is never swallowed.
 */
async function withFallback<T>(what: string, fn: (api: ApiClient) => Promise<T>, fallback: T): Promise<T> {
  const api = await serverApi();
  try {
    return await fn(api);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.error(`steward ${what} unavailable`, e instanceof Error ? e.message : e);
    return fallback;
  }
}

/** Like getMe, but public pages stay renderable when the API is unreachable (treated as signed out). */
export function getMeOptional(): Promise<Me> {
  return withFallback("api", (api) => api.get<Me>("/auth/me"), { user: null, memberships: [] });
}

export interface AuthConfig {
  signupOpen: boolean;
  inviteOnly: boolean;
}

/** Public sign-up policy; assumes open when the API is unreachable so the page still renders. */
export function getAuthConfig(): Promise<AuthConfig> {
  return withFallback("auth config", (api) => api.get<AuthConfig>("/auth/config"), { signupOpen: true, inviteOnly: false });
}

export interface InvitationPreview {
  email: string;
  role: string;
  organizationName: string;
  expiresAt: string;
}

/** Public preview of a pending invitation; null when invalid or expired. */
export async function peekInvitation(token: string): Promise<InvitationPreview | null> {
  const api = await serverApi();
  return tryApi(async () => (await api.get<{ invitation: InvitationPreview }>(`/invitations/${encodeURIComponent(token)}`)).invitation);
}

/** Loads the current user or redirects to /login (preserving the destination). */
export async function requireMe(next?: string): Promise<Me & { user: NonNullable<Me["user"]> }> {
  const me = await getMe();
  if (!me.user) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return me as Me & { user: NonNullable<Me["user"]> };
}

/** Wraps a server-side API call, mapping 404 to Next's notFound-style redirect target. */
export async function tryApi<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
}
