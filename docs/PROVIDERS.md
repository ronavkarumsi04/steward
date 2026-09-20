# AI providers

Providers are configured per organization under **Providers** in the web app (or `POST /v1/orgs/:orgId/providers`). Secrets are envelope-encrypted; the API returns only a hint. "Test" issues a minimal real request to the provider.

| Type | Auth | Adapter | Notes |
| --- | --- | --- | --- |
| `openai` | API key | openai-compatible (Responses/Chat) | GPT-5 family, GPT-4o, embeddings |
| `azure_openai` | API key + endpoint + deployment | openai-compatible | |
| `anthropic` | API key | anthropic | Claude Opus/Sonnet/Haiku |
| `gemini` | API key | gemini | Gemini 2.5 family, embeddings |
| `vertex` | Service-account JSON | gemini (Vertex endpoint) | |
| `bedrock` | AWS access key/secret (+ region) | bedrock (Converse API, SigV4) | |
| `xai` | API key | openai-compatible | Grok |
| `mistral` | API key | openai-compatible | incl. Codestral, embeddings |
| `cohere` | API key | cohere | Command A / R |
| `deepseek`, `groq`, `cerebras`, `together`, `fireworks`, `openrouter`, `perplexity`, `nvidia`, `sambanova`, `huggingface`, `cloudflare` | API key | openai-compatible | base URL per provider from the catalog |
| `ollama` | none (base URL) | ollama native (`/api/chat`, `/api/tags`) | local models |
| `lmstudio`, `vllm`, `llamacpp`, `litellm`, `openai_compatible` | optional key + base URL | openai-compatible | self-hosted / gateways |
| `codex_companion` | paired device | codex-companion | runs the user's own Codex CLI on their machine; see [companion](../apps/companion/README.md) |

## Routing

Each agent has a routing policy: preferred model, fallbacks, required capabilities (tools, structured output, vision, context size) and a cost ceiling. The router picks the first healthy provider/model satisfying the policy; provider errors (auth, rate limit, 5xx) mark the credential unhealthy for a cooling-off period and trigger failover. Usage (tokens, estimated cost, latency, provider, model, agent, run) is written to `usage_records` and aggregated under **Providers → Usage**.

## Verification status

Adapters are covered by contract tests against an in-process HTTP stub that speaks each provider's wire format (`packages/ai/src/adapters.test.ts`). Live verification requires a real key per provider — run **Test** in the UI or `scripts/smoke.sh`. Credentials whose last call failed are flagged `unhealthy` in the Providers table until a later call succeeds.
