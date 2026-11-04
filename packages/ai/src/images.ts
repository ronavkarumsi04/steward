import { ProviderError, type ProviderCredential } from "./types.js";
import { doFetch } from "./http.js";

/** The one image model Steward qualifies today: NVIDIA's hosted FLUX.1 [schnell], four steps, no guidance. */
export const IMAGE_MODEL = "black-forest-labs/flux.1-schnell";
const IMAGE_URL = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell";

/** FLUX accepts side lengths of 768–1344 in steps of 64; these are the three shapes a company actually asks for. */
export const IMAGE_ASPECTS = ["square", "wide", "tall"] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];
export const IMAGE_SIZES: Record<ImageAspect, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  wide: { width: 1344, height: 768 },
  tall: { width: 768, height: 1344 },
};

export interface GeneratedImage {
  data: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  model: string;
  seed: number;
  latencyMs: number;
}

/** PNG, JPEG or WebP from the first bytes; anything else is refused rather than stored under a guessed type. */
export function sniffImageMime(b: Buffer): GeneratedImage["mimeType"] | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** The base64 image in a NIM image reply, whichever of the three field layouts the endpoint uses. */
export function pickImageBase64(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const artifacts = o.artifacts;
  if (Array.isArray(artifacts) && artifacts[0] && typeof artifacts[0] === "object") {
    const b64 = (artifacts[0] as Record<string, unknown>).base64;
    if (typeof b64 === "string" && b64) return b64;
  }
  for (const key of ["image", "b64_json"]) if (typeof o[key] === "string" && o[key]) return o[key] as string;
  const data = o.data;
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    const b64 = (data[0] as Record<string, unknown>).b64_json;
    if (typeof b64 === "string" && b64) return b64;
  }
  return null;
}

/**
 * One picture from one prompt. The caller holds the credential; nothing here reads the database. A silent
 * backend is a `timeout` ProviderError, like a silent chat model, so the same budget logic applies.
 */
export async function generateImage(
  cred: ProviderCredential,
  input: { prompt: string; aspect?: ImageAspect; seed?: number },
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<GeneratedImage> {
  if (!cred.apiKey) throw new ProviderError("auth", "NVIDIA credential has no API key", "nvidia", false);
  const size = IMAGE_SIZES[input.aspect ?? "square"];
  const seed = input.seed ?? Math.floor(Math.random() * 2 ** 31);
  const started = Date.now();
  const originalFetch = globalThis.fetch;
  if (opts.fetchImpl) globalThis.fetch = opts.fetchImpl;
  let res: Response;
  try {
    res = await doFetch("nvidia", IMAGE_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${cred.apiKey}`, "content-type": "application/json", accept: "application/json", ...(cred.headers ?? {}) },
      body: JSON.stringify({ prompt: input.prompt, width: size.width, height: size.height, steps: 4, seed, cfg_scale: 0 }),
      timeoutMs: opts.timeoutMs ?? 90_000,
      signal: opts.signal,
    });
  } finally {
    if (opts.fetchImpl) globalThis.fetch = originalFetch;
  }
  const b64 = pickImageBase64(await res.json().catch(() => null));
  if (!b64) throw new ProviderError("unknown", "NVIDIA returned no image", "nvidia", true);
  const data = Buffer.from(b64, "base64");
  const mimeType = sniffImageMime(data);
  if (!mimeType) throw new ProviderError("unknown", "NVIDIA returned bytes that are not an image", "nvidia", true);
  return { data, mimeType, width: size.width, height: size.height, model: IMAGE_MODEL, seed, latencyMs: Date.now() - started };
}
