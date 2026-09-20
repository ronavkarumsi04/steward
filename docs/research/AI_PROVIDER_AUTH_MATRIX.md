# AI Provider Authentication Matrix

Research date: 2026-09-20. Verified against official documentation where linked. Items marked
*verify-at-connect* are enforced at runtime by the adapter's `testConnection()`.

## Credential modes supported by Steward

| Mode | Description | Storage |
|------|-------------|---------|
| A — BYOK API key | User pastes a provider key. | Envelope-encrypted in `provider_credentials` (AES-256-GCM data key wrapped by master key / KMS). Never returned in plaintext; only `last4` + fingerprint shown. |
| B — Cloud credentials | AWS (access key/secret or role via env), GCP service account JSON / ADC, Azure API key or Entra token. | Same envelope encryption; signed requests issued server-side. |
| C — Subscription-backed via official local client | Only where the provider's own documentation permits third-party/programmatic use. Implemented through the **Local Companion**: credentials never leave the user's machine. | Provider CLI's own store (`~/.codex`) on the user's machine; Steward stores only a companion pairing key (hashed). |
| D — Local models | Ollama, LM Studio, vLLM, llama.cpp server, LiteLLM, any OpenAI-compatible endpoint. | Base URL (+ optional key). Traffic never leaves the user's network. |

## Subscription / CLI authentication findings (Mode C)

### OpenAI Codex — PERMITTED via official SDK/CLI on the user's machine
- Official docs (developers.openai.com/codex/auth): Codex CLI supports **Sign in with ChatGPT** (subscription
  access) and **API key**. Device-code login (`codex login --device-auth`, beta) exists for headless machines.
  Tokens are cached in `~/.codex/auth.json` or the OS keyring and refreshed automatically.
- Official **Codex SDK** (`@openai/codex-sdk`, README in openai/codex repo) "wraps the `codex` CLI", is
  intended to "embed the Codex agent in your workflows and apps", and uses whatever login the CLI holds.
- OpenAI *recommends* API keys for CI/CD automation and warns not to expose Codex in untrusted environments.
  ChatGPT Enterprise offers dedicated "Codex access tokens" for trusted automation.
- The `chatgpt.com/backend-api/codex` endpoint used internally by the CLI is **undocumented**
  (openai/codex issue #36886). Steward does **not** call it directly and does not read `auth.json`.
- Steward implementation: the Local Companion runs on the user's machine, invokes `codex exec` / Codex SDK
  in a workspace directory under a restricted command protocol. Usage is attributed to the user's own plan.
  Steward never uploads the token; the browser never sees it.
- Entitlement: follows the user's ChatGPT plan limits (VERIFIED_PUBLIC). Model choice limited to what the
  CLI exposes.

### Anthropic Claude — NOT PERMITTED for third parties (API key / cloud only)
- code.claude.com/docs/en/legal-and-compliance: "Anthropic does not permit third-party developers to offer
  Claude.ai login or to route requests through Free, Pro, or Max plan credentials on behalf of their users."
  OAuth is "intended exclusively ... to support ordinary use of Claude Code and other native Anthropic
  applications." Enforcement began Jan 2026 (The Register, 2026-02-20).
- The June 2026 "Agent SDK monthly credit" that would have covered "third-party apps that authenticate with
  your Claude subscription through the Agent SDK" was **paused on 2026-06-15** (support.claude.com article
  15036540). Until Anthropic ships a permitted mechanism, Steward shows Anthropic as **API key / Bedrock /
  Vertex / Azure Foundry only**.
- The companion has a feature-flagged, disabled-by-default `claude` runner that is only enabled when
  `providers.anthropic.subscription_mode_permitted=true` is set by an operator who has confirmed
  authorization from Anthropic (e.g. an Enterprise agreement). Default builds do not offer it.

### Google Gemini — API key / Vertex; CLI login is for the CLI itself
- Gemini CLI (Apache-2.0) supports "Login with Google" (Gemini Code Assist quota), `GEMINI_API_KEY`, and
  Vertex AI. Headless mode (`gemini -p`) reuses cached credentials.
- Google's Code Assist terms scope the OAuth login to Gemini CLI / Code Assist usage. Steward therefore
  offers Gemini via **API key (AI Studio)** and **Vertex AI (service account / ADC)**. Running the Gemini
  CLI through the companion is possible technically but is *not enabled by default* pending explicit
  confirmation of third-party orchestration terms (classified INFERRED-not-permitted).

### Others
- GitHub Copilot: subscription-scoped to GitHub products; not exposed as a general inference API for third
  parties → not offered.
- Cursor/Windsurf/etc.: no public inference API → not applicable.

## Provider matrix (Mode A/B/D)

