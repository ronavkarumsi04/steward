import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { getMeOptional, getAuthConfig } from "@/lib/server";
import { landingArrival } from "@/lib/arrivals";
import { StewardMark } from "@/components/brand";
import { Icon } from "@/components/icons";
import { Pad } from "@/components/work-order/pad";
import { EntryForm } from "@/components/work-order/entry-form";
import s from "@/components/work-order/work-order.module.css";

export const metadata: Metadata = {
  title: { absolute: "Steward — Agents do the work. You keep the record." },
  description:
    "Steward is an operating system for AI-run companies. Every task becomes a work order: planned, budgeted, approved by you and filed with its evidence.",
};

const ARRIVAL = landingArrival();
const delay = (step: number) => ({ "--enter-delay": `${ARRIVAL.delayMs(step)}ms` }) as CSSProperties;

const PLAN = [
  ["Reproduce the rounding error on staging", "Done"],
  ["Patch the cart total and add a regression test", "Done"],
  ["Ship the fix", "Approved by you, 14:02"],
] as const;

const COPIES = [
  {
    id: "work",
    colour: "White copy",
    title: "The work",
    copy: "Agents plan before they act. The plan, every model call and every tool call are written onto the order as they happen.",
    rows: [
      ["Plan", "3 steps, written before any action"],
      ["Model calls", "6, with prompts and outputs kept"],
      ["Tools", "repo.read, repo.patch, browser.check"],
      ["Verified by", "Test output and a browser trace"],
    ],
  },
  {
    id: "approval",
    colour: "Canary copy",
    title: "The approval",
    copy: "You decide how far agents go. Set an autonomy level, cap budgets per category, and gate the steps that matter.",
    rows: [
      ["Autonomy", "Level 2 of 4: ask before anything ships"],
      ["Budget", "$5.00 per run, engineering"],
      ["Gate", "Deploys and outbound email wait for you"],
      ["Decision", "Approved, with the plan in front of you"],
    ],
  },
  {
    id: "record",
    colour: "Pink copy",
    title: "The record",
    copy: "Nothing happens off the books. The timeline, the cost and the approval that allowed each step stay on file, and cancel really stops a run.",
    rows: [
      ["14:01:12", "Plan accepted, run started"],
      ["14:01:40", "Patch written, tests passed"],
      ["14:02:05", "Approval granted by you"],
      ["Total", "$0.41, 9 calls, 0 retries"],
    ],
  },
] as const;

const DESKS = [
  ["Agents", "Seven per company: orchestrator, engineering, marketing, sales, support, research and finance, each with its own model routing, tools and budget."],
  ["Run Inspector", "Every run as a timeline: the plan, each model and tool call, what it cost and who approved it."],
  ["Site Studio", "A company website built from plain blocks, previewed by the same renderer that publishes it, with numbered versions."],
  ["Code IDE", "Your repository, read through your own GitHub connection. Steward keeps no copy of it."],
  ["Browser", "A real Chromium an agent can drive while you watch, limited to seven actions and stoppable mid-flight. The hosted beta reads pages over HTTP until its server gets a browser."],
  ["Workflows", "Standing work, drawn: a trigger, the agent that does it and the ceiling it works under."],
  ["Knowledge & memory", "Projects, decisions and documents in one graph, plus memories your team can review and correct."],
  ["MCP marketplace", "Install a Model Context Protocol server and see exactly what it may do before anything can call it."],
  ["Providers", "Bring your own keys for 25+ model provider families. Credentials are encrypted at rest."],
  ["Integrations", "GitHub, Slack, Stripe, Vercel, Resend and more, through OAuth or API keys."],
] as const;

const CONDITIONS = [
  ["Autonomy is yours to set.", "Each company runs at a level from 0 to 4, from suggest-only to act-and-report."],
  ["Consequential steps wait.", "Every tool carries a risk class; critical actions stop at an approval gate."],
  ["Budgets are ceilings.", "Spend is capped per category, so a run cannot quietly cost more than you allowed."],
  ["Cancel means stop.", "Cancelling interrupts in-flight model and tool calls and skips every later side effect."],
  ["Companies are sealed.", "Every query and background job carries an explicit organization and company scope."],
  ["Work survives restarts.", "Runs execute as durable Temporal workflows with retries, so a crash resumes the order."],
] as const;

