import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexCompanionAdapter } from "./adapters/codex-companion.js";
import { AnthropicAdapter, toAnthropicMessages } from "./adapters/anthropic.js";
import { OpenAICompatibleAdapter, toOpenAIMessages } from "./adapters/openai-compatible.js";
import { sanitizeSchema, toGeminiContents } from "./adapters/gemini.js";
import { normalizeHttpError } from "./http.js";
import { extractJson } from "./structured.js";
import type { ChatMessage } from "./types.js";

const convo: ChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "hi" },
  { role: "assistant", content: [{ type: "text", text: "" }, { type: "tool_call", id: "t1", name: "lookup", arguments: { q: 1 } }] },
  { role: "tool", content: [{ type: "tool_result", toolCallId: "t1", content: "{\"ok\":true}" }] },
];

describe("message conversion", () => {
  it("openai", () => {
    const m = toOpenAIMessages(convo);
    expect(m[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "t1", function: { name: "lookup" } }] });
    expect(m[3]).toMatchObject({ role: "tool", tool_call_id: "t1" });
  });
  it("anthropic merges system and alternates roles", () => {
    const { system, messages } = toAnthropicMessages(convo);
    expect(system).toBe("sys");
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
  it("gemini", () => {
    const { systemInstruction, contents } = toGeminiContents(convo);
    expect(systemInstruction?.parts[0]).toEqual({ text: "sys" });
    expect(contents[1]!.role).toBe("model");
    expect(sanitizeSchema({ type: "object", additionalProperties: false, properties: { a: { type: "string", default: "x" } } })).toEqual({ type: "object", properties: { a: { type: "string" } } });
  });
});

describe("error normalization", () => {
  it("maps statuses", () => {
    expect(normalizeHttpError("openai", 401, "{}").code).toBe("auth");
    expect(normalizeHttpError("openai", 429, JSON.stringify({ error: { message: "Rate limit" } }), "2")).toMatchObject({ code: "rate_limit", retryable: true, retryAfterMs: 2000 });
    expect(normalizeHttpError("openai", 429, JSON.stringify({ error: { message: "You exceeded your current quota" } })).code).toBe("quota");
    expect(normalizeHttpError("openai", 500, "boom").retryable).toBe(true);
    expect(normalizeHttpError("openai", 400, JSON.stringify({ error: { message: "This model's maximum context length is 8192 tokens" } })).code).toBe("context_length");
  });
});

describe("extractJson", () => {
  it("handles fences and prose", () => {
    expect(extractJson("Here:\n```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    expect(extractJson("Sure! {\"a\":[1,2]} done")).toEqual({ a: [1, 2] });
  });
});

describe("adapters over mocked fetch", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("openai-compatible chat parses tool calls & usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "x", model: "gpt-5", choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "c1", function: { name: "f", arguments: "{\"a\":1}" } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } } }), { status: 200 })));
    const a = new OpenAICompatibleAdapter({ apiKey: "k" }, "openai");
    const r = await a.chat({ model: "gpt-5", messages: [{ role: "user", content: "hi" }], tools: [{ name: "f", description: "", parameters: { type: "object" } }] });
    expect(r.toolCalls).toEqual([{ id: "c1", name: "f", arguments: { a: 1 } }]);
    expect(r.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, cachedTokens: 4 });
  });
  it("openai-compatible streaming assembles text and tool calls", async () => {
    const chunks = [
      { id: "s", choices: [{ delta: { content: "Hel" } }] },
      { id: "s", choices: [{ delta: { content: "lo" } }] },
      { id: "s", choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "{\"a\"" } }] } }] },
      { id: "s", choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] }, finish_reason: "tool_calls" }] },
      { id: "s", choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
    ];
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })));
    const a = new OpenAICompatibleAdapter({ apiKey: "k" }, "groq");
    const events = [];
    for await (const ev of a.stream({ model: "m", messages: [{ role: "user", content: "hi" }] })) events.push(ev);
    const done = events.find((e) => e.type === "done");
    expect(done && done.type === "done" && done.response.text).toBe("Hello");
    expect(done && done.type === "done" && done.response.toolCalls).toEqual([{ id: "c1", name: "f", arguments: { a: 1 } }]);
    expect(done && done.type === "done" && done.response.usage.inputTokens).toBe(3);
  });
  it("anthropic structured output via forced tool", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.tool_choice).toEqual({ type: "tool", name: "__structured_output" });
      return new Response(JSON.stringify({ id: "m", model: "claude", content: [{ type: "tool_use", id: "t", name: "__structured_output", input: { ok: true } }], stop_reason: "tool_use", usage: { input_tokens: 5, output_tokens: 2 } }), { status: 200 });
    }));
    const a = new AnthropicAdapter({ apiKey: "k" });
    const r = await a.chat({ model: "claude", messages: [{ role: "user", content: "x" }], responseFormat: { type: "json_schema", name: "S", schema: { type: "object" } } });
    expect(JSON.parse(r.text)).toEqual({ ok: true });
  });
});

