import { describe, expect, it } from "vitest";
import { ToolNameCodec, encodeToolName } from "./toolnames.js";

describe("ToolNameCodec", () => {
  it("encodes dotted tool ids into provider-safe names and decodes them back", () => {
    const codec = new ToolNameCodec([{ name: "document.write" }, { name: "company.profile_update" }]);
    expect(encodeToolName("document.write")).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    const req = codec.encodeRequest({
      messages: [{ role: "assistant", content: [{ type: "tool_call", id: "1", name: "document.write", arguments: {} }] }],
      tools: [{ name: "document.write", description: "", parameters: {} }, { name: "company.profile_update", description: "", parameters: {} }],
      toolChoice: { name: "document.write" },
    });
    expect(req.tools?.map((t) => t.name)).toEqual(["document__write", "company__profile_update"]);
    expect(req.toolChoice).toEqual({ name: "document__write" });
    const part = Array.isArray(req.messages[0]!.content) ? req.messages[0]!.content[0] : undefined;
    expect(part && part.type === "tool_call" ? part.name : "").toBe("document__write");
    expect(codec.decode("company__profile_update")).toBe("company.profile_update");
    expect(codec.decodeEvent({ type: "tool_call_end", id: "1", name: "document__write", arguments: {} })).toMatchObject({ name: "document.write" });
  });

  it("leaves unknown names untouched when the request had no tools", () => {
    expect(new ToolNameCodec().decode("plain__name")).toBe("plain__name");
  });
});
