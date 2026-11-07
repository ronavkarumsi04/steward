"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { RoutingPolicy } from "@steward/schema";
import { ApiError, browserApi } from "@/lib/api";
import type { ProviderModel } from "@/lib/types";
import { ROUTING_PURPOSES } from "@/lib/routing";
import { Card } from "./ui";
import { useT, useTf } from "./locale-provider";
import type { MessageKey } from "@/lib/i18n";

export function RoutingPanel({ orgId, companyId, models, routing, isAdmin }: { orgId: string; companyId: string; models: ProviderModel[]; routing: Record<string, RoutingPolicy>; isAdmin: boolean }) {
  const router = useRouter();
  const t = useT();
  const tf = useTf();
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
      setError(err instanceof ApiError ? err.message : t("routing.saveFailed"));
    }
  }

  return (
    <Card title={t("routing.title")} className="nb-left-purple">
      <p className="mb-3 text-sm text-muted">{t("routing.intro")}</p>
      {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
      <div className="space-y-2">
        {ROUTING_PURPOSES.map((purpose) => {
          const pol = routing[purpose];
          const current = pol?.explicit ? `${pol.explicit.provider}::${pol.explicit.model}` : "";
          return (
            <form key={purpose} onSubmit={(e) => save(purpose, e)} className="nb-panel-flat grid items-center gap-2 p-2 text-sm md:grid-cols-[8rem_1fr_8rem_auto_auto]" data-purpose={purpose}>
              <div className="font-medium">{purpose}</div>
              <select name="explicit" className="input mono" defaultValue={current} aria-label={tf("routing.modelFor", { purpose })}>
                <option value="">{t("routing.auto")}</option>
                {models.filter((m) => purpose !== "embedding" || m.model.capabilities.embeddingDimensions !== undefined).map((m) => <option key={`${m.provider}::${m.model.id}`} value={`${m.provider}::${m.model.id}`}>{m.provider} / {m.model.id}</option>)}
              </select>
              <select name="preference" className="input" defaultValue={pol?.requirements.preference ?? "balanced"} aria-label={t("routing.preference")}>{["balanced", "quality", "cost", "latency"].map((p) => <option key={p} value={p}>{t(`routing.pref.${p}` as MessageKey)}</option>)}</select>
              <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" name="localOnly" defaultChecked={pol?.requirements.localOnly ?? false} /> {t("routing.localOnly")}</label>
              <button className="btn" disabled={!isAdmin}>{t("routing.save")}</button>
            </form>
          );
        })}
      </div>
    </Card>
  );
}
