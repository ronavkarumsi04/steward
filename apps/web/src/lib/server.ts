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

/** Like getMe, but public pages stay renderable when the API is unreachable (treated as signed out). */
export async function getMeOptional(): Promise<Me> {
  try {
    return await getMe();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.error("steward api unreachable", e);
    return { user: null, memberships: [] };
  }
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
