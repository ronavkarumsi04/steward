#!/usr/bin/env node
/**
 * Local OpenAI-compatible stub AI provider.
 *
 * Lets the full stack (API + worker + agent runtime) run end-to-end with zero external AI
 * credentials: it implements the OpenAI wire protocol (/v1/models, /v1/chat/completions with
 * streaming, /v1/embeddings) and replies with deterministic content and 1536-dim embeddings.
 *
 * Usage:
 *   node scripts/stub-ai-provider.mjs [port]        # default port 4599
 *
 * Wire it up (org admin):
 *   POST /api/v1/orgs/:orgId/providers
 *   { "providerType": "openai", "label": "Local stub", "secret": "stub-local-key",
 *     "baseUrl": "http://127.0.0.1:4599/v1" }
 */
import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? process.env.STUB_AI_PORT ?? 4599);
const KEY = process.env.STUB_AI_KEY ?? "stub-local-key";
const EMBED_DIM = 1536;
const CHAT_MODEL = "steward-local-1";
const EMBED_MODEL = "text-embedding-3-small";

/** Deterministic bag-of-words embedding so identical text yields identical vectors. */
function embed(text) {
  const v = new Array(EMBED_DIM).fill(0);
  const words = String(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const w of words) {
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % EMBED_DIM] += 1 / Math.sqrt(w.length + 1);
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

function reply(content, model = CHAT_MODEL) {
  return {
    id: `chatcmpl-stub-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 64, completion_tokens: 32, total_tokens: 96 },
  };
}

/** Build a minimal object satisfying a JSON schema: required keys with type-appropriate empties. */
function minimalFromSchema(schema) {
  if (!schema || typeof schema !== "object") return {};
  if (schema.type === "object" || schema.required || schema.properties) {
    const out = {};
    for (const key of schema.required ?? []) {
      const prop = schema.properties?.[key] ?? {};
      out[key] = minimalFromSchema(prop);
    }
    return out;
  }
  switch (schema.type) {
    case "string": return "";
    case "boolean": return true;
    case "integer": case "number": return 0;
    case "array": return [];
    case "object": return {};
    default: return null;
  }
}

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const path = (req.url ?? "/").split("?")[0];
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (KEY && req.headers.authorization !== `Bearer ${KEY}`) {
      return json(401, { error: { message: "Invalid API key (expected the stub provider key)", type: "invalid_request_error" } });
    }

    if (path.endsWith("/models")) {
      return json(200, { object: "list", data: [CHAT_MODEL, "gpt-5", "gpt-5-nano", EMBED_MODEL].map((id) => ({ id, object: "model", owned_by: "steward-stub" })) });
    }

    if (path.endsWith("/chat/completions")) {
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      const model = String(body.model ?? CHAT_MODEL);
      const last = Array.isArray(body.messages) ? body.messages[body.messages.length - 1] : null;
      const rfRaw = body.response_format;
      const rf = rfRaw?.type === "json_schema" ? { type: "json_schema", name: rfRaw.json_schema?.name, schema: rfRaw.json_schema?.schema } : rfRaw?.type === "json_object" || rfRaw?.type === "json_schema" ? { type: "json_object" } : null;

      // Structured output: satisfy known agent-runtime schemas, else build a minimal valid object
      // from the schema (required keys with type-appropriate empty values).
      if (rf && (rf.type === "json_schema" || rf.type === "json_object")) {
        const name = rf.name ?? "";
        const lastUser = last && typeof last.content === "string" ? last.content.split("\n\nBefore acting")[0].slice(0, 160) : "the objective";
        if (name === "plan") {
          body._stubJson = {
            objective: lastUser,
            steps: [{ title: "Acknowledge the request and gather context", tools: [] }],
            successCriteria: ["A clear reply is recorded for the founder"],
            risks: [],
            needsHuman: [],
          };
        } else if (name === "verify") {
          body._stubJson = { passed: true, score: 90, summary: "Stub verification: the work completed without errors and the objective is addressed.", unmet: [], followUps: [] };
        } else {
          body._stubJson = minimalFromSchema(rf.schema ?? {});
        }
      }

      const content =
        body._stubJson
          ? JSON.stringify(body._stubJson)
          : `Stub reply: I received your message and processed it locally.${last && typeof last.content === "string" ? ` You said: "${last.content.slice(0, 140)}"` : ""}`;
      console.log(`[stub-ai] chat model=${model} stream=${Boolean(body.stream)} msgs=${Array.isArray(body.messages) ? body.messages.length : 0}${body._stubJson ? " structured" : ""}`);

      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        const id = `chatcmpl-stub-${Date.now().toString(36)}`;
        const chunk = (delta, finish = null) =>
          res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, finish_reason: finish, delta }] })}\n\n`);
        chunk({ role: "assistant" });
        for (const word of content.split(/(?<=\s)/)) chunk({ content: word });
        chunk({}, "stop");
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      return json(200, reply(content, model));
    }

    if (path.endsWith("/embeddings")) {
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      const inputs = Array.isArray(body.input) ? body.input : [String(body.input ?? "")];
      console.log(`[stub-ai] embeddings model=${body.model ?? EMBED_MODEL} inputs=${inputs.length}`);
      return json(200, {
        object: "list",
        model: body.model ?? EMBED_MODEL,
        data: inputs.map((text, i) => ({ object: "embedding", index: i, embedding: embed(text) })),
        usage: { prompt_tokens: inputs.length * 8, total_tokens: inputs.length * 8 },
      });
    }

    json(404, { error: { message: `Unknown path ${path}`, type: "invalid_request_error" } });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[stub-ai] OpenAI-compatible stub listening on http://127.0.0.1:${PORT}/v1 (key: ${KEY})`);
});
