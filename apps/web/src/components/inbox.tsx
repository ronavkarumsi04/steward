"use client";

import Link from "next/link";
import { useState } from "react";
import type { Approval } from "@/lib/types";
import { ApprovalCard } from "./approval-card";
import { Icon } from "./icons";

export type InboxGroup = {
  orgName: string;
  company: { id: string; name: string };
  approvals: Approval[];
};

/**
 * The founder's inbox: pending approvals from every company, grouped by company, newest first within each.
 * Built for a phone first — one column, the count up top, each card answerable where it stands — and it
 * reads the same on a desk. A decided card stays until the page is left, so the outcome can be read.
 */
export function Inbox({ groups, manyOrgs }: { groups: InboxGroup[]; manyOrgs: boolean }) {
  const [decided, setDecided] = useState<Set<string>>(() => new Set());
  const waiting = groups.reduce((n, g) => n + g.approvals.filter((a) => !decided.has(a.id)).length, 0);

  return (
    <div className="mx-auto w-full max-w-[720px] px-3 py-5 sm:px-5 sm:py-8">
      <header className="mb-5 flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Waiting on you</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ fontStretch: "112%" }}>
            Inbox
          </h1>
        </div>
        <p className="text-right text-sm text-muted" aria-live="polite">
          {waiting === 0 ? "Nothing pending" : waiting === 1 ? "1 request" : `${waiting} requests`}
        </p>
      </header>

      {groups.length === 0 ? (
        <section className="card nb-left-green p-5" aria-label="Inbox empty">
          <h2 className="text-lg font-semibold">Nothing is waiting on you.</h2>
          <p className="mt-1 text-sm text-muted">
            When an agent needs a decision — an email to send, a post to publish, money to spend — it appears here as the request itself, and you answer it in place.
          </p>
          <Link href="/app" className="btn btn-sm mt-4">
            Your companies <Icon.ChevronRight size={14} />
          </Link>
        </section>
      ) : (
        <div className="space-y-7">
          {groups.map((g) => (
            <section key={g.company.id} aria-labelledby={`inbox-${g.company.id}`} className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-fg pb-2">
                <h2 id={`inbox-${g.company.id}`} className="text-base font-semibold">
                  {g.company.name}
                  {manyOrgs && <span className="ml-2 text-sm font-normal text-muted">{g.orgName}</span>}
                </h2>
                <Link href={`/app/c/${g.company.id}/approvals`} className="text-sm text-muted underline-offset-4 hover:underline">
                  All approvals
                </Link>
              </div>
              {g.approvals.map((a) => (
                <ApprovalCard key={a.id} companyId={g.company.id} approval={a} run={null} onDecided={(d) => setDecided((prev) => new Set(prev).add(d.id))} />
              ))}
            </section>
          ))}
        </div>
      )}
      <p className="mt-8 text-xs leading-relaxed text-muted">
        Add Steward to your home screen to open this inbox like an app. The decision you make here is the same record the workspace shows.
      </p>
    </div>
  );
}
