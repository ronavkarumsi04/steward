import Link from "next/link";
import type { Metadata } from "next";
import { PublicFrame, publicEntry } from "@/components/work-order/public-frame";
import s from "@/components/work-order/work-order.module.css";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Steward bills nothing during the hosted beta. Bring your own model keys; every run shows what it cost against the budget you set.",
  alternates: { canonical: "/pricing" },
};

const RATES: { id: string; tone?: "canary" | "pink"; name: string; price: string; unit: string; note: string; lines: { text: string; soon?: boolean }[] }[] = [
  {
    id: "hosted",
    tone: "canary",
    name: "Hosted beta",
    price: "$0",
    unit: "per month, while in beta",
    note: "Everything in the product, on our infrastructure.",
    lines: [
      { text: "Every desk: engineering, marketing, sales, operations, chief of staff." },
      { text: "Your own model keys, encrypted with a key only your deployment holds." },
      { text: "Approvals, per-run budgets, a cancel that stops, the run inspector." },
      { text: "Site Studio, Code IDE on your GitHub, workflows, MCP; the watched browser on self-hosted stacks." },
      { text: "Organizations are isolated from each other; invite your own team." },
    ],
  },
  {
    id: "models",
    name: "Model usage",
    price: "List price",
    unit: "paid to your provider, not to us",
    note: "No markup, no credits, no conversion rate.",
    lines: [
      { text: "25+ providers: NVIDIA NIM, OpenAI, Anthropic, Google, Mistral, Groq, local." },
      { text: "Each run is metered: model calls, tokens and cost appear on its record." },
      { text: "A budget is a ceiling. The run stops at it; nothing continues on credit." },
      { text: "Free tiers work. Our hosted qualification runs on NVIDIA's cost $0.00." },
    ],
  },
  {
    id: "later",
    tone: "pink",
    name: "Paid hosting",
    price: "Not set",
    unit: "published here first",
    note: "When hosted plans arrive, every beta account hears before anything is charged.",
    lines: [
      { text: "Steward keeps no card on file in beta. There is nothing to charge." },
      { text: "Model costs stay yours and stay at list price, on every plan.", soon: true },
      { text: "Your documents, decisions and run ledgers leave with you via the API.", soon: true },
    ],
  },
];

const LEDGER: [string, string, string][] = [
  ["Monthly fee", "$0 while in beta", "$0 to $200 a month"],
  ["Model usage", "Your provider's list price, metered per run", "15 to 2,500 credits a month, included"],
  ["Who holds the keys", "You. Encrypted, revocable, swappable per provider.", "The platform"],
  ["Spend control", "A budget per run, with a hard stop", "A per-run budget on paid plans"],
  ["Companies", "No set limit in beta", "1, 3 or 10 depending on plan"],
  ["Seeing what a run cost", "Every model and tool call, on the record", "Credits deducted"],
];

const CONDITIONS: [string, string][] = [
  ["No markup on models", "Your key, your provider's price. Steward never sits between you and the invoice."],
  ["Budgets are ceilings", "A run that reaches its budget stops and asks. Nothing carries on against a balance."],
  ["Cancel stops", "A cancelled run halts within seconds and its remaining actions are skipped, email included."],
  ["The record is yours", "Documents, decisions and run ledgers are exportable through the API at any time."],
  ["Nothing is charged automatically", "There is no card on file in beta. Paid plans, when they exist, start only when you choose one."],
  ["Honest comparison", "Competitor figures on this page come from their public pricing pages and are dated. Tell us if they move."],
];

export default async function Pricing() {
  const entry = await publicEntry();
  return (
    <PublicFrame current="pricing">
      <section className={`${s.leaf} ${s.first} rise-in`} aria-labelledby="pricing-title">
        <div className={s.leafHead}>
          <p className={s.kicker}>Rate card · Form STW-2</p>
          <h1 id="pricing-title" className={s.h1}>
            Pay for models. <span>Not for a middleman.</span>
          </h1>
          <p className={s.lede}>
            Steward bills nothing during the hosted beta. You bring your own provider keys, each run shows what it cost against the budget you set, and the money goes to the provider at their list price.
          </p>
        </div>
        <div className={s.rates}>
          {RATES.map((r) => (
            <article key={r.id} className={s.rate} data-tone={r.tone} aria-labelledby={`rate-${r.id}`}>
              <div className={s.rateHead}>
                <span className={s.fieldLabel}>{r.name}</span>
                <span className={s.fieldLabel}>No. 0004{RATES.indexOf(r) + 14}</span>
              </div>
              <p className={s.ratePrice} id={`rate-${r.id}`}>
                {r.price}
                <small>{r.unit}</small>
              </p>
              <p className={s.rateNote}>{r.note}</p>
              <ul className={s.rateList}>
                {r.lines.map((l) => (
                  <li key={l.text} data-soon={l.soon ? "" : undefined}>
                    <span>{l.text}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <p className={s.ledgerNote}>
          Hollow bullets are commitments about what paid hosting will keep, not features that exist today.{" "}
          {entry.open ? (
            <>
              <Link href={entry.href}>{entry.label}</Link> to start on the hosted beta.
            </>
          ) : entry.state === "closed" ? (
            <>
              The hosted beta is by invitation right now; <Link href={entry.href}>{entry.label.toLowerCase()}</Link> if you have one.
            </>
          ) : (
            <>
              We couldn't check hosted access just now; <Link href={entry.href}>{entry.label.toLowerCase()}</Link> still works.
            </>
          )}
        </p>
      </section>

      <section className={s.leaf} aria-labelledby="ledger-title">
        <div className={s.leafHead}>
          <p className={s.kicker}>Side by side</p>
          <h2 id="ledger-title" className={s.h2}>
            Credits, or <span>your own keys.</span>
          </h2>
          <p className={s.sectionLede}>
            Foundable sells credits in tiers. Steward meters your own provider. Figures from foundable.app/pricing on 3 November 2026.
          </p>
        </div>
        <table className={`${s.ledger} ${s.brands}`}>
          <caption className={s.srOnly}>Steward and Foundable pricing, line by line</caption>
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col">Item</th>
              <th scope="col">Steward</th>
              <th scope="col">Foundable</th>
            </tr>
          </thead>
          <tbody>
            {LEDGER.map(([item, ours, theirs], index) => (
              <tr key={item}>
                <td className={s.lineNo}>{String(index + 1).padStart(2, "0")}</td>
                <th scope="row">{item}</th>
                <td className={s.carbon} data-brand="Steward">{ours}</td>
                <td data-brand="Foundable">{theirs}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={s.ledgerNote}>
          Polsia does not publish a price list we could cite. <Link href="/compare">Compare features</Link> instead.
        </p>
      </section>

      <section className={`${s.leaf} ${s.closing}`} aria-labelledby="pricing-conditions-title">
        <div className={s.leafHead}>
          <p className={s.kicker}>Printed on the back</p>
          <h2 id="pricing-conditions-title" className={s.h2}>
            Conditions of <span>the rate card.</span>
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
      </section>
    </PublicFrame>
  );
}
