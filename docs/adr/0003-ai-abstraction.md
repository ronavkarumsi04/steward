# ADR-0003: Provider-neutral AI gateway with native adapters

Status: Accepted

## Decision
Build `@steward/ai` with a ProviderAdapter interface and a normalized ChatRequest/ChatEvent model. One configurable OpenAI-compatible adapter covers most vendors; native adapters for Anthropic Messages, Gemini/Vertex, Bedrock Converse, Cohere v2. Routing is policy-driven (explicit → override → requirements → cost/latency → fallback chain). All calls are logged in ai_calls with tokens, cost estimate, latency, retries, routing reason.

## Alternatives
Vercel AI SDK / LiteLLM as the only layer: rejected as a hard dependency for control over usage accounting, error normalization, and companion-based providers; they remain usable as endpoints (LiteLLM proxy is a supported provider).
