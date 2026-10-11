import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition, ToolRegistry } from "@steward/tools";
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

  it("does not execute a later tool after an earlier tool aborts the run", async () => {
    const controller = new AbortController();
    const firstExecute: ToolDefinition["execute"] = vi.fn(async () => {
      controller.abort(new Error("Run cancelled"));
      await new Promise<never>(() => {});
      return { ok: true, content: "unreachable" };
    });
    const secondExecute: ToolDefinition["execute"] = vi.fn(async () => ({ ok: true, content: "second" }));
    const makeTool = (name: string, execute: ToolDefinition["execute"]): ToolDefinition => ({
      manifest: {
        name,
        description: name,
        inputSchema: {},
        scopes: [],
        risk: "LOW",
        idempotent: true,
        sideEffects: "none",
        timeoutMs: 1000,
        costCategory: "none",
        source: "first_party",
      },
      input: { safeParse: (data: unknown) => ({ success: true as const, data }) },
      execute,
    } as unknown as ToolDefinition);
    const tools = [makeTool("test.first", firstExecute), makeTool("test.second", secondExecute)];
    const registry = {
      list: vi.fn(() => tools),
      get: vi.fn((name: string) => tools.find((tool) => tool.manifest.name === name)),
    } as unknown as ToolRegistry;
    let stepCount = 0;
    const chat = vi.fn(async () => ({
      id: "response",
      model: "test-model",
      provider: "nvidia",
      text: "",
      toolCalls: [
        { id: "tool-call-1", name: "test.first", arguments: { value: "first" } },
        { id: "tool-call-2", name: "test.second", arguments: { value: "second" } },
      ],
      finishReason: "tool_calls" as const,
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const services = {
      scope: { organizationId: "org-1", companyId: "company-1", actor: { type: "system", component: "test" } },
      gateway: { chat },
      runs: {
        get: vi.fn(async () => ({ id: "run-1", agentId: "agent-1", status: "executing", costUsd: "0", plan: null })),
        steps: vi.fn(async () => []),
        setStatus: vi.fn(async () => undefined),
        beginStep: vi.fn(async () => ({ id: `step-${++stepCount}` })),
        finishStep: vi.fn(async () => undefined),
        recordToolCall: vi.fn(async () => undefined),
      },
      agents: { get: vi.fn(async () => ({ id: "agent-1", kind: "custom" })) },
      budgets: { assertAvailable: vi.fn(async () => undefined), charge: vi.fn(async () => undefined) },
    } as unknown as AgentServices;
    const runtime = new AgentRuntime(services, registry);
    Object.defineProperty(runtime, "policyFor", { value: async () => ({ decision: "allow", risk: "LOW", reason: "test" }) });
    const context = {
      systemPrompt: "system",
      userPrompt: "user",
      toolNames: ["test.first", "test.second"],
      routingPolicy: {},
      maxIterations: 2,
      budgetUsdPerRun: null,
    } as unknown as RunContextBundle;

    await expect(runtime.iterate("run-1", context, undefined, controller.signal)).rejects.toThrow("Run cancelled");

    expect(firstExecute).toHaveBeenCalledOnce();
    expect(secondExecute).not.toHaveBeenCalled();
    expect(services.runs.recordToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toolName: "test.first", status: "failed" }),
    );
  });
});
