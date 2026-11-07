"use client";

import Link from "next/link";
import { useT, useTf } from "./locale-provider";
import { useState } from "react";
import type { Approval } from "@/lib/types";
import { ApprovalCard } from "./approval-card";
import { Icon } from "./icons";
import { PushToggle } from "./push-toggle";

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
export function Inbox({ groups, manyOrgs, truncated = false }: { groups: InboxGroup[]; manyOrgs: boolean; truncated?: boolean }) {
  const t = useT();
  const tf = useTf();
  // The answered card, kept whole: the server list is pending-only, so after the refresh this is the only
  // place its outcome (who decided, the note, whether the workflow took it) can still be read.
  const [decided, setDecided] = useState<Array<{ approval: Approval; companyId: string }>>([]);
  const isDecided = (id: string) => decided.some((d) => d.approval.id === id);
  const waiting = groups.reduce((n, g) => n + g.approvals.filter((a) => !isDecided(a.id)).length, 0);

  return (
    <div className="mx-auto w-full max-w-[720px] px-3 py-5 sm:px-5 sm:py-8">
      <header className="mb-5 flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{t("inbox.eyebrow")}</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ fontStretch: "112%" }}>
            {t("inbox.title")}
          </h1>
        </div>
        <p className="text-right text-sm text-muted" aria-live="polite">
          {waiting === 0 ? t("inbox.nothingPending") : waiting === 1 ? t("inbox.oneRequest") : tf("inbox.nRequests", { n: waiting })}
        </p>
      </header>
      <PushToggle />

      {decided.length > 0 && (
        <section aria-labelledby="inbox-decided" className="mb-7 space-y-3">
          <h2 id="inbox-decided" className="nb-section-label">
            {t("inbox.justDecided")}
          </h2>
          {decided.map((d) => (
            <ApprovalCard key={`decided-${d.approval.id}`} companyId={d.companyId} approval={d.approval} run={null} />
          ))}
        </section>
      )}

      {groups.length === 0 && decided.length === 0 ? (
        <section className="card nb-left-green p-5" aria-label={t("inbox.emptyLabel")}>
          <h2 className="text-lg font-semibold">{t("inbox.emptyTitle")}</h2>
          <p className="mt-1 text-sm text-muted">
            {t("inbox.emptyHelp")}
          </p>
          <Link href="/app" className="btn btn-sm mt-4">
            {t("inbox.yourCompanies")} <Icon.ChevronRight size={14} />
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
                  {t("inbox.allApprovals")}
                </Link>
              </div>
              {g.approvals
                .filter((a) => !isDecided(a.id))
                .map((a) => (
                  <ApprovalCard key={a.id} companyId={g.company.id} approval={a} run={null} onDecided={(d) => setDecided((prev) => [{ approval: d, companyId: g.company.id }, ...prev])} />
                ))}
            </section>
          ))}
        </div>
      )}
      {truncated && (
        <p className="mt-6 text-sm text-muted" role="note">
          {t("inbox.truncated")}
        </p>
      )}
      <p className="mt-8 text-xs leading-relaxed text-muted">
        {t("inbox.homeScreen")}
      </p>
    </div>
  );
}
