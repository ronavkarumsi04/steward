import { describe, expect, it, vi } from "vitest";
import { AgentRuntime, type RunContextBundle } from "./runtime.js";
import type { AgentServices } from "./services.js";

describe("AgentRuntime cancellation", () => {
  it("passes the plan cancellation signal to the gateway request", async () => {
    const signal = new AbortController().signal;
    const chat = vi.fn(async (_request: { signal?: AbortSignal }, _options: unknown) => ({
      id: "response",
      model: "test-model",
      provider: "nvidia",
      text: JSON.stringify({ objective: "test", steps: [] }),
      toolCalls: [],
      finishReason: "stop" as const,
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const services = {
      scope: { organizationId: "org-1", companyId: "company-1", actor: { type: "system", component: "test" } },
      gateway: { chat },
      runs: {
        get: vi.fn(async () => ({ id: "run-1", agentId: "agent-1", plan: null, intent: "test" })),
        setStatus: vi.fn(async () => undefined),
        beginStep: vi.fn(async () => ({ id: "step-1" })),
        finishStep: vi.fn(async () => undefined),
      },
      agents: { get: vi.fn(async () => ({ id: "agent-1", kind: "custom" })) },
    } as unknown as AgentServices;
    const runtime = new AgentRuntime(services, {} as never);
    const context = {
      systemPrompt: "system",
      userPrompt: "user",
      toolNames: [],
      routingPolicy: {},
      maxIterations: 1,
      budgetUsdPerRun: null,
    } as unknown as RunContextBundle;

    await runtime.plan("run-1", context, signal);

    expect(chat).toHaveBeenCalledOnce();
    expect(chat.mock.calls[0]?.[0].signal).toBe(signal);
  });
});
