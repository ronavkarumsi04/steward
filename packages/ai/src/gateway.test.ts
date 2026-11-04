import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "@steward/schema";
import { AIGateway, type ResolvedCredential, type UsageRecord } from "./gateway.js";
import { ProviderError, type ChatRequest, type ChatResponse, type ProviderAdapter } from "./types.js";

const model: ModelInfo = {
  id: "test-model",
  provider: "openai",
  displayName: "Test model",
  tier: "standard",
  deprecated: false,
  local: false,
  capabilities: {
    contextWindow: 32_000,
    maxOutputTokens: 8_192,
    inputModalities: ["text"],
    outputModalities: ["text"],
    tools: false,
    structuredOutput: true,
    reasoning: true,
    streaming: true,
    vision: false,
  },
};

const policy = {
  explicit: { provider: "openai", model: model.id },
  fallbackChain: [],
  requirements: { preference: "balanced" as const },
};

const credential = (id: string, priority: number): ResolvedCredential => ({
  id,
  providerType: "openai",
  credential: { apiKey: "test" },
  priority,
  enabled: true,
});

const response = (overrides: Partial<ChatResponse>): ChatResponse => ({
  id: "response",
  model: model.id,
  provider: "openai",
  text: "",
  toolCalls: [],
  finishReason: "length",
  usage: { inputTokens: 10, outputTokens: 800, reasoningTokens: 800 },
  ...overrides,
});

function setup(
  responsesByCredential: Map<string, ChatResponse[]>,
  credentials = [credential("credential-1", 100)],
) {
  const records: UsageRecord[] = [];
  const adapters = new Map(
    credentials.map((c) => {
      const responses = responsesByCredential.get(c.id) ?? [];
      let responseIndex = 0;
      const chat = vi.fn(async (_request: ChatRequest) => {
        const result = responses[responseIndex++];
        if (!result) throw new Error(`No response configured for ${c.id}`);
        return result;
      });
      const adapter = {
        type: c.providerType,
        info: {} as ProviderAdapter["info"],
        listModels: vi.fn(async () => [model]),
        chat,
        async *stream() {},
        testConnection: vi.fn(),
      } as unknown as ProviderAdapter;
      return [c.id, { adapter, chat }];
    }),
  );
  const gateway = new AIGateway({
    loadCredentials: async () => credentials,
    recordUsage: async (record) => {
      records.push(record);
    },
    maxAttemptsPerRoute: 1,
  });
  vi.spyOn(gateway, "adapterFor").mockImplementation((c) => adapters.get(c.id)!.adapter);
  return { gateway, records, adapters };
}

const request = (maxTokens?: number): Omit<ChatRequest, "model"> => ({
  messages: [{ role: "user", content: "hello" }],
  ...(maxTokens === undefined ? {} : { maxTokens }),
});

