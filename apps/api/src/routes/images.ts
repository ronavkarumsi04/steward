import type { Hono } from "hono";
import { z } from "zod";
import { IMAGE_ASPECTS, generateImage } from "@steward/ai";
import { IMAGE_PURPOSES } from "@steward/core";
import { HttpError, companyScope, param, type AppEnv, type Ctx } from "../context.js";
import { defineRoute, type RouteRegistry } from "../route.js";

/**
 * The pictures a company keeps. A list for the gallery, the bytes for an <img>, and a way for the founder to ask
 * for one directly (a logo candidate, a post image) with the company's own NVIDIA credential, outside any run.
 */
export function registerImageRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/images", tag: "images", summary: "The pictures this company keeps, newest first", query: z.object({ purpose: z.enum(IMAGE_PURPOSES).optional() }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ images: await c.get("deps").services.images.list(scope, { purpose: query.purpose }) });
  });

  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/images/:imageId", tag: "images", summary: "One picture, as an image" }, async (c) => imageResponse(c, param(c, "companyId"), param(c, "imageId")));

  defineRoute(
    app,
    reg,
    {
      method: "post",
      path: "/companies/:companyId/images",
      tag: "images",
      summary: "Make a picture from a prompt with the company's NVIDIA credential",
      body: z.object({ prompt: z.string().trim().min(8).max(1000), purpose: z.enum(IMAGE_PURPOSES).default("picture"), aspect: z.enum(IMAGE_ASPECTS).default("square"), seed: z.number().int().min(0).max(2147483647).optional() }),
    },
    async (c, { body }) => {
      const scope = await companyScope(c, param(c, "companyId"), "member");
      const services = c.get("deps").services;
      const cred = (await services.providers.resolveForGateway(scope)).filter((r) => r.providerType === "nvidia" && r.credential.apiKey).sort((a, b) => a.priority - b.priority)[0];
      if (!cred) throw new HttpError(409, "no_image_provider", "Add an NVIDIA credential under Settings → Providers to make pictures.");
      let generated;
      try {
        generated = await generateImage(cred.credential, { prompt: body.prompt, aspect: body.aspect, seed: body.seed }, { timeoutMs: 90_000 });
      } catch (e) {
        throw new HttpError(502, "image_failed", `The image model did not return a picture: ${e instanceof Error ? e.message : String(e)}`);
      }
      const image = await services.images.create(scope, { purpose: body.purpose, prompt: body.prompt, model: generated.model, seed: generated.seed, mimeType: generated.mimeType, width: generated.width, height: generated.height, data: generated.data });
      return c.json({ image }, 201);
    },
  );
}

async function imageResponse(c: Ctx, companyId: string, imageId: string) {
  const scope = await companyScope(c, companyId);
  const found = await c.get("deps").services.images.bytes(scope, imageId);
  if (!found) throw new HttpError(404, "not_found", "That picture does not exist");
  // Model output is somebody else's bytes: never let a browser treat one as a document in this origin.
  return c.body(new Uint8Array(found.data), 200, {
    "content-type": found.image.mimeType,
    "content-length": String(found.data.byteLength),
    "cache-control": "private, max-age=3600",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
  });
}