| Provider | Protocol used by Steward | Auth | Model list endpoint | Streaming | Tools | Structured output | Notes |
|----------|--------------------------|------|---------------------|-----------|-------|-------------------|-------|
| OpenAI | Chat Completions (`/v1/chat/completions`), optional Responses | Bearer key | `GET /v1/models` | yes | yes | json_schema | Org/project headers optional. |
| Azure OpenAI | Chat Completions with `api-version` | `api-key` header or Entra bearer | Deployments enumerated via config | yes | yes | json_schema | Base URL `https://{resource}.openai.azure.com/openai/deployments/{deployment}`. |
| Anthropic | Messages API (`/v1/messages`) | `x-api-key` + `anthropic-version` | `GET /v1/models` | yes (SSE) | yes | via tool-forcing | Prompt caching usage fields recorded. |
| Google Gemini (AI Studio) | `generateContent` / `streamGenerateContent` | `x-goog-api-key` | `GET /v1beta/models` | yes | yes (functionDeclarations) | responseSchema | |
| Google Vertex AI | Same Gemini API on `{region}-aiplatform.googleapis.com` | OAuth2 via service account (google-auth-library) | publisher models list | yes | yes | yes | Also serves Anthropic models (not implemented in v1). |
| AWS Bedrock | Converse / ConverseStream | SigV4 (`@aws-sdk/client-bedrock-runtime`) | `ListFoundationModels` | yes | yes | tool-forcing | Cross-region inference profiles supported by id. |
| xAI | OpenAI-compatible `api.x.ai/v1` | Bearer | `/v1/models` | yes | yes | yes | |
| Mistral | OpenAI-compatible `api.mistral.ai/v1` | Bearer | `/v1/models` | yes | yes | json_object/schema | |
| Cohere | Chat v2 (`/v2/chat`) | Bearer | `/v1/models` | yes | yes | json_schema | Distinct request shape → dedicated adapter. |
| DeepSeek | OpenAI-compatible `api.deepseek.com` | Bearer | `/models` | yes | yes | json_object | |
| Groq | OpenAI-compatible `api.groq.com/openai/v1` | Bearer | `/models` | yes | yes | json_object | |
| Cerebras | OpenAI-compatible `api.cerebras.ai/v1` | Bearer | `/models` | yes | yes | json_schema | |
| Together AI | OpenAI-compatible `api.together.xyz/v1` | Bearer | `/models` | yes | yes | json_schema (subset) | |
| Fireworks AI | OpenAI-compatible `api.fireworks.ai/inference/v1` | Bearer | `/models` | yes | yes | json_schema | |
| OpenRouter | OpenAI-compatible `openrouter.ai/api/v1` | Bearer | `/models` (rich metadata incl. pricing/context) | yes | yes | yes | Catalog is the best public source of cross-provider metadata. |
| Perplexity | OpenAI-compatible `api.perplexity.ai` | Bearer | static | yes | no | json_schema | Built-in web search; citations recorded. |
| Cloudflare Workers AI | OpenAI-compatible `api.cloudflare.com/client/v4/accounts/{id}/ai/v1` | Bearer API token | `/models/search` | yes | partial | partial | |
| NVIDIA NIM | OpenAI-compatible `integrate.api.nvidia.com/v1` | Bearer | `/models` | yes | yes | partial | Self-hosted NIM = generic endpoint. |
| SambaNova | OpenAI-compatible `api.sambanova.ai/v1` | Bearer | `/models` | yes | yes | partial | |
| Hugging Face Inference | OpenAI-compatible `router.huggingface.co/v1` | Bearer | `/models` | yes | partial | partial | |
| Replicate | Predictions API | Bearer | `GET /v1/models` | SSE | no | no | Used for image generation/other modalities; not chat-routed by default. |
| Ollama | OpenAI-compatible `/v1` + native `/api/tags`, `/api/show` | none/optional | `/api/tags` | yes | yes | json | Context/capabilities from `/api/show`. |
| LM Studio | OpenAI-compatible `/v1` | none/optional | `/v1/models` | yes | yes | json | |
| vLLM | OpenAI-compatible `/v1` | optional | `/v1/models` | yes | yes | json/guided | |
| llama.cpp server | OpenAI-compatible `/v1` | optional | `/v1/models` | yes | partial | grammar/json | |
| LiteLLM proxy | OpenAI-compatible `/v1` | Bearer (virtual key) | `/v1/models` + `/model/info` | yes | yes | yes | |
| Generic OpenAI-compatible | OpenAI-compatible | configurable | `/v1/models` or static | yes | configurable | configurable | Adding one is configuration (`provider_types.json`). |

## Security rules applied to every mode

- Keys are write-only; API returns `{ last4, fingerprint, createdAt, rotatedAt }`.
- Envelope encryption: per-record data key (AES-256-GCM) wrapped by master key; production master key from
  KMS (AWS KMS / GCP KMS / Vault) via `MasterKeyProvider`.
- Credentials are scoped to an organization and optionally a company; adapters receive decrypted material
  only inside the request that needs it, never logged (pino redaction list).
- Companion pairing uses short-lived device codes, per-device keys, mutual authentication over TLS
  WebSocket, restricted command set, and revocation from the UI.
