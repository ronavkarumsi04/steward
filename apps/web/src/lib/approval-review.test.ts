import { describe, expect, it } from "vitest";
import { diffPayload, lapseLabel, mostUrgent, payloadFacts, reviewApproval, splitReason } from "./approval-review";
import type { Approval, Run } from "./types";

/**
 * The decision brief is what a founder reads before saying yes to an irreversible thing. These tests pin the
 * honesty rules: policy text is quoted rather than paraphrased, nothing is inferred that the rows do not
 * record, and a decision that cannot do what it appears to do says so.
 */
const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function approval(over: Partial<Approval> & { id: string }): Approval {
  return {
    runId: null,
    taskId: null,
    agentId: "agent-1",
    action: "deploy.create_deployment",
    reason: "prod_deploy actions require approval at autonomy level 3",
    payload: { projectId: "site_1", production: true },
    risk: "HIGH",
    dimension: "prod_deploy",
    estimatedCostUsd: null,
    affectedSystem: "vercel",
    alternatives: [],
    status: "pending",
    resolvedBy: null,
    resolution: null,
    resolvedAt: null,
    expiresAt: iso(86_400_000),
    createdAt: iso(-3_600_000),
    workflowId: "wf-1",
    ...over,
  };
}

function run(over: Partial<Run> & { id: string }): Run {
  return {
    agentId: "agent-1",
    taskId: null,
    projectId: null,
    conversationId: null,
    trigger: {},
    status: "waiting_approval",
    intent: "",
    plan: null,
    result: null,
    error: null,
    workflowId: "wf-1",
    costUsd: "0",
    inputTokens: 0,
    outputTokens: 0,
    iterations: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: iso(-3_600_000),
    ...over,
  };
}

describe("splitting a stored request reason", () => {
  it("treats a policy sentence as the reason and leaves the narrative empty", () => {
    expect(splitReason("CRITICAL-risk actions always require human approval")).toEqual({
      narrative: null,
      policy: ["CRITICAL-risk actions always require human approval"],
    });
  });

  it("splits the runtime's edit form into the edit detail and the policy line", () => {
    const { narrative, policy } = splitReason("approver edited the payload (MEDIUM risk unchanged); policy: payments actions require approval at autonomy level 3");
    expect(narrative).toBe("approver edited the payload (MEDIUM risk unchanged)");
    expect(policy).toEqual(["payments actions require approval at autonomy level 3"]);
  });

  it("labels an agent's request as one, so an edit is never shown as something the agent asked for", () => {
    const asked = reviewApproval(approval({ id: "a18", reason: "Send launch email" }), { now: NOW });
    expect(asked.request.narrativeKind).toBe("agent_request");
    expect(asked.edited).toBe(false);
    expect(asked.request.narrative).toBe("Send launch email");
  });

  it("renders a dollar-named field as dollars and nothing else as currency", () => {
    expect(payloadFacts({ amountUsd: 420.5 }).facts[0]).toEqual({ label: "Money", value: "$420.50", source: "payload" });
    // `amount` never claims a currency, so it is shown as the payload wrote it.
    expect(payloadFacts({ amount_cents: 42050 }).facts[0]).toEqual({ label: "Money", value: "42050", source: "payload" });
  });

  it("names the money in the payload when no cost estimate was recorded", () => {
    const brief = reviewApproval(approval({ id: "a19", dimension: "payments", payload: { amountUsd: 420.5 } }), { now: NOW });
    expect(brief.blast.find((b) => b.label === "Money at stake")).toEqual({
      label: "Money at stake",
      value: "the payload itself names $420.50; no cost estimate was recorded with the request",
      source: "payload",
    });
  });

  it("keeps an agent's own words as the narrative when no rule is recognisable", () => {
    expect(splitReason("Send launch email")).toEqual({ narrative: "Send launch email", policy: [] });
  });

  it("keeps unseen policy wording as the policy line rather than mistaking it for narrative", () => {
    const { narrative, policy } = splitReason("approver edited the payload; policy: a rule this build has never seen");
    expect(narrative).toBe("approver edited the payload");
    expect(policy).toEqual(["a rule this build has never seen"]);
  });

  it("uses the last marker, so a narrative that quotes one cannot truncate the policy line", () => {
    const { narrative, policy } = splitReason("agent noted '; policy: ' in its text; policy: Hourly limit of 20 email_send actions reached");
    expect(narrative).toBe("agent noted '; policy: ' in its text");
    expect(policy).toEqual(["Hourly limit of 20 email_send actions reached"]);
  });
});

