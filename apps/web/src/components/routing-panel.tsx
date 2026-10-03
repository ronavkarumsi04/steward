"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { RoutingPolicy } from "@steward/schema";
import { ApiError, browserApi } from "@/lib/api";
import type { ProviderModel } from "@/lib/types";
import { ROUTING_PURPOSES } from "@/lib/routing";
import { Card } from "./ui";

export function RoutingPanel({ orgId, companyId, models, routing, isAdmin }: { orgId: string; companyId: string; models: ProviderModel[]; routing: Record<string, RoutingPolicy>; isAdmin: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function save(purpose: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const explicit = String(fd.get("explicit") ?? "");
    const [provider, model] = explicit.split("::");
    setError(null);
    try {
      await browserApi.put(`/orgs/${orgId}/routing/${purpose}?companyId=${companyId}`, {
        explicit: explicit && provider && model ? { provider, model } : undefined,
        fallbackChain: [],
        requirements: { preference: String(fd.get("preference") || "balanced"), localOnly: fd.get("localOnly") === "on" },
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    }
  }

  return (
    <Card title="Model routing" className="nb-left-purple">
      <p className="mb-3 text-sm text-muted">Which model each stage of the agent loop uses. “Auto” picks the best healthy model for the stage&rsquo;s requirements and fails over when a provider errors or is rate-limited. Add providers under <Link className="text-accent underline underline-offset-4" href={`/app/org/${orgId}/providers`}>organization → AI providers</Link>.</p>
      {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
      <div className="space-y-2">
        {ROUTING_PURPOSES.map((purpose) => {
          const pol = routing[purpose];
          const current = pol?.explicit ? `${pol.explicit.provider}::${pol.explicit.model}` : "";
          return (
            <form key={purpose} onSubmit={(e) => save(purpose, e)} className="nb-panel-flat grid items-center gap-2 p-2 text-sm md:grid-cols-[8rem_1fr_8rem_auto_auto]" data-purpose={purpose}>
              <div className="font-medium">{purpose}</div>
              <select name="explicit" className="input mono" defaultValue={current} aria-label={`Model for ${purpose}`}>
                <option value="">Auto (routed by requirements)</option>
                {models.filter((m) => purpose !== "embedding" || m.model.capabilities.embeddingDimensions !== undefined).map((m) => <option key={`${m.provider}::${m.model.id}`} value={`${m.provider}::${m.model.id}`}>{m.provider} / {m.model.id}</option>)}
              </select>
              <select name="preference" className="input" defaultValue={pol?.requirements.preference ?? "balanced"} aria-label="Preference">{["balanced", "quality", "cost", "latency"].map((p) => <option key={p}>{p}</option>)}</select>
              <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" name="localOnly" defaultChecked={pol?.requirements.localOnly ?? false} /> local only</label>
              <button className="btn" disabled={!isAdmin}>Save</button>
            </form>
          );
        })}
      </div>
    </Card>
  );
}
