import Link from "next/link";
import type { Metadata } from "next";
import { PublicFrame, publicEntry } from "@/components/work-order/public-frame";
import s from "@/components/work-order/work-order.module.css";

export const metadata: Metadata = {
  title: "Compare: Steward vs Foundable vs Polsia",
  description:
    "What Steward, Foundable and Polsia each do when AI agents run a company, line by line, including where Steward is not there yet.",
  alternates: { canonical: "/compare" },
};

type Mark = "yes" | "part" | "no" | "none";
type Cell = { v: Mark; note?: string };
const yes = (note?: string): Cell => ({ v: "yes", note });
const part = (note?: string): Cell => ({ v: "part", note });
const notYet = (note?: string): Cell => ({ v: "no", note });
const none = (note?: string): Cell => ({ v: "none", note });

const BRANDS = ["Steward", "Foundable", "Polsia"] as const;
const LABEL: Record<Mark, string> = { yes: "Yes", part: "Partly", no: "Not yet", none: "Not offered" };

const ROWS: { item: string; detail?: string; cells: [Cell, Cell, Cell] }[] = [
  { item: "Idea in, first deliverables out", detail: "Positioning, brand brief, landing copy, a decision and week-one tasks, in one run.", cells: [yes("Launch kit on company creation"), yes("Site, logo and email in minutes"), part("Builds a roadmap")] },
  { item: "A live website from the idea", cells: [yes("Site Studio; connect your own domain"), yes("Buys a domain in-app"), none()] },
  { item: "Logo generation", cells: [notYet(), yes(), none()] },
  { item: "Brand kit used everywhere", detail: "Tagline, voice, colour, type and mark, read by the site and every agent.", cells: [yes(), yes(), none()] },
  { item: "Asks before anything goes public", detail: "Email, posts, texts, deploys and spend wait for a decision, as themselves.", cells: [yes("Every outbound action, editable"), yes(), none("Sells running while you sleep")] },
  { item: "A budget per run, with a hard stop", cells: [yes(), part("Per-run budget on paid plans"), none()] },
  { item: "Cancel that stops the run", detail: "Remaining actions are skipped, email included.", cells: [yes("Within seconds"), none(), none()] },
  { item: "Run inspector", detail: "Every model call, tool call and cost on the record, with a verifier that reads the evidence.", cells: [yes(), none(), none()] },
  { item: "Your own model keys", detail: "25+ providers, including free tiers and local models.", cells: [yes(), none("Credits only"), none()] },
  { item: "Code changes on your own GitHub", detail: "Diff sessions, pull requests, a sandbox that runs the tests.", cells: [yes(), none(), part("Claims to ship code")] },
  { item: "Watched browser automation", detail: "A real browser you can see, with a closed set of actions.", cells: [part("Self-hosted with Chromium; the hosted beta reads pages over HTTP"), none(), none()] },
  { item: "Outreach drafted and queued", detail: "Email, X and LinkedIn posts, texts.", cells: [yes("Outbox with Send, Don't send, Edit"), yes("Outreach, posts with pictures"), yes("Tweets, replies, deals")] },
  { item: "Pictures, decks and spreadsheets", cells: [part("Decks and sheets, typed and totalled; pictures next"), yes(), none()] },
  { item: "Text your agent by SMS", cells: [notYet("Phone inbox with push notifications today; SMS next"), yes("Pro plan phone number"), none()] },
  { item: "Workflows and reactions", detail: "Scheduled and event-driven runs you can read and edit.", cells: [yes(), part("Runs alone on paid plans"), yes("Autonomous by default")] },
  { item: "Integrations", cells: [yes("MCP marketplace with allowlists and risk levels"), part("Gmail, Calendar, Sheets, Slack, Notion, HubSpot, Stripe"), none()] },
  { item: "Memory you can correct", detail: "Durable memory and a knowledge graph with revision history.", cells: [yes(), none(), none()] },
  { item: "Interface in your language", cells: [part("English and Spanish; more pages each release"), none(), yes()] },
  { item: "Separate organizations", cells: [yes("Isolated per organization; no set limit in beta"), part("1, 3 or 10 businesses by plan"), yes("Thousands of companies")] },
  { item: "Price", cells: [yes("$0 in beta; models at list price"), part("$0 to $200 a month in credits"), none("No public price list")] },
];

