import type { ModelInfo } from "@steward/schema";
import { fetchJson } from "../http.js";
import type { ProviderCredential } from "../types.js";
import { OpenAICompatibleAdapter } from "./openai-compatible.js";

/** Ollama speaks the OpenAI protocol under /v1, but exposes richer metadata through its native API. */
export class OllamaAdapter extends OpenAICompatibleAdapter {
  private readonly nativeBase: string;

  constructor(cred: ProviderCredential) {
    const root = (cred.baseUrl ?? "http://localhost:11434").replace(/\/v1\/?$/, "").replace(/\/$/, "");
    super({ ...cred, baseUrl: `${root}/v1` }, "ollama");
    this.nativeBase = root;
  }

  override async listModels(): Promise<ModelInfo[]> {
    const tags = await fetchJson<{ models?: Array<{ name: string; details?: { family?: string; parameter_size?: string } }> }>(this.type, `${this.nativeBase}/api/tags`, { headers: this.headers, timeoutMs: 10_000 });
    const out: ModelInfo[] = [];
    for (const m of tags.models ?? []) {
      let ctx = 8_192;
      let caps: string[] = [];
      try {
        const show = await fetchJson<{ capabilities?: string[]; model_info?: Record<string, number> }>(this.type, `${this.nativeBase}/api/show`, { method: "POST", headers: this.headers, body: JSON.stringify({ model: m.name }), timeoutMs: 10_000 });
        caps = show.capabilities ?? [];
        const info = show.model_info ?? {};
        const key = Object.keys(info).find((k) => k.endsWith(".context_length"));
        if (key && info[key]) ctx = Number(info[key]);
      } catch {
        /* metadata optional */
      }
      const isEmbed = caps.includes("embedding");
      out.push({
        id: m.name,
        provider: this.type,
        displayName: `${m.name}${m.details?.parameter_size ? ` (${m.details.parameter_size})` : ""}`,
        family: m.details?.family,
        tier: "standard",
        deprecated: false,
        local: true,
        capabilities: {
          contextWindow: ctx,
          inputModalities: caps.includes("vision") ? ["text", "image"] : ["text"],
          outputModalities: isEmbed ? ["embedding"] : ["text"],
          tools: caps.includes("tools"),
          structuredOutput: !isEmbed,
          reasoning: caps.includes("thinking"),
          streaming: !isEmbed,
          vision: caps.includes("vision"),
          embeddingDimensions: isEmbed ? 768 : undefined,
        },
        pricing: { inputPerMTok: 0, outputPerMTok: 0, currency: "USD", estimated: false },
      });
    }
    return out;
  }
}