describe("decoding a payload", () => {
  it("reads the fields a person checks: who, what, how much, where", () => {
    const { facts } = payloadFacts({ to: "founder@acme.com", replyTo: "team@acme.com", subject: "Launch", amountUsd: 250, production: true, repo: "acme/site" });
    expect(facts).toEqual([
      { label: "Recipients", value: "founder@acme.com", source: "payload" },
      { label: "Replies go to", value: "team@acme.com", source: "payload" },
      { label: "Subject", value: "Launch", source: "payload" },
      { label: "Money", value: "$250.00", source: "payload" },
      { label: "Production", value: "yes", source: "payload" },
      { label: "Code", value: "acme/site", source: "payload" },
    ]);
  });

  it("summarises lists by size with a sample, and never dumps them", () => {
    const { facts } = payloadFacts({ to: ["a@x.com", "b@x.com", "c@x.com", "d@x.com"], ids: [1, 2] });
    expect(facts[0]!.value).toBe("4 items: a@x.com, b@x.com, c@x.com…");
    expect(facts[1]!.value).toBe("2 items: 1, 2");
  });

  it("counts the fields it did not decode instead of hiding them", () => {
    const decoded = payloadFacts({ to: "a@x.com", internalNote: "x", correlationId: "y" });
    expect(decoded.fields).toBe(3);
    expect(decoded.unmapped).toBe(2);
  });

  it("handles an empty payload", () => {
    expect(payloadFacts({})).toEqual({ facts: [], fields: 0, unmapped: 0 });
  });
});

