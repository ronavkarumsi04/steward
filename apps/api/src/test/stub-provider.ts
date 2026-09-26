/**
 * Real-HTTP OpenAI-compatible stub used by integration tests. It speaks the wire protocol
 * (`/models`, `/chat/completions`, non-streaming) and drives a scripted agent. Every request is recorded so tests
 * can assert on what the runtime actually sent (tool names, auth header, structured output).
 *
 * The script is chosen by the caller, because the scripts are the only way to reach some of the product's most
 * important paths deterministically: an action that policy holds, a reviewer that says no, a reviewer that
 * cannot run at all. Each script is named for the behaviour it drives, and a run driven by one of them proves
 * what the system does — never what a model would decide.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface StubRequest {
  path: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

export interface StubProvider {
  baseUrl: string;
  apiKey: string;
  requests: StubRequest[];
  close(): Promise<void>;
}

/** What the scripted agent does, and what its reviewer says about it. */
export type StubScript =
  /** Writes a document and records a decision; the reviewer passes it. */
  | "document"
  /** Reaches for an outbound action (email.send) before anything else; the reviewer passes what happened. */
  | "outbound"
  /** Same work as `document`, but the reviewer judges it unmet. */
  | "verifier-denies"
  /** Same work as `document`, but the reviewer's answer cannot be parsed — verification never happened. */
  | "verifier-crashes";

export interface StubOptions {
  apiKey?: string;
  /** Fail the first chat completion, to exercise retryable provider failures. */
  failFirstChat?: boolean;
  script?: StubScript;
}

type Msg = { role: string; content?: unknown; tool_calls?: Array<{ function: { name: string } }>; tool_call_id?: string };

function chat(content: string | null, toolCalls?: Array<{ name: string; args: Record<string, unknown> }>, finish = "stop") {
  return {
    id: `chatcmpl_${Math.random().toString(36).slice(2)}`,
    object: "chat.completion",
    model: "stub-1",
    choices: [
      {
        index: 0,
        finish_reason: toolCalls?.length ? "tool_calls" : finish,
        message: {
          role: "assistant",
          content,
          tool_calls: toolCalls?.map((t, i) => ({ id: `call_${i}_${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } })),
        },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
  };
}

const PLANS: Record<StubScript, { objective: string; steps: Array<{ title: string; tools: string[] }>; successCriteria: string[] }> = {
  document: {
    objective: "Produce positioning + decision",
    steps: [{ title: "Write positioning doc", tools: ["document.write"] }, { title: "Record customer decision", tools: ["decision.record"] }],
    successCriteria: ["Positioning document exists", "Decision recorded"],
  },
  outbound: {
    objective: "Tell the beta list",
    steps: [{ title: "Email the launch list", tools: ["email.send"] }],
    successCriteria: ["Launch email sent to the beta list"],
  },
  "verifier-denies": {
    objective: "Produce positioning + decision",
    steps: [{ title: "Write positioning doc", tools: ["document.write"] }, { title: "Record customer decision", tools: ["decision.record"] }],
    successCriteria: ["Positioning document exists", "Decision recorded"],
  },
  "verifier-crashes": {
    objective: "Produce positioning + decision",
    steps: [{ title: "Write positioning doc", tools: ["document.write"] }, { title: "Record customer decision", tools: ["decision.record"] }],
    successCriteria: ["Positioning document exists", "Decision recorded"],
  },
};

function verificationBody(script: StubScript): string {
  if (script === "verifier-denies") {
    return JSON.stringify({
      passed: false,
      verdict: "failed",
      score: 20,
      summary: "The document exists but names no verifiable target customer, so the positioning cannot be judged.",
      unmet: ["Positioning document exists", "A target customer is named with a reason"],
      followUps: [],
    });
  }
  return JSON.stringify({
    passed: true,
    verdict: "passed",
    score: 92,
    summary: "Positioning document written and target-customer decision recorded.",
    unmet: [],
    followUps: [{ title: "Draft landing page copy", assigneeKind: "marketing" }],
  });
}

export async function startStubProvider(opts: StubOptions = {}): Promise<StubProvider> {
  const apiKey = opts.apiKey ?? "stub-key-123";
  const script = opts.script ?? "document";
  const requests: StubRequest[] = [];
  let chatCalls = 0;

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = req.url ?? "/";
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.headers.authorization !== `Bearer ${apiKey}`) return json(401, { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } });
      if (path.endsWith("/models")) return json(200, { object: "list", data: [{ id: "stub-1", object: "model", owned_by: "stub" }] });
      if (!path.endsWith("/chat/completions")) return json(404, { error: { message: "not found" } });

      const body = JSON.parse(raw || "{}") as Record<string, unknown>;
      requests.push({ path, authorization: req.headers.authorization, body });
      chatCalls += 1;
      if (opts.failFirstChat && chatCalls === 1) return json(500, { error: { message: "transient upstream failure", type: "server_error" } });

      const tools = (body.tools as Array<{ function: { name: string } }> | undefined) ?? [];
      for (const t of tools) if (!/^[a-zA-Z0-9_-]{1,64}$/.test(t.function.name)) return json(400, { error: { message: `Invalid 'tools[].function.name': ${t.function.name}`, type: "invalid_request_error" } });

      const rf = body.response_format as { type?: string; json_schema?: { name?: string } } | undefined;
      if (rf?.type === "json_schema" && rf.json_schema?.name === "plan") {
        return json(200, chat(JSON.stringify({ ...PLANS[script], risks: [], needsHuman: [] })));
      }
      // The runtime names this schema "verification"; "verify" was a typo here for a long time, and because the
      // old verification fallback reported `passed: true` after a parse failure, nothing ever noticed. The stub
      // now answers the request the runtime actually makes and states the verdict explicitly.
      if (rf?.type === "json_schema" && (rf.json_schema?.name === "verification" || rf.json_schema?.name === "verify")) {
        // A reviewer whose answer cannot be parsed is the case the product must never read as approval: the
        // run has to come back `unverified`, not `succeeded`.
        if (script === "verifier-crashes") return json(200, chat('{"passed": true, "score": 92, "summary": "the review'));
        return json(200, chat(verificationBody(script)));
      }

      const msgs = (body.messages as Msg[]) ?? [];
      const called = new Set<string>();
      for (const m of msgs) for (const tc of m.tool_calls ?? []) called.add(tc.function.name);
      const has = (n: string) => called.has(n) || called.has(n.replace(/\./g, "__"));
      if (script === "outbound") {
        if (!has("email.send")) {
          return json(200, chat(null, [{ name: "email__send", args: { to: "beta@example.com", subject: "You're in the beta", text: "The beta is open — here is your invite." } }]));
        }
        return json(200, chat("The launch email went out and the beta list has been told."));
      }
      if (!has("document.write")) return json(200, chat(null, [{ name: "document__write", args: { title: "Positioning", folder: "/", content: "- Tidy CSVs in one command\n- Built for data engineers\n- Works offline" } }]));
      if (!has("decision.record")) return json(200, chat(null, [{ name: "decision__record", args: { title: "Target customer: data engineers at SMBs", rationale: "They handle messy CSV exports daily and have budget authority for tooling." } }]));
      return json(200, chat("Positioning saved and target-customer decision recorded."));
    });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey,
    requests,
    close: () => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))),
  };
}
