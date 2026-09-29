/**
 * What makes a memory worth keeping, tested without a database (ADR-0022).
 *
 * Every question here is a decision the product makes on its own — which run outcomes are kept, how long an
 * automatic memory lives, and how consequence and certainty combine in a ranking. They are pure so they can be
 * asserted directly rather than inferred from what a query happened to return.
 */
import { describe, expect, it } from "vitest";
import { AUTO_TTL_DAYS, confidenceBand, confidenceWeight, describeSource, earningRule, expiryFor, importanceWeight, scoreMemory, seedConfidence, sourceForActor } from "./earning.js";

describe("a run earns a place in memory, or it does not", () => {
  it("does not remember a happy run that changed nothing anyone can point at", () => {
    const decision = earningRule({ status: "succeeded", verification: { passed: true, verdict: "passed", followUps: [] } });
    expect(decision.remember).toBe(false);
  });

  it("remembers a passed run that produced follow-up work, at a confidence a run has earned", () => {
    const decision = earningRule({ status: "succeeded", verification: { passed: true, verdict: "passed", followUps: [{ title: "Email the customer" }] } });
    expect(decision).toMatchObject({ remember: true, kind: "episodic", confidence: 0.6, importance: 4, ttlDays: AUTO_TTL_DAYS });
  });

  it("remembers a failure, because it is the lesson nobody writes down by hand", () => {
    expect(earningRule({ status: "failed", verification: null })).toMatchObject({ remember: true, confidence: 0.5, importance: 3 });
  });

  it("remembers an unverified success and a run sent to review, until they are confirmed or lapse", () => {
    expect(earningRule({ status: "needs_review", verification: { verdict: "unverified", followUps: [] } }).remember).toBe(true);
    expect(earningRule({ status: "succeeded", verification: { verdict: "unverified", followUps: [] } }).remember).toBe(true);
  });

  it("never remembers a cancelled run", () => {
    expect(earningRule({ status: "cancelled", verification: null }).remember).toBe(false);
  });

  it("never lets a passed bit with an unverified verdict count as a clean pass", () => {
    // The verdict is the reviewer's word; a record that says "passed" without saying so grants nothing.
    const decision = earningRule({ status: "succeeded", verification: { passed: true, verdict: "unverified", followUps: [] } });
    expect(decision.remember).toBe(true);
    expect(decision).toMatchObject({ confidence: 0.5, importance: 3 });
  });
});

describe("certainty follows the door the memory came through", () => {
  it("seeds confidence from who is saying so", () => {
    expect(seedConfidence("user")).toBeGreaterThan(seedConfidence("agent"));
    expect(seedConfidence("agent")).toBeGreaterThan(seedConfidence("auto"));
  });

  it("gives an automatic memory a life and a deliberate one none", () => {
    expect(expiryFor("user")).toBeNull();
    expect(expiryFor("agent")).toBeNull();
    const auto = expiryFor("auto", new Date("2026-01-01T00:00:00Z"))!;
    expect(auto.getTime() - Date.parse("2026-01-01T00:00:00Z")).toBe(AUTO_TTL_DAYS * 86_400_000);
  });

  it("names the source in a sentence a founder can read", () => {
    expect(describeSource("user")).toContain("founder");
    expect(describeSource("agent")).toContain("agent");
    expect(describeSource("auto")).toContain("run");
  });

  it("reads an actor as a source", () => {
    expect(sourceForActor({ type: "user", userId: "u1" })).toBe("user");
    expect(sourceForActor({ type: "agent", agentId: "a1" })).toBe("agent");
    expect(sourceForActor({ type: "system", component: "x" })).toBe("auto");
  });
});

describe("consequence and certainty, multiplied rather than confused", () => {
  it("bands importance on the column's own 1–10 scale", () => {
    expect(importanceWeight(10)).toBeGreaterThan(importanceWeight(5));
    expect(importanceWeight(5)).toBeGreaterThan(importanceWeight(1));
    // A consequence at the top of the scale is strictly heavier than the same words at the bottom.
    expect(importanceWeight(1)).toBeLessThan(importanceWeight(3));
    // 1 and 2 are the same band on purpose: five bands across ten points, not ten opinions.
    expect(importanceWeight(1)).toBe(importanceWeight(2));
  });

  it("down-weights an unsure memory without erasing it", () => {
    expect(confidenceWeight(1)).toBeGreaterThan(confidenceWeight(0.5));
    expect(confidenceWeight(0)).toBeGreaterThan(0);
  });

  it("bands a confidence the way a badge prints it", () => {
    expect(confidenceBand(0.9)).toBe("confident");
    expect(confidenceBand(0.7)).toBe("probable");
    expect(confidenceBand(0.3)).toBe("uncertain");
  });

  it("lets a confident, consequential fact outrank a shaky one with the same words", () => {
    const now = Date.parse("2026-09-28T00:00:00Z");
    const createdAt = new Date(now);
    const strong = scoreMemory({ rrf: 0.02, importance: 10, confidence: 1, createdAt, now });
    const weak = scoreMemory({ rrf: 0.02, importance: 2, confidence: 0.3, createdAt, now });
    expect(strong).toBeGreaterThan(weak);
  });

  it("nudges a newer memory above an older one with the same claim", () => {
    const now = Date.parse("2026-09-28T00:00:00Z");
    const fresh = scoreMemory({ rrf: 0.02, importance: 6, confidence: 0.7, createdAt: new Date(now), now });
    const old = scoreMemory({ rrf: 0.02, importance: 6, confidence: 0.7, createdAt: new Date(now - 2000 * 86_400_000), now });
    expect(fresh).toBeGreaterThan(old);
  });
});
