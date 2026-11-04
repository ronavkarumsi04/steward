import type { Metadata } from "next";
import Link from "next/link";
import { serverApi } from "@/lib/server";
import type { Agent, Run } from "@/lib/types";
import { Icon } from "@/components/icons";
import { Card, Empty, PageHeader, StatusPill, ago, usd } from "@/components/ui";

export const metadata: Metadata = { title: "Runs" };

export default async function RunsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ status?: string; taskId?: string }> }) {
  const { companyId } = await params;
  const { status, taskId } = await searchParams;
  const api = await serverApi();
  const qs = new URLSearchParams({ limit: "100" });
  if (status) qs.set("status", status);
  if (taskId) qs.set("taskId", taskId);
  const [{ runs }, { agents }] = await Promise.all([
    api.get<{ runs: Run[] }>(`/companies/${companyId}/runs?${qs}`),
    api.get<{ agents: Agent[] }>(`/companies/${companyId}/agents`),
  ]);
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? "agent";
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="History" title="Runs" description="Every run is a durable workflow with its plan, tool calls, cost and authorization recorded." action={<FilterLinks companyId={companyId} current={status} />} />
      <Card className="p-0 nb-left-purple">
        {runs.length === 0 ? (
          <div className="p-4"><Empty icon={<Icon.Runs size={20} />}>No runs match.</Empty></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Intent</th><th>Agent</th><th>Status</th><th>Progress</th><th className="text-right">Cost</th><th className="text-right">Tokens</th><th className="text-right">Started</th></tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-md font-medium"><Link className="line-clamp-2 hover:text-accent" href={`/app/c/${companyId}/runs/${r.id}`} title={r.intent || undefined}>{r.intent || "(no intent)"}</Link></td>
                    <td className="text-muted">{name(r.agentId)}</td>
                    <td><StatusPill status={r.status} /></td>
                    <td className="tnum whitespace-nowrap text-xs text-muted">{progress(r)}</td>
                    <td className="tnum text-right">{usd(r.costUsd)}</td>
                    <td className="tnum text-right text-muted">{(r.inputTokens + r.outputTokens).toLocaleString()}</td>
                    <td className="tnum text-right text-xs text-muted">{ago(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** What a row has to show for itself: iterations done and wall time, so a long run and a stuck one read differently. */
function progress(r: Run): string {
  const iters = r.iterations ? `${r.iterations} ${r.iterations === 1 ? "step" : "steps"}` : "";
  const start = r.startedAt ? Date.parse(r.startedAt) : NaN;
  const end = r.finishedAt ? Date.parse(r.finishedAt) : Number.isNaN(start) ? NaN : Date.now();
  const secs = Number.isNaN(start) || Number.isNaN(end) ? null : Math.max(0, Math.round((end - start) / 1000));
  const dur = secs === null ? "" : secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return [iters, dur ? (r.finishedAt ? dur : `${dur} so far`) : ""].filter(Boolean).join(" · ") || "—";
}

function FilterLinks({ companyId, current }: { companyId: string; current?: string }) {
  const opts = [undefined, "executing,planning,building_context,verifying", "waiting_approval,waiting_budget,needs_review", "succeeded", "failed,cancelled"];
  const labels = ["all", "active", "waiting", "succeeded", "failed"];
  return (
    <nav aria-label="Filter runs" className="segmented">
      {opts.map((o, i) => (
        <Link key={labels[i]} href={o ? `/app/c/${companyId}/runs?status=${o}` : `/app/c/${companyId}/runs`} aria-current={current === o ? "page" : undefined} className="capitalize">{labels[i]}</Link>
      ))}
    </nav>
  );
}