describe("AIGateway reasoning-budget recovery", () => {
  it("retries reasoning-only length responses with a raised maxTokens and records both attempts", async () => {
    const { gateway, records, adapters } = setup(
      new Map([
        [
          "credential-1",
          [
            response({}),
            response({
              text: "recovered",
              finishReason: "stop",
              usage: { inputTokens: 12, outputTokens: 40, reasoningTokens: 8 },
            }),
          ],
        ],
      ]),
    );

    const result = await gateway.chat(request(1_000), { policy });
    const chat = adapters.get("credential-1")!.chat;

    expect(result.text).toBe("recovered");
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls.map(([req]) => req.maxTokens)).toEqual([1_000, 4_096]);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.usage.outputTokens)).toEqual([800, 40]);
    expect(records.map((record) => record.status)).toEqual(["ok", "ok"]);
    expect(records.map((record) => record.retries)).toEqual([0, 1]);
  });

  it("raises a clear non-retryable error after an empty retry and falls through to the next route", async () => {
    const { gateway, records, adapters } = setup(
      new Map([
        ["credential-1", [response({}), response({ usage: { inputTokens: 10, outputTokens: 4_096, reasoningTokens: 4_096 } })]],
        ["credential-2", [response({ text: "fallback", finishReason: "stop", usage: { inputTokens: 10, outputTokens: 12 } })]],
      ]),
      [credential("credential-1", 10), credential("credential-2", 20)],
    );

    const result = await gateway.chat(request(1_000), { policy });

    expect(result.text).toBe("fallback");
    expect(adapters.get("credential-1")!.chat).toHaveBeenCalledTimes(2);
    expect(adapters.get("credential-2")!.chat).toHaveBeenCalledOnce();
    expect(records).toHaveLength(3);
    expect(records.slice(0, 2).map((record) => record.status)).toEqual(["ok", "error"]);
    expect(records[1]).toMatchObject({
      errorCode: "invalid_request",
      usage: { inputTokens: 10, outputTokens: 4_096, reasoningTokens: 4_096 },
    });
    expect(records[2]?.status).toBe("ok");

    const singleRoute = setup(new Map([["credential-1", [response({}), response({})]]]));
    await expect(singleRoute.gateway.chat(request(1_000), { policy })).rejects.toMatchObject({
      code: "invalid_request",
      message: "Model used its entire 4096-token output budget on reasoning and returned no answer",
    });
    expect(singleRoute.records.map((record) => record.status)).toEqual(["ok", "error"]);
    expect(singleRoute.records[1]).toMatchObject({ errorCode: "invalid_request", usage: { outputTokens: 800 } });
  });

  it("preserves a content-filter result from the reasoning-budget retry", async () => {
    const { gateway, records, adapters } = setup(
      new Map([
        ["credential-1", [response({}), response({ finishReason: "content_filter", usage: { inputTokens: 12, outputTokens: 3 } })]],
        ["credential-2", [response({ text: "fallback", finishReason: "stop", usage: { inputTokens: 10, outputTokens: 12 } })]],
      ]),
      [credential("credential-1", 10), credential("credential-2", 20)],
    );

    const result = await gateway.chat(request(1_000), { policy });

    expect(result.text).toBe("fallback");
    expect(adapters.get("credential-1")!.chat).toHaveBeenCalledTimes(2);
    expect(adapters.get("credential-2")!.chat).toHaveBeenCalledOnce();
    expect(records[1]).toMatchObject({ status: "error", errorCode: "content_filter", usage: { outputTokens: 3 } });
  });

  it("does not retry when the model output cap cannot increase the requested budget", async () => {
    const { gateway, records, adapters } = setup(new Map([["credential-1", [response({})]]]));

    await expect(gateway.chat(request(9_000), { policy })).rejects.toMatchObject({
      code: "invalid_request",
      message: "Model used its entire 8192-token output budget on reasoning and returned no answer",
    });

    expect(adapters.get("credential-1")!.chat).toHaveBeenCalledOnce();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "error", errorCode: "invalid_request", usage: { outputTokens: 800 } });
  });

  it("does not retry a length response that contains text", async () => {
    const { gateway, records, adapters } = setup(
      new Map([
        [
          "credential-1",
          [response({ text: "partial answer", usage: { inputTokens: 10, outputTokens: 800, reasoningTokens: 800 } })],
        ],
      ]),
    );

    const result = await gateway.chat(request(1_000), { policy });

    expect(result.text).toBe("partial answer");
    expect(adapters.get("credential-1")!.chat).toHaveBeenCalledOnce();
    expect(records).toHaveLength(1);
  });

  it("does not retry a reasoning-only response when maxTokens was not requested", async () => {
    const { gateway, records, adapters } = setup(new Map([["credential-1", [response({})]]]));

    const result = await gateway.chat(request(), { policy });

    expect(result.text).toBe("");
    expect(adapters.get("credential-1")!.chat).toHaveBeenCalledOnce();
    expect(adapters.get("credential-1")!.chat.mock.calls[0]?.[0].maxTokens).toBeUndefined();
    expect(records).toHaveLength(1);
  });
});


