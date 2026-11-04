import type { ModelInfo, ProviderTypeInfo, QualityTier } from "@steward/schema";

/**
 * Static provider type registry. Adding an OpenAI-compatible vendor is a data change.
 * Pricing/capability seeds are best-effort and flagged `estimated`; live model lists override availability.
 */
export const PROVIDER_TYPES: ProviderTypeInfo[] = [
  { type: "openai", displayName: "OpenAI", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "https://api.openai.com/v1", local: false, docsUrl: "https://platform.openai.com/docs" },
  { type: "azure_openai", displayName: "Azure OpenAI", protocol: "openai_compatible", authMethod: "azure_api_key", local: false, docsUrl: "https://learn.microsoft.com/azure/ai-services/openai/" },
  { type: "anthropic", displayName: "Anthropic", protocol: "anthropic", authMethod: "api_key", defaultBaseUrl: "https://api.anthropic.com", local: false, docsUrl: "https://docs.anthropic.com", subscriptionNote: "Anthropic requires API-key authentication for third-party products; Claude.ai subscriptions cannot be used here." },
  { type: "gemini", displayName: "Google Gemini (AI Studio)", protocol: "gemini", authMethod: "api_key", defaultBaseUrl: "https://generativelanguage.googleapis.com", local: false, docsUrl: "https://ai.google.dev/gemini-api/docs" },
  { type: "vertex", displayName: "Google Vertex AI", protocol: "vertex", authMethod: "gcp_service_account", local: false, docsUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs" },
  { type: "bedrock", displayName: "AWS Bedrock", protocol: "bedrock", authMethod: "aws_sigv4", local: false, docsUrl: "https://docs.aws.amazon.com/bedrock/" },
  { type: "xai", displayName: "xAI", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "https://api.x.ai/v1", local: false, docsUrl: "https://docs.x.ai" },
  { type: "mistral", displayName: "Mistral", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "https://api.mistral.ai/v1", local: false, docsUrl: "https://docs.mistral.ai" },
  { type: "cohere", displayName: "Cohere", protocol: "cohere", authMethod: "api_key", defaultBaseUrl: "https://api.cohere.com", local: false, docsUrl: "https://docs.cohere.com" },
  { type: "deepseek", displayName: "DeepSeek", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "https://api.deepseek.com", local: false, docsUrl: "https://api-docs.deepseek.com" },
  { type: "groq", displayName: "Groq", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "https://api.groq.com/openai/v1", local: false, docsUrl: "https://console.groq.com/docs" },
  { type: "cerebras", displayName: "Cerebras", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "https://api.cerebras.ai/v1", local: false, docsUrl: "https://inference-docs.cerebras.ai" },
  { type: "together", displayName: "Together AI", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "https://api.together.xyz/v1", local: false, docsUrl: "https://docs.together.ai" },
  { type: "fireworks", displayName: "Fireworks AI", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "https://api.fireworks.ai/inference/v1", local: false, docsUrl: "https://docs.fireworks.ai" },
  { type: "openrouter", displayName: "OpenRouter", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "https://openrouter.ai/api/v1", local: false, docsUrl: "https://openrouter.ai/docs" },
  { type: "perplexity", displayName: "Perplexity", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "https://api.perplexity.ai", local: false, docsUrl: "https://docs.perplexity.ai" },
  { type: "cloudflare", displayName: "Cloudflare Workers AI", protocol: "openai_compatible", authMethod: "api_key", local: false, docsUrl: "https://developers.cloudflare.com/workers-ai/" },
  { type: "nvidia", displayName: "NVIDIA NIM", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "https://integrate.api.nvidia.com/v1", local: false, docsUrl: "https://docs.api.nvidia.com" },
  { type: "sambanova", displayName: "SambaNova", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "https://api.sambanova.ai/v1", local: false, docsUrl: "https://docs.sambanova.ai" },
  { type: "huggingface", displayName: "Hugging Face Inference", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "https://router.huggingface.co/v1", local: false, docsUrl: "https://huggingface.co/docs/inference-providers" },
  { type: "ollama", displayName: "Ollama", protocol: "ollama", authMethod: "none", defaultBaseUrl: "http://localhost:11434", local: true, docsUrl: "https://github.com/ollama/ollama/blob/main/docs/api.md" },
  { type: "lmstudio", displayName: "LM Studio", protocol: "openai_compatible", authMethod: "none", defaultBaseUrl: "http://localhost:1234/v1", local: true, docsUrl: "https://lmstudio.ai/docs" },
  { type: "vllm", displayName: "vLLM", protocol: "openai_compatible", authMethod: "none", defaultBaseUrl: "http://localhost:8000/v1", local: true, docsUrl: "https://docs.vllm.ai" },
  { type: "llamacpp", displayName: "llama.cpp server", protocol: "openai_compatible", authMethod: "none", defaultBaseUrl: "http://localhost:8080/v1", local: true, docsUrl: "https://github.com/ggml-org/llama.cpp/tree/master/tools/server" },
  { type: "litellm", displayName: "LiteLLM proxy", protocol: "openai_compatible", authMethod: "api_key", defaultBaseUrl: "http://localhost:4000/v1", local: true, docsUrl: "https://docs.litellm.ai" },
  { type: "openai_compatible", displayName: "Generic OpenAI-compatible", protocol: "openai_compatible", authMethod: "api_key", local: false },
  { type: "codex_companion", displayName: "OpenAI Codex (ChatGPT subscription via Local Companion)", protocol: "companion_codex", authMethod: "companion", local: false, docsUrl: "https://developers.openai.com/codex/auth", subscriptionNote: "Runs the official Codex CLI on your own machine with your ChatGPT login. Credentials never leave your device." },
];

export const providerTypeMap = new Map(PROVIDER_TYPES.map((p) => [p.type, p]));

type Seed = {
  id: string;
  name: string;
  tier: QualityTier;
  ctx: number;
  out?: number;
  tools?: boolean;
  json?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  in?: number;
  outp?: number;
  cached?: number;
  embed?: number;
};

const s = (provider: string, seeds: Seed[]): ModelInfo[] =>
  seeds.map((m) => ({
    id: m.id,
    provider,
    displayName: m.name,
    tier: m.tier,
    deprecated: false,
    local: false,
    curated: true,
    capabilities: {
      contextWindow: m.ctx,
      maxOutputTokens: m.out,
      inputModalities: m.vision ? ["text", "image"] : ["text"],
      outputModalities: m.embed ? ["embedding"] : ["text"],
      tools: m.tools ?? false,
      structuredOutput: m.json ?? false,
      reasoning: m.reasoning ?? false,
      streaming: !m.embed,
      vision: m.vision ?? false,
      embeddingDimensions: m.embed,
    },
    pricing: m.in !== undefined ? { inputPerMTok: m.in, outputPerMTok: m.outp ?? 0, cachedInputPerMTok: m.cached, currency: "USD", estimated: true } : undefined,
  }));

/** Seed catalog. Live `listModels()` results are merged over these entries at runtime. */
export const SEED_MODELS: ModelInfo[] = [
  ...s("nvidia", [
    { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash (NIM)", tier: "standard", ctx: 128_000, out: 32_768, tools: true, json: true, reasoning: true, in: 0, outp: 0 },
    { id: "deepseek-ai/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash (NIM)", tier: "economy", ctx: 128_000, out: 32_768, tools: true, json: true, reasoning: true, in: 0, outp: 0 },
  ]),
  ...s("openai", [
    { id: "gpt-5", name: "GPT-5", tier: "frontier", ctx: 400_000, out: 128_000, tools: true, json: true, vision: true, reasoning: true, in: 1.25, outp: 10, cached: 0.125 },
    { id: "gpt-5-mini", name: "GPT-5 mini", tier: "standard", ctx: 400_000, out: 128_000, tools: true, json: true, vision: true, reasoning: true, in: 0.25, outp: 2, cached: 0.025 },
    { id: "gpt-5-nano", name: "GPT-5 nano", tier: "economy", ctx: 400_000, out: 128_000, tools: true, json: true, vision: true, reasoning: true, in: 0.05, outp: 0.4, cached: 0.005 },
    { id: "gpt-4.1", name: "GPT-4.1", tier: "premium", ctx: 1_047_576, out: 32_768, tools: true, json: true, vision: true, in: 2, outp: 8, cached: 0.5 },
    { id: "gpt-4.1-mini", name: "GPT-4.1 mini", tier: "standard", ctx: 1_047_576, out: 32_768, tools: true, json: true, vision: true, in: 0.4, outp: 1.6, cached: 0.1 },
    { id: "gpt-4o", name: "GPT-4o", tier: "premium", ctx: 128_000, out: 16_384, tools: true, json: true, vision: true, in: 2.5, outp: 10, cached: 1.25 },
    { id: "gpt-4o-mini", name: "GPT-4o mini", tier: "economy", ctx: 128_000, out: 16_384, tools: true, json: true, vision: true, in: 0.15, outp: 0.6, cached: 0.075 },
    { id: "text-embedding-3-small", name: "text-embedding-3-small", tier: "economy", ctx: 8_191, embed: 1536, in: 0.02 },
    { id: "text-embedding-3-large", name: "text-embedding-3-large", tier: "standard", ctx: 8_191, embed: 3072, in: 0.13 },
  ]),
  ...s("anthropic", [
    { id: "claude-opus-4-1", name: "Claude Opus 4.1", tier: "frontier", ctx: 200_000, out: 32_000, tools: true, json: true, vision: true, reasoning: true, in: 15, outp: 75, cached: 1.5 },
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", tier: "premium", ctx: 200_000, out: 64_000, tools: true, json: true, vision: true, reasoning: true, in: 3, outp: 15, cached: 0.3 },
    { id: "claude-sonnet-4-0", name: "Claude Sonnet 4", tier: "premium", ctx: 200_000, out: 64_000, tools: true, json: true, vision: true, reasoning: true, in: 3, outp: 15, cached: 0.3 },
    { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku", tier: "economy", ctx: 200_000, out: 8_192, tools: true, json: true, vision: true, in: 0.8, outp: 4, cached: 0.08 },
  ]),
  ...s("gemini", [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "frontier", ctx: 1_048_576, out: 65_536, tools: true, json: true, vision: true, reasoning: true, in: 1.25, outp: 10 },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", tier: "standard", ctx: 1_048_576, out: 65_536, tools: true, json: true, vision: true, reasoning: true, in: 0.3, outp: 2.5 },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite", tier: "economy", ctx: 1_048_576, out: 65_536, tools: true, json: true, vision: true, in: 0.1, outp: 0.4 },
    { id: "gemini-embedding-001", name: "Gemini Embedding", tier: "standard", ctx: 2_048, embed: 3072, in: 0.15 },
  ]),
  ...s("xai", [
    { id: "grok-4", name: "Grok 4", tier: "frontier", ctx: 256_000, tools: true, json: true, vision: true, reasoning: true, in: 3, outp: 15 },
    { id: "grok-3-mini", name: "Grok 3 mini", tier: "economy", ctx: 131_072, tools: true, json: true, reasoning: true, in: 0.3, outp: 0.5 },
  ]),
  ...s("mistral", [
    { id: "mistral-large-latest", name: "Mistral Large", tier: "premium", ctx: 128_000, tools: true, json: true, in: 2, outp: 6 },
    { id: "mistral-small-latest", name: "Mistral Small", tier: "economy", ctx: 128_000, tools: true, json: true, in: 0.1, outp: 0.3 },
    { id: "codestral-latest", name: "Codestral", tier: "standard", ctx: 256_000, tools: true, in: 0.3, outp: 0.9 },
    { id: "mistral-embed", name: "Mistral Embed", tier: "economy", ctx: 8_192, embed: 1024, in: 0.1 },
  ]),
  ...s("cohere", [
    { id: "command-a-03-2025", name: "Command A", tier: "premium", ctx: 256_000, tools: true, json: true, in: 2.5, outp: 10 },
    { id: "command-r7b-12-2024", name: "Command R7B", tier: "economy", ctx: 128_000, tools: true, json: true, in: 0.0375, outp: 0.15 },
    { id: "embed-v4.0", name: "Embed v4", tier: "standard", ctx: 128_000, embed: 1536, in: 0.12 },
  ]),
  ...s("deepseek", [
    { id: "deepseek-chat", name: "DeepSeek V3", tier: "standard", ctx: 128_000, tools: true, json: true, in: 0.27, outp: 1.1, cached: 0.07 },
    { id: "deepseek-reasoner", name: "DeepSeek R1", tier: "premium", ctx: 128_000, tools: true, reasoning: true, in: 0.55, outp: 2.19, cached: 0.14 },
  ]),
  ...s("groq", [
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B (Groq)", tier: "standard", ctx: 131_072, tools: true, json: true, in: 0.59, outp: 0.79 },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B (Groq)", tier: "standard", ctx: 131_072, tools: true, json: true, reasoning: true, in: 0.15, outp: 0.6 },
  ]),
  ...s("cerebras", [{ id: "llama-3.3-70b", name: "Llama 3.3 70B (Cerebras)", tier: "standard", ctx: 128_000, tools: true, json: true, in: 0.85, outp: 1.2 }]),
  ...s("together", [{ id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo", tier: "standard", ctx: 131_072, tools: true, json: true, in: 0.88, outp: 0.88 }]),
  ...s("fireworks", [{ id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B", tier: "standard", ctx: 131_072, tools: true, json: true, in: 0.9, outp: 0.9 }]),
  ...s("openrouter", [
    { id: "openai/gpt-5", name: "GPT-5 (OpenRouter)", tier: "frontier", ctx: 400_000, tools: true, json: true, vision: true, reasoning: true, in: 1.25, outp: 10 },
    { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5 (OpenRouter)", tier: "premium", ctx: 200_000, tools: true, json: true, vision: true, in: 3, outp: 15 },
  ]),
  ...s("perplexity", [{ id: "sonar-pro", name: "Sonar Pro", tier: "premium", ctx: 200_000, json: true, in: 3, outp: 15 }, { id: "sonar", name: "Sonar", tier: "standard", ctx: 128_000, json: true, in: 1, outp: 1 }]),
  ...s("bedrock", [
    { id: "anthropic.claude-sonnet-4-20250514-v1:0", name: "Claude Sonnet 4 (Bedrock)", tier: "premium", ctx: 200_000, tools: true, json: true, vision: true, in: 3, outp: 15 },
    { id: "amazon.nova-pro-v1:0", name: "Amazon Nova Pro", tier: "standard", ctx: 300_000, tools: true, json: true, vision: true, in: 0.8, outp: 3.2 },
    { id: "amazon.titan-embed-text-v2:0", name: "Titan Embeddings v2", tier: "economy", ctx: 8_192, embed: 1024, in: 0.02 },
  ]),
  ...s("vertex", [{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Vertex)", tier: "frontier", ctx: 1_048_576, tools: true, json: true, vision: true, reasoning: true, in: 1.25, outp: 10 }, { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Vertex)", tier: "standard", ctx: 1_048_576, tools: true, json: true, vision: true, in: 0.3, outp: 2.5 }]),
  ...s("codex_companion", [{ id: "codex", name: "Codex (ChatGPT plan)", tier: "premium", ctx: 400_000, tools: true, json: true, reasoning: true }]),
];

export function seedModelsFor(provider: string): ModelInfo[] {
  return SEED_MODELS.filter((m) => m.provider === provider);
}
