import type { Hono } from "hono";
import { z } from "zod";
import { HttpError, type AppEnv, type Ctx } from "./context.js";

type Method = "get" | "post" | "put" | "patch" | "delete";

export interface RouteSpec<B extends z.ZodTypeAny | undefined, Q extends z.ZodTypeAny | undefined> {
  method: Method;
  path: string;
  summary: string;
  tag: string;
  body?: B;
  query?: Q;
  response?: z.ZodTypeAny;
  /** `public` routes skip the auth requirement; default requires a session. */
  auth?: "public" | "session";
  description?: string;
}

interface RegisteredRoute {
  spec: RouteSpec<z.ZodTypeAny | undefined, z.ZodTypeAny | undefined>;
}

export class RouteRegistry {
  readonly routes: RegisteredRoute[] = [];
}

type Infer<T> = T extends z.ZodTypeAny ? z.infer<T> : undefined;

export interface Parsed<B, Q> {
  body: B;
  query: Q;
}

export function defineRoute<B extends z.ZodTypeAny | undefined = undefined, Q extends z.ZodTypeAny | undefined = undefined>(
  app: Hono<AppEnv>,
  registry: RouteRegistry,
  spec: RouteSpec<B, Q>,
  handler: (c: Ctx, input: Parsed<Infer<B>, Infer<Q>>) => Promise<Response> | Response,
) {
  registry.routes.push({ spec });
  app[spec.method](spec.path, async (c) => {
    if (spec.auth !== "public" && !c.get("user")) throw new HttpError(401, "unauthenticated", "Sign in required");
    let body: unknown = undefined;
    if (spec.body) {
      const raw = await c.req.json().catch(() => undefined);
      const r = spec.body.safeParse(raw ?? {});
      if (!r.success) throw new HttpError(422, "invalid_body", "Request body failed validation", z.treeifyError(r.error));
      body = r.data;
    }
    let query: unknown = undefined;
    if (spec.query) {
      const r = spec.query.safeParse(c.req.query());
      if (!r.success) throw new HttpError(422, "invalid_query", "Query failed validation", z.treeifyError(r.error));
      query = r.data;
    }
    return handler(c, { body: body as Infer<B>, query: query as Infer<Q> });
  });
}

export function openApiDocument(registry: RouteRegistry, info: { title: string; version: string; serverUrl: string }) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const { spec } of registry.routes) {
    const oaPath = spec.path.replace(/:([A-Za-z_]+)/g, "{$1}");
    const params = [...spec.path.matchAll(/:([A-Za-z_]+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    const queryParams = spec.query ? queryToParams(spec.query) : [];
    const op: Record<string, unknown> = {
      summary: spec.summary,
      description: spec.description,
      tags: [spec.tag],
      parameters: [...params, ...queryParams],
      security: spec.auth === "public" ? [] : [{ cookieAuth: [] }, { bearerAuth: [] }],
      responses: {
        "200": { description: "OK", content: spec.response ? { "application/json": { schema: toJson(spec.response) } } : undefined },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden" },
        "404": { description: "Not found" },
        "422": { description: "Validation error" },
      },
    };
    if (spec.body) op.requestBody = { required: true, content: { "application/json": { schema: toJson(spec.body) } } };
    (paths[oaPath] ??= {})[spec.method] = op;
  }
  return {
    openapi: "3.1.0",
    info: { title: info.title, version: info.version, description: "Steward autonomous company operating system API. Cookie sessions for the web app; bearer session tokens for automation." },
    servers: [{ url: info.serverUrl }],
    components: {
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: "steward_session" },
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
    paths,
  };
}

function toJson(schema: z.ZodTypeAny) {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "input", unrepresentable: "any" });
}

function queryToParams(schema: z.ZodTypeAny) {
  const json = toJson(schema) as { properties?: Record<string, unknown>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, s]) => ({ name, in: "query", required: json.required?.includes(name) ?? false, schema: s }));
}
