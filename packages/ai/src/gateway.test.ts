import { describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "@steward/schema";
import { AIGateway, type ResolvedCredential, type UsageRecord } from "./gateway.js";
import type { ChatRequest, ChatResponse, ProviderAdapter } from "./types.js";

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
    expect(records.slice(0, 2).every((record) => record.status === "ok")).toBe(true);

    const singleRoute = setup(new Map([["credential-1", [response({}), response({})]]])).gateway;
    await expect(singleRoute.chat(request(1_000), { policy })).rejects.toMatchObject({
      code: "invalid_request",
      message: "Model used its entire 4096-token output budget on reasoning and returned no answer",
    });
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
