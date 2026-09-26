"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Approval, Run } from "@/lib/types";
import { ApprovalCard } from "./approval-card";
import { Ago } from "./ui";

/**
 * The decision the founder would otherwise have to go looking for, on the page they land on.
 *
 * This is the whole point of a workspace: the request that needs an answer, with the policy reason, the
 * payload and the blast radius already open, and the answer given here rather than in a second place. The
 * rest of the queue stays one link away instead of being duplicated underneath.
 *
 * Two details make it honest rather than merely convenient. The instance is deliberately not keyed by the
 * request it shows, so answering one does not blow away the confirmation; and an undelivered decision says so
 * instead of leaving the founder believing a run is under way.
 */
export function WorkspaceDecision({
  companyId,
  approval,
  run,
  remaining,
}: {
  companyId: string;
  /** Null once the queue is empty, which is when the panel reports what was decided and stops. */
  approval: Approval | null;
  run: Pick<Run, "id" | "status"> | null;
  /** How many other requests are waiting, so the founder knows this is not the only one. */
  remaining: number;
}) {
  const router = useRouter();
  const [decided, setDecided] = useState<Approval[]>([]);
  if (!approval && decided.length === 0) return null;

  return (
    <section aria-labelledby="decide-now" className="nb-panel-flat nb-accent-yellow rise-in">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="decide-now" className="nb-section-label">
          {approval ? "DECIDE NOW" : "DECIDED"}
        </h2>
        <p className="text-xs text-muted">
          {remaining > 0 ? `${remaining} more waiting · ` : ""}
          <Link className="text-accent hover:underline" href={`/app/c/${companyId}/approvals`}>
            all approvals
          </Link>
        </p>
      </div>

      {decided.map((d) => (
        <p
          key={`decided-${d.id}`}
          role="status"
          className={`mb-2 px-3 py-2 text-xs leading-relaxed ${d.signalDelivered === false ? "nb-panel-flat nb-left-red" : "card-inset text-muted"}`}
        >
          <span className="font-semibold">
            {d.status === "approved" ? "Approved" : "Denied"}
          </span>{" "}
          {d.action} <Ago iso={d.resolvedAt} />
          {typeof d.resolution?.note === "string" && d.resolution.note ? <> — {d.resolution.note}</> : null}
          {d.resolution?.editedPayload ? " · sent with your edited payload" : ""}
          {d.signalDelivered === false && (
            <>
              {" "}
              — recorded, but the run’s workflow did not take the decision, so nothing resumed. Stop or restart the run from its page.
            </>
          )}
        </p>
      ))}

      {approval ? (
        <ApprovalCard
          key={approval.id}
          companyId={companyId}
          approval={approval}
          run={run}
          onDecided={(d) => setDecided((prev) => [d, ...prev])}
        />
      ) : (
        <div className="card-inset flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm text-muted">
          <span>Nothing else is waiting for a decision.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => router.refresh()}>
            Check again
          </button>
        </div>
      )}
    </section>
  );
}
