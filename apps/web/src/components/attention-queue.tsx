import Link from "next/link";
import type { CSSProperties } from "react";
import { Icon } from "./icons";
import type { AttentionItem, AttentionSeverity } from "@/lib/attention";
import { Pill, ago, type Tone } from "./ui";

/**
 * "Needs you now" — the first thing on the command center, and the only part of it that is a to-do list.
 *
 * Motion is deliberately limited to the house `rise-in` entrance (opacity + 6px translate, `--dur-entrance`,
 * reduced-motion aware): nothing here loops, ticks, or animates while it is being read, because this panel is
 * read carefully and then acted on. Where it sits in the page's arrival is decided by the page
 * (`lib/arrivals.ts`), not here, so one schedule describes the whole choreography.
 */
const TONE: Record<AttentionSeverity, { label: string; wrap: string; pill: Tone }> = {
  blocking: { label: "Blocking", wrap: "nb-left-red", pill: "danger" },
  decision: { label: "Your call", wrap: "nb-left-yellow", pill: "warn" },
  risk: { label: "Heads up", wrap: "nb-left-orange", pill: "neutral" },
};

export function AttentionQueue({ items, arriveAfterMs = 0 }: { items: AttentionItem[]; arriveAfterMs?: number }) {
  const decisions = items.filter((i) => i.severity !== "risk").length;

  return (
    <section
      aria-labelledby="needs-you"
      className="nb-panel-flat nb-accent-purple rise-in"
      style={{ "--enter-delay": `${arriveAfterMs}ms` } as CSSProperties}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="needs-you" className="nb-section-label">
          NEEDS YOU NOW
        </h2>
        {items.length > 0 && (
          <p className="tnum text-xs text-muted">
            {decisions > 0 ? `${decisions} waiting on a decision` : "Nothing needs a decision"}
            {items.length > decisions ? ` · ${items.length - decisions} to know about` : ""}
          </p>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card-inset flex items-center gap-3 px-4 py-3 text-sm text-muted">
          <span className="text-ok" aria-hidden="true">
            <Icon.Check size={16} />
          </span>
          <p>Nothing needs you. Steward is working through the queue — the activity feed below is the record.</p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {items.map((item) => {
            const tone = TONE[item.severity];
            return (
              <li key={item.id} className={tone.wrap}>
                <Link
                  href={item.href}
                  className="nb-panel-flat block border-2 px-3 py-2.5 transition-colors duration-150 hover:nb-accent-blue"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={tone.pill}>{tone.label}</Pill>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                    {item.since && <span className="tnum shrink-0 text-xs text-muted">{ago(item.since)}</span>}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{item.detail}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