describe("Overclock top-p transport", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("preserves the zero-temperature and top-p wire values for OpenAI-compatible backends", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} }));
    }));
    const adapter = new OpenAICompatibleAdapter({ apiKey: "k", baseUrl: "https://provider.test/v1" }, "openai_compatible");
    await adapter.chat({ model: "custom", messages: [{ role: "user", content: "hi" }], topP: 0.63, maxTokens: 512 });
    await adapter.chat({ model: "custom", messages: [{ role: "user", content: "hi" }], temperature: 0 });
    expect(bodies[0]).toMatchObject({ top_p: 0.63, max_completion_tokens: 512 });
    expect(bodies[0]!.temperature).toBeUndefined();
    expect(bodies[1]!.temperature).toBe(0);
  });
  it("Anthropic maps top-p and rejects incompatible sampling instead of dropping it", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "x", content: [{ type: "text", text: "ok" }], usage: {} }));
    }));
    const adapter = new AnthropicAdapter({ apiKey: "k" });
    const req = { model: "claude-test", messages: [{ role: "user" as const, content: "hi" }], topP: 0.7 };
    await adapter.chat(req);
    expect(bodies[0]!.top_p).toBe(0.7);
    await expect(adapter.chat({ ...req, temperature: 0.3 })).rejects.toMatchObject({ code: "unsupported" });
    await expect(adapter.chat({ ...req, reasoning: { effort: "low" } })).rejects.toMatchObject({ code: "unsupported" });
    await expect(adapter.chat({ model: "claude-test", messages: [], temperature: 0.2, maxTokens: 8000, reasoning: { effort: "low" }, metadata: { steward_overclock: "required" } })).rejects.toMatchObject({ code: "unsupported" });
    await expect(adapter.chat({ model: "claude-test", messages: [], maxTokens: 512, reasoning: { effort: "low" }, metadata: { steward_overclock: "required" } })).rejects.toMatchObject({ code: "unsupported" });
    expect(bodies).toHaveLength(1);
  });
  it("Companion refuses required Overclock tuning before dispatch and preserves legacy defaults", async () => {
    const request = vi.fn(async () => ({ text: "ok" }));
    const adapter = new CodexCompanionAdapter({ config: { deviceId: "test-device" } }, { request });
    const req = { model: "codex", messages: [], temperature: 0.2, maxTokens: 1500 };
    await expect(adapter.chat({ ...req, metadata: { steward_overclock: "required" } })).rejects.toMatchObject({ code: "unsupported" });
    expect(request).not.toHaveBeenCalled();
    expect((await adapter.chat(req)).text).toBe("ok");
    expect(request).toHaveBeenCalledOnce();
  });
  it("OpenAI reasoning models report unsupported custom top-p before making a request", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const adapter = new OpenAICompatibleAdapter({ apiKey: "k" }, "openai");
    await expect(adapter.chat({ model: "o3", messages: [], topP: 0.5 })).rejects.toMatchObject({ code: "unsupported" });
    expect(f).not.toHaveBeenCalled();
  });
});