export default async function Compare() {
  const entry = await publicEntry();
  return (
    <PublicFrame current="compare">
      <section className={`${s.leaf} ${s.first} rise-in`} aria-labelledby="compare-title">
        <div className={s.leafHead}>
          <p className={s.kicker}>Side by side · Form STW-3</p>
          <h1 id="compare-title" className={s.h1}>
            Three ways to run a company on agents. <span>One keeps the record.</span>
          </h1>
          <p className={s.lede}>
            Foundable gives you Ted, an AI employee who builds the site and runs outreach. Polsia sells one agent in every role, working while you sleep. Steward runs the same desks and writes every action down as a work order you approve, budget, inspect and can stop.
          </p>
        </div>
        <div className={s.compareWrap}>
          <table className={`${s.ledger} ${s.brands} ${s.compare}`}>
            <caption className={s.srOnly}>Feature comparison of Steward, Foundable and Polsia</caption>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Item</th>
                <th scope="col">Steward</th>
                <th scope="col">Foundable</th>
                <th scope="col">Polsia</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, index) => (
                <tr key={row.item}>
                  <td className={s.lineNo}>{String(index + 1).padStart(2, "0")}</td>
                  <th scope="row">
                    {row.item}
                    {row.detail && <small>{row.detail}</small>}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td key={BRANDS[i]} data-brand={BRANDS[i]}>
                      <span className={s.mark} data-v={cell.v}>
                        {LABEL[cell.v]}
                      </span>
                      {cell.note && <span className={s.markNote}>{cell.note}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className={s.legend} aria-label="Legend">
          <li>
            <span className={s.mark} data-v="yes">Yes</span> in the product today
          </li>
          <li>
            <span className={s.mark} data-v="part">Partly</span> with a condition, noted
          </li>
          <li>
            <span className={s.mark} data-v="no">Not yet</span> on Steward's board, not shipped
          </li>
          <li>
            <span className={s.mark} data-v="none">Not offered</span> not found in their public material
          </li>
        </ul>
        <p className={s.ledgerNote}>
          Compiled from foundable.app and polsia.com on 3 November 2026. Where a competitor only claims a capability, it is marked Partly. If something here is out of date, write to us and we will correct it with the date.
        </p>
      </section>

      <section className={`${s.leaf} ${s.closing}`} aria-labelledby="honest-title">
        <div className={s.leafHead}>
          <p className={s.kicker}>Printed on the back</p>
          <h2 id="honest-title" className={s.h2}>
            Where they are ahead, <span>today.</span>
          </h2>
          <p className={s.sectionLede}>Two lines read Not yet and three Partly on our side. They are on the board, in this order.</p>
        </div>
        <ol className={s.conditions}>
          <li>
            <h3 className={s.h3}>Logo generation</h3>
            <p>The brand kit already carries a mark; generating one from the brief is next.</p>
          </li>
          <li>
            <h3 className={s.h3}>Watched browser on the hosted beta</h3>
            <p>Self-hosted stacks with Chromium get the watched browser today; the hosted beta reads pages over HTTP until its server has room for one.</p>
          </li>
          <li>
            <h3 className={s.h3}>Pictures</h3>
            <p>Research briefs with sources, decks and sheets are in; generated pictures for posts and decks are next.</p>
          </li>
          <li>
            <h3 className={s.h3}>Text your agent</h3>
            <p>Approvals already reach your phone as push notifications from the inbox; texting back and forth with your Chief of Staff is next.</p>
          </li>
          <li>
            <h3 className={s.h3}>Interface in your language</h3>
            <p>Pick Spanish under Account and the workspace shell, overview, approvals, runs, inbox, command palette and account page read in Spanish; the remaining pages and other languages follow as the catalog grows.</p>
          </li>
        </ol>
        <p className={s.imprint}>
          <span className={s.fieldLabel}>Rates</span> Free in beta, your own keys. <Link href="/pricing">See the rate card</Link> or <Link href={entry.href}>{entry.label.toLowerCase()}</Link>.
        </p>
      </section>
    </PublicFrame>
  );
}
