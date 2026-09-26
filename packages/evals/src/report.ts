/**
 * The scorecard.
 *
 * A score is only useful if it says what it is a score *of*. Every report therefore names the model backend,
 * the run behind each case, and the exact rows each check read — and it states plainly what the number does
 * not cover: a suite driven by a scripted backend scores the system's rules, not a model's judgement. Reading
 * it the other way round is the failure mode this report exists to prevent.
 */
import type { CaseResult, CheckStatus, Scorecard } from "./types.js";

const MARK: Record<CheckStatus, string> = { pass: "✓", fail: "✗", unverified: "?" };

const isScripted = (provider: string) => /stub|scripted/i.test(provider);

function headline(card: Scorecard): string {
  const { total, pass, fail, unverified } = card.summary;
  const parts = [`${pass}/${total} cases passed`];
  if (fail) parts.push(`${fail} failed`);
  if (unverified) parts.push(`${unverified} unverified`);
  return parts.join(" · ");
}

function caveat(card: Scorecard): string {
  if (isScripted(card.provider)) {
    return `Backend: ${card.provider} — a scripted provider. These results prove the rules hold (gates, budgets, verdicts, the trail); they say nothing about model quality.`;
  }
  return `Backend: ${card.provider} — a live provider. These results score both the rules and the model's judgement on these tasks.`;
}

export function renderScorecard(card: Scorecard, opts: { format?: "text" | "markdown" } = {}): string {
  const format = opts.format ?? "text";
  const lines: string[] = [];
  const md = format === "markdown";
  const push = (line = "") => lines.push(line);

  if (md) {
    push("### Agent evals");
    push();
    push(`**${headline(card)}**`);
    push();
    push(caveat(card));
    push();
    push(`| agent | cases | pass | fail | unverified | verified successes | stopped for a human | mean cost |`);
    push("|---|---|---|---|---|---|---|---|");
    for (const a of card.byAgent) {
      push(`| ${a.agentKind} | ${a.cases} | ${a.pass} | ${a.fail} | ${a.unverified} | ${a.verifiedSuccesses} | ${a.stoppedForAHuman} | $${a.meanCostUsd.toFixed(4)} |`);
    }
    push();
    for (const c of card.cases) push(...caseLines(c, "markdown"));
  } else {
    push("AGENT EVALS");
    push(headline(card));
    push(caveat(card));
    push();
    push("per agent");
    for (const a of card.byAgent) {
      push(`  ${a.agentKind.padEnd(14)} ${a.cases} case(s) · ${a.pass} pass · ${a.fail} fail · ${a.unverified} unverified · ${a.verifiedSuccesses} verified success(es) · ${a.stoppedForAHuman} stopped for a human · mean $${a.meanCostUsd.toFixed(4)}`);
    }
    push();
    for (const c of card.cases) push(...caseLines(c, "text"));
  }
  return lines.join("\n");
}

function caseLines(c: CaseResult, format: "text" | "markdown"): string[] {
  const out: string[] = [];
  const heading = `${MARK[c.status]} ${c.id} — ${c.title}`;
  if (format === "markdown") {
    out.push(`<details><summary>${heading}</summary>`);
    out.push();
    out.push(`> ${c.proves}`);
    out.push();
    out.push(`run \`${c.runId}\` · backend \`${c.provider}\``);
    out.push();
    for (const check of c.checks) out.push(`- ${MARK[check.status]} **${check.name}** — ${check.detail}`);
    if (c.note) out.push(`- ! ${c.note}`);
    out.push();
    out.push("</details>");
    out.push();
    return out;
  }
  out.push(`${heading}   run ${c.runId.slice(0, 8)}`);
  out.push(`    proves: ${c.proves}`);
  for (const check of c.checks) out.push(`    ${MARK[check.status]} ${check.name} — ${check.detail}`);
  if (c.note) out.push(`    ! ${c.note}`);
  out.push();
  return out;
}

/** True when nothing failed and nothing was left unchecked — the only shape of "green" this suite recognises. */
export function isGreen(card: Scorecard): boolean {
  return card.summary.fail === 0 && card.summary.unverified === 0 && card.summary.total > 0;
}