describe("the brief", () => {
  it("labels the rule that stopped the action and quotes it verbatim", () => {
    const brief = reviewApproval(approval({ id: "a1", reason: "Estimated cost $250.00 exceeds per-action limit $100" }), { now: NOW });
    expect(brief.request.policy).toEqual([{ code: "per_action_cost", sentence: "Estimated cost $250.00 exceeds per-action limit $100" }]);
    expect(brief.request.narrative).toBeNull();
    expect(brief.request.unclassified).toEqual([]);
  });

  it("keeps both halves of an edit-triggered request", () => {
    const brief = reviewApproval(
      approval({ id: "a2", reason: "approver edited the payload and risk rose MEDIUM → HIGH; policy: HIGH risk exceeds the auto-approve threshold (MEDIUM)" }),
      { now: NOW },
    );
    expect(brief.edited).toBe(true);
    expect(brief.request.narrative).toBe("approver edited the payload and risk rose MEDIUM → HIGH");
    expect(brief.request.narrativeKind).toBe("payload_edit");
    expect(brief.request.policy.map((p) => p.code)).toEqual(["risk_ceiling"]);
  });

  it("says when the run is already over instead of offering a decision that cannot resume it", () => {
    const brief = reviewApproval(approval({ id: "a3", runId: "run-abcdef123456" }), { run: run({ id: "run-abcdef123456", status: "failed" }), now: NOW });
    expect(brief.cautions.join(" ")).toContain("Run run-abcd is failed");
    expect(brief.effect.approve).toContain("Nothing resumes");
    expect(brief.effect.deny).toContain("Nothing changes");
  });

  it("describes the real effect when the run is genuinely waiting", () => {
    const brief = reviewApproval(approval({ id: "a4", runId: "run-abcdef123456" }), { run: run({ id: "run-abcdef123456" }), now: NOW });
    expect(brief.cautions).toEqual([]);
    expect(brief.effect.approve).toContain("resumes");
    expect(brief.effect.approve).toContain("schema");
    expect(brief.effect.deny).toContain("skipped");
  });

  it("says a request with no workflow cannot resume anything", () => {
    const brief = reviewApproval(approval({ id: "a5", workflowId: null }), { now: NOW });
    expect(brief.cautions.some((c) => c.includes("not attached to a workflow"))).toBe(true);
    expect(brief.effect.approve).toContain("no workflow to resume");
  });

  it("flags a lapsed request that is still pending, and the fact that it can still be decided", () => {
    const brief = reviewApproval(approval({ id: "a6", expiresAt: iso(-4 * 60 * 60 * 1000) }), { now: NOW });
    expect(brief.expiry.lapsed).toBe(true);
    expect(brief.expiry.label).toBe("4h 0m past");
    expect(brief.cautions.some((c) => c.includes("still pending"))).toBe(true);
  });

  it("admits when it could not load the run rather than implying the run is fine", () => {
    const brief = reviewApproval(approval({ id: "a7", runId: "run-1" }), { now: NOW });
    expect(brief.cautions.some((c) => c.includes("was not loaded on this page"))).toBe(true);
  });

  it("states where each blast-radius line came from, and never invents reversibility", () => {
    const brief = reviewApproval(approval({ id: "a8", estimatedCostUsd: "12.5000", alternatives: ["Deploy a preview first"] }), { now: NOW });
    const byLabel = Object.fromEntries(brief.blast.map((b) => [b.label, b]));
    expect(byLabel["System that changes"]).toEqual({ label: "System that changes", value: "vercel", source: "the request" });
    expect(byLabel["Kind of change"]!.value).toContain("production deployment");
    expect(byLabel["Money at stake"]!.value).toBe("up to $12.50 — the estimate recorded when this was requested");
    expect(byLabel["Reversible"]).toMatchObject({ source: "not recorded" });
    expect(byLabel["Alternatives the agent offered"]!.value).toBe("Deploy a preview first");
  });

  it("reads reversibility out of the payload only when the payload declares it", () => {
    const brief = reviewApproval(approval({ id: "a9", payload: { dryRun: true } }), { now: NOW });
    const line = brief.blast.find((b) => b.label === "Reversible")!;
    expect(line.source).toBe("payload");
    expect(line.value).toContain("dry run: yes");
  });

  it("says a cost estimate is missing instead of implying it is free", () => {
    const brief = reviewApproval(approval({ id: "a10" }), { now: NOW });
    expect(brief.blast.find((b) => b.label === "Money at stake")).toEqual({
      label: "Money at stake",
      value: "No cost estimate was recorded on this request",
      source: "not recorded",
    });
  });

  it("reports who is reached, and admits when the payload does not say", () => {
    const withList = reviewApproval(approval({ id: "a11", dimension: "email_send", payload: { to: ["a@x.com", "b@x.com"] } }), { now: NOW });
    expect(withList.blast.find((b) => b.label === "People affected")!.value).toContain("2 items");
    const without = reviewApproval(approval({ id: "a12", dimension: "email_send", payload: { subject: "hi" } }), { now: NOW });
    expect(without.blast.find((b) => b.label === "People affected")!.value).toContain("no recipient or audience field");
  });

  it("surfaces the run it belongs to, and stays silent when there is none", () => {
    const brief = reviewApproval(approval({ id: "a13", runId: "run-abcdef123456" }), { run: run({ id: "run-abcdef123456" }), now: NOW });
    expect(brief.blast.find((b) => b.label === "Run waiting on this")!.value).toBe("run run-abcd · waiting approval");
    expect(reviewApproval(approval({ id: "a14" }), { now: NOW }).blast.some((b) => b.label === "Run waiting on this")).toBe(false);
  });

  it("warns when a run has moved on without the approval", () => {
    const brief = reviewApproval(approval({ id: "a15", runId: "run-x" }), { run: run({ id: "run-x", status: "executing" }), now: NOW });
    expect(brief.cautions.some((c) => c.includes("not waiting for approval"))).toBe(true);
  });

  it("flags policy wording it does not know instead of dropping it", () => {
    const brief = reviewApproval(approval({ id: "a16", reason: "approver edited the payload; policy: a rule from a newer engine" }), { now: NOW });
    expect(brief.request.policy[0]!.code).toBe("unknown");
    expect(brief.request.unclassified).toEqual(["a rule from a newer engine"]);
    expect(brief.cautions.some((c) => c.includes("does not match any rule"))).toBe(true);
  });

  it("never dresses an unrecognised sentence up as a policy rule", () => {
    const brief = reviewApproval(approval({ id: "a17", reason: "a rule from a newer engine" }), { now: NOW });
    expect(brief.request.policy).toEqual([]);
    expect(brief.request.narrative).toBe("a rule from a newer engine");
    expect(brief.cautions).toEqual([]);
  });

  it("accepts the engine's own sentences for every rule family", () => {
    const sentences = [
      "CRITICAL-risk actions always require human approval",
      "Hourly limit of 20 email_send actions reached",
      "Daily limit of 100 email_send actions reached",
      "Estimated cost $250.00 exceeds per-action limit $100",
      "Daily infra_spend budget $100 would be exceeded",
      "Monthly infra_spend budget $500 would be exceeded",
      "Quiet hours are active for outbound communication",
      "ad_spend actions require approval at autonomy level 3",
      "HIGH risk exceeds the auto-approve threshold (MEDIUM)",
      "Allowed by policy (HIGH ≤ HIGH)",
      "LOW risk is within the auto-approve threshold (MEDIUM)",
      "Outbound communications are paused for this company",
    ];
    for (const sentence of sentences) {
      const brief = reviewApproval(approval({ id: `s-${sentence.length}`, reason: sentence }), { now: NOW });
      expect(brief.request.narrative).toBeNull();
      expect(brief.request.policy[0]!.code, sentence).not.toBe("unknown");
    }
  });
});

