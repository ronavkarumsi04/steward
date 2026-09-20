import type { ChatEvent, ChatMessage, ChatRequest, ChatResponse } from "./types.js";

/**
 * Steward tool ids are namespaced with dots ("document.write"). Most provider APIs only accept
 * `^[a-zA-Z0-9_-]{1,64}$` for function names, so the gateway encodes names on the way out and
 * decodes them on the way back using the request's own tool list as the authoritative map.
 */
export function encodeToolName(name: string): string {
  return name.replace(/\./g, "__").slice(0, 64);
}

export class ToolNameCodec {
  private readonly back = new Map<string, string>();

  constructor(tools: ReadonlyArray<{ name: string }> = []) {
    for (const t of tools) this.back.set(encodeToolName(t.name), t.name);
  }

  encode(name: string): string {
    return encodeToolName(name);
  }

  decode(name: string): string {
    return this.back.get(name) ?? (this.back.size ? name.replace(/__/g, ".") : name);
  }

  encodeRequest<R extends Omit<ChatRequest, "model"> & { model?: string }>(req: R): R {
    const tools = req.tools?.map((t) => ({ ...t, name: this.encode(t.name) }));
    const toolChoice = typeof req.toolChoice === "object" && req.toolChoice ? { name: this.encode(req.toolChoice.name) } : req.toolChoice;
    const messages = req.messages.map((m): ChatMessage => {
      if (typeof m.content === "string") return m;
      return { ...m, content: m.content.map((p) => (p.type === "tool_call" ? { ...p, name: this.encode(p.name) } : p)) };
    });
    return { ...req, tools, toolChoice, messages };
  }

  decodeResponse(res: ChatResponse): ChatResponse {
    return { ...res, toolCalls: res.toolCalls.map((c) => ({ ...c, name: this.decode(c.name) })) };
  }

  decodeEvent(ev: ChatEvent): ChatEvent {
    switch (ev.type) {
      case "tool_call_start":
      case "tool_call_end":
        return { ...ev, name: this.decode(ev.name) };
      case "done":
        return { ...ev, response: this.decodeResponse(ev.response) };
      default:
        return ev;
    }
  }
}