export default async function Landing() {
  const [me, auth] = await Promise.all([getMeOptional(), getAuthConfig()]);
  if (me.user) redirect("/app");
  const open = auth?.signupOpen === true;
  const entry = open ? "/register" : "/login";
  const entryLabel = open ? "Create your company" : "Enter workspace";
  const entryNote = open
    ? "Free to start. Bring your own model keys."
    : auth
      ? "Hosted access is by invitation. Invited? Your link creates your account."
      : "We couldn't check hosted access right now. Sign in still works.";

  return (
    <Pad className={`paper ${s.home}`}>
      <a className={s.skip} href="#main">
        Skip to content
      </a>
      <header className={s.binding}>
        <nav className={s.bindingInner} aria-label="Primary">
          <Link href="/" className={s.brand} aria-label="Steward home">
            <StewardMark size={22} /> Steward
          </Link>
          <div className={s.navLinks}>
            <a href="#how">How it works</a>
            <a href="#workspace">The workspace</a>
            <a href="#conditions">Conditions</a>
            <Link href="/pricing">Pricing</Link>
            <Link href="/compare">Compare</Link>
          </div>
          <div className={s.navActions}>
            <Link href="/login" className={s.navSignIn}>
              Sign in
            </Link>
            {open ? (
              <Link href="/register" className={s.navCta}>
                Create your company
              </Link>
            ) : (
              <Link href="/login" className={s.navCta}>
                Enter workspace
              </Link>
            )}
          </div>
        </nav>
      </header>

      <main id="main" className={s.pad}>
        <section className={`${s.set} rise-in`} aria-labelledby="hero-title" data-hero>
          <div className={s.sheet}>
            <aside className={s.stub} aria-label="Order details">
              <p>
                <span className={s.fieldLabel}>No.</span>
                <span className={s.serial}>000412</span>
              </p>
              <p>
                <span className={s.fieldLabel}>Filed</span>
                <span className={s.carbon}>Oct 29</span>
              </p>
              <ul className={s.copyKey}>
                <li data-copy="work">White · the work</li>
                <li data-copy="approval">Canary · the approval</li>
                <li data-copy="record">Pink · the record</li>
              </ul>
              <StewardMark size={40} className={s.stubMark} />
            </aside>
            <div className={s.perf} aria-hidden="true" />
            <div className={s.body}>
              <div className={s.formHead}>
                <span>Work order</span>
                <span>Form STW-1 · An operating system for AI-run companies</span>
              </div>
              <h1 id="hero-title" className={`${s.h1} rise-in`} style={delay(1)}>
                Agents do the work. <span>You keep the record.</span>
              </h1>
              <p className={`${s.lede} rise-in`} style={delay(2)}>
                Steward runs your company’s engineering, marketing, sales and operations with AI agents. Every task becomes a work order: planned, budgeted, approved by you and filed with its evidence.
              </p>
              <div className={s.fieldsWrap}>
                <dl className={s.fields}>
                  <div className={`${s.field} ${s.span3}`}>
                    <dt className={s.fieldLabel}>Instruction</dt>
                    <dd className={s.carbon}>Fix the checkout bug before Friday’s launch, then tell me what changed.</dd>
                  </div>
                  <div className={s.field}>
                    <dt className={s.fieldLabel}>Assigned to</dt>
                    <dd className={s.carbon}>Engineering agent</dd>
                  </div>
                  <div className={`${s.field} ${s.span2} ${s.planField}`}>
                    <dt className={s.fieldLabel}>Plan</dt>
                    <dd>
                      <ol className={s.plan}>
                        {PLAN.map(([step, status]) => (
                          <li key={step}>
                            <span className={s.carbon}>{step}</span>
                            <span className={s.status}>{status}</span>
                          </li>
                        ))}
                      </ol>
                    </dd>
                  </div>
                  <div className={s.field}>
                    <dt className={s.fieldLabel}>Evidence</dt>
                    <dd className={s.carbon}>6 model calls, 3 tool calls, 1 browser trace</dd>
                  </div>
                  <div className={s.field}>
                    <dt className={s.fieldLabel}>Cost</dt>
                    <dd className={s.carbon}>$0.41 of a $5.00 budget</dd>
                  </div>
                </dl>
                <div className={s.stamp} aria-hidden="true">
                  <strong>Approved</strong>
                  <span>Oct 29 · by you</span>
                </div>
              </div>
              <EntryForm id="hero-email" action={entry} label={entryLabel} note={entryNote} />
              <p className={s.footnote}>Illustration of a Steward work order, not a live run. In the product, every step is recorded.</p>
            </div>
          </div>
        </section>

        <section id="how" className={s.leaf} aria-labelledby="how-title">
          <div className={s.leafHead}>
            <p className={s.kicker}>How a work order moves</p>
            <h2 id="how-title" className={s.h2}>
              Written once. <span>Filed three times.</span>
            </h2>
            <p className={s.sectionLede}>Pull any copy forward. Each one is a view of the same run, the way carbon copies are the same order.</p>
          </div>
          <div className={s.copyDesk}>
            <fieldset className={s.copyTabs}>
              <legend className={s.fieldLabel}>Show copy</legend>
              {COPIES.map((c) => (
                <label key={c.id} className={s.copyTab} data-copy={c.id}>
                  <input type="radio" name="copy" value={c.id} id={`copy-${c.id}`} defaultChecked={c.id === "work"} className={s.copyRadio} />
                  <span className={s.swatch} aria-hidden="true" />
                  <span>
                    <span className={s.copyTabColour}>{c.colour}</span>
                    {c.title}
                  </span>
                </label>
              ))}
            </fieldset>
            <div className={s.copies}>
              {COPIES.map((c, index) => (
                <article key={c.id} className={s.copy} data-copy={c.id} style={{ "--i": index } as CSSProperties} aria-labelledby={`copy-${c.id}-title`}>
                  <div className={s.copyHead}>
                    <span className={s.fieldLabel}>{c.colour} · No. 000412</span>
                  </div>
                  <h3 id={`copy-${c.id}-title`} className={s.h3}>
                    {c.title}
                  </h3>
                  <p>{c.copy}</p>
                  <dl className={s.copyRows}>
                    {c.rows.map(([k, v]) => (
                      <div key={k}>
                        <dt className={s.fieldLabel}>{k}</dt>
                        <dd className={s.carbon}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="workspace" className={s.leaf} aria-labelledby="workspace-title">
          <div className={s.leafHead}>
            <p className={s.kicker}>The order book</p>
            <h2 id="workspace-title" className={s.h2}>
              One workspace. <span>Every desk on it.</span>
            </h2>
            <p className={s.sectionLede}>What an agent can be handed, and where you inspect what it did.</p>
          </div>
          <table className={s.ledger}>
            <caption className={s.srOnly}>Desks in every Steward company</caption>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Desk</th>
                <th scope="col">What it does</th>
              </tr>
            </thead>
            <tbody>
              {DESKS.map(([desk, what], index) => (
                <tr key={desk}>
                  <td className={s.lineNo}>{String(index + 1).padStart(2, "0")}</td>
                  <th scope="row">{desk}</th>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={s.ledgerNote}>Hosted beta: accounts, organizations, workspaces and agent execution are live on our infrastructure. Bring your own model key; the first qualified default is NVIDIA's free tier.</p>
        </section>

        <section id="conditions" className={s.leaf} aria-labelledby="conditions-title">
          <div className={s.leafHead}>
            <p className={s.kicker}>Printed on the back of every order</p>
            <h2 id="conditions-title" className={s.h2}>
              Conditions. <span>Not fine print.</span>
            </h2>
          </div>
          <ol className={s.conditions}>
            {CONDITIONS.map(([title, copy]) => (
              <li key={title}>
                <h3 className={s.h3}>{title}</h3>
                <p>{copy}</p>
              </li>
            ))}
          </ol>
          <p className={s.imprint}>
            <span className={s.fieldLabel}>Built with</span> Next.js, Hono, Temporal, PostgreSQL with pgvector, Redis and Playwright.{" "}
            <a href="/api/v1/openapi.json">API reference</a>
          </p>
        </section>

        <section className={`${s.leaf} ${s.closing}`} aria-labelledby="closing-title">
          <div className={s.closingHead}>
            <span className={s.fieldLabel}>No.</span>
            <span className={s.serial}>000413</span>
          </div>
          <h2 id="closing-title" className={s.h2}>
            The next order is <span>yours to write.</span>
          </h2>
          <div className={s.blankInstruction} aria-hidden="true">
            <span className={s.fieldLabel}>Instruction</span>
            <span className={s.carbon}>Your first instruction goes here.</span>
          </div>
          <EntryForm id="closing-email" action={entry} label={entryLabel} note={entryNote} />
        </section>
      </main>

      <footer className={s.footer}>
        <span>Form STW-1 · © 2026 Steward. All rights reserved.</span>
        <nav aria-label="Footer">
          <Link href="/pricing">Pricing</Link>
          <Link href="/compare">Compare</Link>
          <Link href="/legal">Trust &amp; legal</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <a href="/api/v1/openapi.json">API reference</a>
          <Link href="/login">Sign in</Link>
          <a href="#main">
            Back to top <Icon.ArrowRight size={14} className={s.up} />
          </a>
        </nav>
      </footer>
    </Pad>
  );
}
