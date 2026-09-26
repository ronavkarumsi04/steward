"use client";

import { useState } from "react";
import type { Approval, Run } from "@/lib/types";
import { ApprovalCard } from "./approval-card";

/**
 * The approvals list, with one job the server cannot do on its own: keeping a request the founder just answered
 * on screen.
 *
 * A decision takes the row out of the "pending" filter, so re-rendering the page would replace the card — and
 * with it the only place the outcome is stated: who decided, the note, and whether the workflow actually took
 * the decision. That last fact matters most exactly when it is bad news, so the answered request stays put
 * under "Just decided" until the founder navigates away or answers it again.
 */
export function ApprovalsList({
  companyId,
  approvals,
  runsById,
}: {
  companyId: string;
  approvals: Approval[];
  /** Keyed by run id; a plain object rather than a Map so it can cross the server/client boundary. */
  runsById: Record<string, Pick<Run, "id" | "status">>;
}) {
  const [decided, setDecided] = useState<Approval[]>([]);
  const runOf = (a: Approval) => (a.runId ? runsById[a.runId] ?? null : null);

  return (
    <div className="space-y-4">
      {decided.length > 0 && (
        <section aria-labelledby="just-decided" className="space-y-3">
          <h2 id="just-decided" className="nb-section-label">
            JUST DECIDED
          </h2>
          {decided.map((a) => (
            <ApprovalCard key={`answered-${a.id}`} companyId={companyId} approval={a} run={runOf(a)} />
          ))}
        </section>
      )}
      <div className="space-y-3">
        {approvals
          .filter((a) => !decided.some((d) => d.id === a.id))
          .map((a) => (
            <ApprovalCard key={a.id} companyId={companyId} approval={a} run={runOf(a)} onDecided={(d) => setDecided((prev) => [d, ...prev])} />
          ))}
      </div>
    </div>
  );
}
