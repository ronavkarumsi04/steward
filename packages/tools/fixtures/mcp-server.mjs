#!/usr/bin/env node
/**
 * A real MCP server, used only by tests.
 *
 * The tests install this the way a company installs any other server — over stdio, spawned as a child process,
 * speaking the real protocol — because a stub that answers a handshake we wrote ourselves would only prove that
 * we agree with ourselves. It lives beside the seam it exercises so that `@modelcontextprotocol/sdk` resolves
 * from the one package that depends on it, and it is deliberately small: six tools whose names, descriptions,
 * annotations and failures are chosen to cover every branch of the risk derivation and of the result mapping.
 *
 * It is written against the *low-level* server rather than the helper one on purpose. The helper generates
 * whatever schema the library's zod version produces, and the thing under test here is precisely what arrives on
 * the wire: an input schema a model provider can be handed, and an annotation block that is the server's own
 * claim about itself. Nothing about this file is imported by product code or shipped in a build.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const OBJECT = (properties) => ({ type: "object", properties, additionalProperties: false });

const TOOLS = [
  // readOnlyHint on its own: the derived band is LOW and the derivation says it came from the server's claim.
  {
    name: "lookup_invoice",
    description: "Read one invoice by its id. Does not change anything.",
    inputSchema: OBJECT({ id: { type: "string", description: "The invoice id." } }),
    annotations: { title: "Look up an invoice", readOnlyHint: true, idempotentHint: true },
  },
  // A destructive hint: the server warns about itself, and the derived band is HIGH.
  {
    name: "delete_customer",
    description: "Erase a customer and everything attached to them.",
    inputSchema: OBJECT({ id: { type: "string" } }),
    annotations: { destructiveHint: true },
  },
  // No annotations at all: the band is the cautious default, and the tool list has to say that is why.
  { name: "reschedule", description: "Move a job to another date.", inputSchema: OBJECT({ when: { type: "string" } }), annotations: {} },
  // The interesting liar: its name reads as a query, its annotation says it writes. The cautious side must win.
  {
    name: "get_and_reissue",
    description: "Issues a replacement key for an account.",
    inputSchema: OBJECT({ account: { type: "string" } }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  // A tool that fails the way a real one does: an MCP error result rather than a crashed process.
  {
    name: "post_webhook",
    description: "POST a payload to a URL and report what happened.",
    inputSchema: OBJECT({ url: { type: "string" }, body: { type: "string" } }),
    annotations: { destructiveHint: true },
  },
  // Names only, never values: this is how a test proves what a spawned server can and cannot see of the host.
  { name: "env_report", description: "Which environment variables this process can see.", inputSchema: OBJECT({}), annotations: { readOnlyHint: true } },
];

const server = new Server({ name: "fixture-ledger", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments ?? {};
  const text = (value) => ({ content: [{ type: "text", text: value }] });
  switch (request.params.name) {
    case "lookup_invoice":
      return text(`invoice ${args.id ?? "inv_1"}: 250.00 GBP, unpaid`);
    case "delete_customer":
      return text(`deleted ${args.id ?? "cus_1"}`);
    case "reschedule":
      return text(`rescheduled to ${args.when ?? "(no date)"}`);
    case "get_and_reissue":
      return text(`reissued for ${args.account ?? "acct_1"}`);
    case "post_webhook":
      // The failure mode that matters: a tool that says no has to arrive as a failure and not as output.
      return String(args.url ?? "").includes("refuse") ? { content: [{ type: "text", text: "the endpoint refused the payload" }], isError: true } : text(`posted to ${args.url ?? "(no url)"}`);
    case "env_report":
      return text(Object.keys(process.env).sort().join(","));
    default:
      return { content: [{ type: "text", text: `no such tool: ${request.params.name}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
