import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPrompt, codexExec, codexStatus, interpretFinal, parseJsonl } from "./codex.js";
import { runDaemon } from "./daemon.js";
import type { PendingCommand, ResultMessage } from "./protocol.js";

/**
 * A stand-in for the real `codex` binary that speaks the same CLI surface we depend on
 * (`--version`, `login status`, `exec --json -o <file> --output-schema <file> -`) so the runner
 * can be exercised without an OpenAI login.
 */
const FAKE_CODEX = `#!/usr/bin/env bash
set -e
if [ "$1" = "--version" ]; then echo "codex-cli 0.0.0-fake"; exit 0; fi
if [ "$1" = "login" ]; then echo "Logged in using ChatGPT"; exit 0; fi
if [ "$1" = "exec" ]; then
  out=""; schema=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -o) out="$2"; shift 2;;
      --output-schema) schema="$2"; shift 2;;
      *) shift;;
    esac
  done
  prompt="$(cat)"
  printf '%s\\n' "$prompt" > "$(dirname "$out")/prompt.txt"
  echo '{"type":"thread.started","thread_id":"t-123"}'
  if [ -n "$schema" ] && grep -q tool_calls "$schema"; then
    msg='{"text":"","tool_calls":[{"name":"web.search","arguments_json":"{\\"q\\":\\"steward\\"}"}]}'
  else
    msg="hello from fake codex"
  fi
  printf '{"type":"item.completed","item":{"type":"agent_message","text":%s}}\\n' "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$msg")"
  echo '{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":2,"output_tokens":5}}'
  printf '%s' "$msg" > "$out"
  exit 0
fi
echo "unknown" >&2; exit 1
`;

let bin: string;
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "fake-codex-"));
  bin = join(dir, "codex");
  await writeFile(bin, FAKE_CODEX);
  await chmod(bin, 0o755);
});

describe("codex runner", () => {
  it("reports login status via the CLI, never by reading auth files", async () => {
    const st = await codexStatus(bin);
    expect(st.loggedIn).toBe(true);
    expect(st.version).toBe("codex-cli 0.0.0-fake");
    const missing = await codexStatus("/definitely/not/codex");
    expect(missing.loggedIn).toBe(false);
    expect(missing.detail).toMatch(/not found/);
  });

  it("renders system/transcript/tools into one prompt", () => {
    const p = buildPrompt({
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "tool", content: "{\"ok\":true}" },
      ],
      tools: [{ name: "web.search", description: "Search", parameters: { type: "object", properties: { q: { type: "string" } } } }],
      responseFormat: { type: "json_schema", name: "x", schema: { type: "object" } },
    });
    expect(p).toContain("# Instructions\n\nBe terse.");
    expect(p).toContain("## web.search");
    expect(p).toContain("### tool result");
    expect(p).toContain("Final answer format");
    expect(p.trimEnd().endsWith("### assistant")).toBe(true);
  });

  it("parses JSONL events and tool-call envelopes defensively", () => {
    const parsed = parseJsonl(['{"type":"thread.started","thread_id":"t"}', "not json", '{"type":"item.completed","item":{"type":"agent_message","text":"a"}}', '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}', '{"type":"error","message":"boom"}']);
    expect(parsed).toEqual({ threadId: "t", agentMessages: ["a"], usage: { inputTokens: 1, outputTokens: 2, cachedTokens: undefined, reasoningTokens: undefined }, errors: ["boom"] });
    expect(interpretFinal("plain", false)).toEqual({ text: "plain" });
    const tc = interpretFinal('{"text":"","tool_calls":[{"name":"a","arguments_json":"{\\"x\\":1}"},{"name":"b","arguments_json":"nope"}]}', true);
    expect(tc.toolCalls?.map((c) => [c.name, c.arguments])).toEqual([["a", { x: 1 }], ["b", { _raw: "nope" }]]);
    expect(interpretFinal("garbage", true)).toEqual({ text: "garbage", toolCalls: [] });
  });

  it("executes plain and tool-enabled requests through the CLI", async () => {
    const deltas: string[] = [];
    const plain = await codexExec({ messages: [{ role: "user", content: "hi" }] }, { bin, sandbox: "read-only", onEvent: (e) => deltas.push(e.delta) });
    expect(plain.text).toBe("hello from fake codex");
    expect(plain.usage).toEqual({ inputTokens: 12, outputTokens: 5, cachedTokens: 2, reasoningTokens: undefined });
    expect(plain.threadId).toBe("t-123");
    expect(deltas).toEqual(["hello from fake codex"]);

    const withTools = await codexExec({ messages: [{ role: "user", content: "search" }], tools: [{ name: "web.search", description: "s", parameters: {} }] }, { bin, sandbox: "read-only" });
    expect(withTools.text).toBe("");
    expect(withTools.toolCalls?.[0]).toMatchObject({ name: "web.search", arguments: { q: "steward" } });
  });
});

describe("daemon loop", () => {
  let server: Server;
  let url: string;
  const results: ResultMessage[] = [];
  const queue: PendingCommand[] = [
    { id: "c1", command: "ping", payload: {}, streaming: false },
    { id: "c2", command: "codex.status", payload: {}, streaming: false },
    { id: "c3", command: "codex.exec", payload: { messages: [{ role: "user", content: "hi" }] }, streaming: true },
    { id: "c4", command: "rm -rf" as PendingCommand["command"], payload: {}, streaming: false },
  ];
  let polls = 0;
  let revoke = false;

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const auth = req.headers.authorization;
      if (auth !== "Bearer scd_test" || revoke) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { code: "unauthenticated", message: "bad key" } }));
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      if (req.url === "/v1/companion/poll") {
        polls++;
        const batch = queue.splice(0, 2);
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ commands: batch }));
      }
      if (req.url === "/v1/companion/results") {
        results.push(JSON.parse(body) as ResultMessage);
        if (results.filter((r) => r.type !== "event").length >= 4) revoke = true;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ accepted: true }));
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    url = `http://127.0.0.1:${addr.port}`;
  });
  afterAll(() => server.close());

  it("executes only permitted commands, streams events, and exits when revoked", async () => {
    const outcome = await runDaemon({ server: url, deviceId: "d1", deviceKey: "scd_test", name: "t", codexSandbox: "read-only", codexBin: bin }, { pollWaitMs: 0 });
    expect(outcome).toBe("revoked");
    expect(polls).toBeGreaterThanOrEqual(2);
    const byId = Object.fromEntries(results.filter((r) => r.type !== "event").map((r) => [r.id, r]));
    expect(byId.c1).toMatchObject({ type: "result", result: { pong: true } });
    expect(byId.c2).toMatchObject({ type: "result", result: { loggedIn: true } });
    expect(byId.c3).toMatchObject({ type: "result", result: { text: "hello from fake codex" } });
    expect(byId.c4).toMatchObject({ type: "error" });
    expect((byId.c4 as { error: string }).error).toMatch(/not permitted/);
    expect(results.some((r) => r.type === "event" && r.id === "c3")).toBe(true);
  });
});