describe("AIGateway caller deadlines", () => {
  // A provider that never answers: it only ends when the attempt's own signal aborts, the way a real fetch does.
  const hangingAdapter = (type: string) => {
    const chat = vi.fn(
      (request: ChatRequest) =>
        new Promise<ChatResponse>((_, reject) => {
          request.signal?.addEventListener("abort", () => reject(new ProviderError("timeout", `Request to ${type} timed out`, type, true)), { once: true });
        }),
    );
    return { adapter: { type, info: {} as ProviderAdapter["info"], listModels: vi.fn(async () => [model]), chat, async *stream() {}, testConnection: vi.fn() } as unknown as ProviderAdapter, chat };
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up on a provider that stays silent and fails over to the next route inside the budget", async () => {
    vi.useFakeTimers();
    const first = credential("silent", 10);
    const second = credential("answers", 50);
    const records: UsageRecord[] = [];
    const gateway = new AIGateway({ loadCredentials: async () => [first, second], recordUsage: async (r) => void records.push(r), maxAttemptsPerRoute: 2 });
    const silent = hangingAdapter(first.providerType);
    const answering = {
      adapter: { type: second.providerType, info: {} as ProviderAdapter["info"], listModels: vi.fn(async () => [model]), chat: vi.fn(async () => response({ text: "hello", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 5 } })), async *stream() {}, testConnection: vi.fn() } as unknown as ProviderAdapter,
    };
    vi.spyOn(gateway, "adapterFor").mockImplementation((c) => (c.id === first.id ? silent.adapter : answering.adapter));

    const pending = gateway.chat({ ...request(), deadline: Date.now() + 60_000 }, { policy });
    await vi.advanceTimersByTimeAsync(56_000);
    const result = await pending;

    expect(result.text).toBe("hello");
    expect(result.route.credentialId).toBe(second.id);
    // One attempt, not two: a second silence from the same provider would have ended the budget with no answer.
    expect(silent.chat).toHaveBeenCalledTimes(1);
    // The silent route got its share of the budget (half of 55s), not all of it, so the fallback still had time.
    expect(records.find((r) => r.credentialId === first.id)?.latencyMs).toBeGreaterThanOrEqual(27_000);
    expect(records.find((r) => r.credentialId === first.id)?.latencyMs).toBeLessThan(30_000);
    expect(records.find((r) => r.credentialId === first.id)).toMatchObject({ status: "error", errorCode: "timeout" });
  });

  it("does not start an attempt the remaining budget cannot hold", async () => {
    const cred = credential("credential-1", 100);
    const gateway = new AIGateway({ loadCredentials: async () => [cred], recordUsage: async () => {}, maxAttemptsPerRoute: 2 });
    const silent = hangingAdapter(cred.providerType);
    vi.spyOn(gateway, "adapterFor").mockImplementation(() => silent.adapter);

    await expect(gateway.chat({ ...request(), deadline: Date.now() + 8_000 }, { policy })).rejects.toMatchObject({ code: "timeout", retryable: true, message: expect.stringContaining("not enough") });
    expect(silent.chat).not.toHaveBeenCalled();
  });

  it("leaves attempts alone when the caller set no deadline", async () => {
    const cred = credential("credential-1", 100);
    const gateway = new AIGateway({ loadCredentials: async () => [cred], recordUsage: async () => {}, maxAttemptsPerRoute: 1 });
    const chat = vi.fn(async (req: ChatRequest) => {
      expect(req.signal).toBeUndefined();
      return response({ text: "ok", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } });
    });
    vi.spyOn(gateway, "adapterFor").mockImplementation(() => ({ type: cred.providerType, info: {} as ProviderAdapter["info"], listModels: vi.fn(async () => [model]), chat, async *stream() {}, testConnection: vi.fn() } as unknown as ProviderAdapter));
    expect((await gateway.chat(request(), { policy })).text).toBe("ok");
  });
});