describe("picking the request to put in front of the founder", () => {
  it("takes the one closest to lapsing, not the newest", () => {
    const soon = approval({ id: "soon", expiresAt: iso(60_000), createdAt: iso(-1000) });
    const later = approval({ id: "later", expiresAt: iso(86_400_000), createdAt: iso(-60_000) });
    expect(mostUrgent([later, soon])!.id).toBe("soon");
  });

  it("breaks a shared deadline with the oldest request, and ignores resolved rows", () => {
    const first = approval({ id: "first", createdAt: iso(-7_200_000) });
    const second = approval({ id: "second", createdAt: iso(-3_600_000) });
    const settled = approval({ id: "settled", status: "approved", createdAt: iso(-99_999_999), expiresAt: iso(1) });
    expect(mostUrgent([second, settled, first])!.id).toBe("first");
    expect(mostUrgent([settled])).toBeNull();
    expect(mostUrgent([])).toBeNull();
  });

  it("does not treat an unreadable deadline as urgent", () => {
    const broken = approval({ id: "broken", expiresAt: "not a date", createdAt: iso(-1_000) });
    const dated = approval({ id: "dated", expiresAt: iso(86_400_000) });
    expect(mostUrgent([broken, dated])!.id).toBe("dated");
  });
});

describe("lapse labels", () => {
  it("keeps the unit that matters and never prints a bare zero", () => {
    expect(lapseLabel(3 * 60 * 60 * 1000 + 20 * 60 * 1000)).toBe("in 3h 20m");
    expect(lapseLabel(-4 * 60 * 1000)).toBe("4m past");
    expect(lapseLabel(0)).toBe("0s past");
    expect(lapseLabel(3 * 86_400_000 + 4 * 3_600_000)).toBe("in 3d 4h");
    expect(lapseLabel(45_000)).toBe("in 45s");
  });
});

describe("payload diffs", () => {
  it("names what an approver changed, added and removed", () => {
    const diff = diffPayload({ to: "a@x.com", subject: "Hi", amount: 10 }, { to: "b@x.com", amount: 10, cc: "c@x.com" });
    expect(diff).toEqual({ added: ["cc"], removed: ["subject"], changed: ["to"], total: 3 });
  });

  it("counts a nested change as one changed key, and an identical payload as nothing at all", () => {
    expect(diffPayload({ meta: { a: 1 } }, { meta: { a: 2 } }).total).toBe(1);
    expect(diffPayload({ a: 1 }, { a: 1 }).total).toBe(0);
  });

  it("treats a missing key and an explicit null as the same absence", () => {
    expect(diffPayload({ a: null }, {}).total).toBe(0);
    expect(diffPayload({}, { a: null }).total).toBe(0);
  });
});
