import Link from "next/link";
import { serverApi } from "@/lib/server";
import type { Agent, Run } from "@/lib/types";
import { Card, Empty, StatusPill, ago, usd } from "@/components/ui";

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
    <Card title="Runs" action={<FilterLinks companyId={companyId} current={status} />}>
      {runs.length === 0 ? <Empty>No runs match.</Empty> : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="py-1">Intent</th><th>Agent</th><th>Status</th><th>Cost</th><th>Tokens</th><th>Started</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {runs.map((r) => (
              <tr key={r.id} className="hover:bg-panel-2">
                <td className="max-w-md truncate py-2"><Link className="hover:text-accent" href={`/app/c/${companyId}/runs/${r.id}`}>{r.intent || "(no intent)"}</Link></td>
                <td className="text-muted">{name(r.agentId)}</td>
                <td><StatusPill status={r.status} /></td>
                <td className="mono text-xs">{usd(r.costUsd)}</td>
                <td className="mono text-xs text-muted">{r.inputTokens + r.outputTokens}</td>
                <td className="text-xs text-muted">{ago(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function FilterLinks({ companyId, current }: { companyId: string; current?: string }) {
  const opts = [undefined, "executing,planning,building_context,verifying", "waiting_approval,waiting_budget,needs_review", "succeeded", "failed,cancelled"];
  const labels = ["all", "active", "waiting", "succeeded", "failed"];
  return (
    <div className="flex gap-1 text-xs">
      {opts.map((o, i) => (
        <Link key={labels[i]} href={o ? `/app/c/${companyId}/runs?status=${o}` : `/app/c/${companyId}/runs`} className={`pill ${current === o ? "border-accent text-accent" : "text-muted"}`}>{labels[i]}</Link>
      ))}
    </div>
  );
}
