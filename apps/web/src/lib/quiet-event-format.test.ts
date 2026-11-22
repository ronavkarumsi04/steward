import { describe, expect, it } from "vitest";
import type { StewardEvent } from "./types";
import { quietActorLabel, quietEventTitle, quietEventSummary } from "./quiet-event-format";

const event = (over: Partial<StewardEvent> = {}): StewardEvent => ({
  id: "event-1", seq: 1, type: "run.status", createdAt: "2026-01-01T00:00:00Z",
  actor: { type: "agent", agentId: "agent-1" }, payload: { status: "waiting_approval" }, correlation: { runId: "run-1" }, ...over,
} as StewardEvent);

describe("Quiet activity language", () => {
  it("leads with a readable event and status while retaining the source event unchanged", () => {
    const source = event();
    expect(quietEventTitle(source)).toBe("Run updated");
    expect(quietEventSummary(source, "en")).toBe("Waiting for approval");
    expect(source.type).toBe("run.status");
    expect(source.payload.status).toBe("waiting_approval");
  });
  it("resolves current names, then recorded names, without presenting unknown ids as names", () => {
    expect(quietActorLabel(event().actor, [{ id: "agent-1", name: "Researcher" }])).toBe("Researcher");
    expect(quietActorLabel({ type: "agent", agentName: "Recorded name", agentId: "old" }, [])).toBe("Recorded name");
    expect(quietActorLabel(event().actor, [])).toBe("Agent name unavailable");
    expect(quietActorLabel({ type: "user" }, [])).toBe("Team member");
  });
  it("keeps meaningful API text and makes unknown event identifiers readable", () => {
    expect(quietEventSummary(event({ payload: { title: "Review the launch", status: "waiting_approval" } }), "en")).toBe("Review the launch");
    expect(quietEventTitle(event({ type: "sandbox.session_stopped" }))).toBe("Sandbox session stopped");
    expect(quietEventSummary(event({ payload: {} }), "en")).toBe("No additional details.");
  });
});
