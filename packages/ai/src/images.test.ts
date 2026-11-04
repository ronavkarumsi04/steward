import { describe, expect, it } from "vitest";
import { generateImage, pickImageBase64, sniffImageMime } from "./images.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("generateImage", () => {
  it("reads the picture from whichever field layout the NIM uses", () => {
    expect(pickImageBase64({ artifacts: [{ base64: "aa", finishReason: "SUCCESS" }] })).toBe("aa");
    expect(pickImageBase64({ image: "bb" })).toBe("bb");
    expect(pickImageBase64({ data: [{ b64_json: "cc" }] })).toBe("cc");
    expect(pickImageBase64({ error: "x" })).toBeNull();
  });

  it("recognises PNG, JPEG and WebP and refuses anything else", () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMime(Buffer.from("RIFF0000WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageMime(Buffer.from("<html>"))).toBeNull();
  });

  it("posts a FLUX-shaped request and returns typed bytes", async () => {
    let sent: { url: string; body: Record<string, unknown>; auth: string | null } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      sent = { url: String(url), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") };
      return new Response(JSON.stringify({ artifacts: [{ base64: PNG.toString("base64") }] }), { status: 200 });
    }) as typeof fetch;
    const img = await generateImage({ apiKey: "nvapi-x" }, { prompt: "a blue square", aspect: "wide", seed: 7 }, { fetchImpl });
    expect(sent!.url).toContain("flux.1-schnell");
    expect(sent!.auth).toBe("Bearer nvapi-x");
    expect(sent!.body).toMatchObject({ prompt: "a blue square", width: 1344, height: 768, steps: 4, seed: 7 });
    expect(img.mimeType).toBe("image/png");
    expect(img.width).toBe(1344);
    expect(img.data.equals(PNG)).toBe(true);
  });

  it("refuses a reply with no image instead of storing nothing", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
    await expect(generateImage({ apiKey: "k" }, { prompt: "x" }, { fetchImpl })).rejects.toThrow(/no image/);
  });
});
