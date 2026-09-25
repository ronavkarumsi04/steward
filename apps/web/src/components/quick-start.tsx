"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { Agent, Run } from "@/lib/types";
import { Icon } from "./icons";

/** Kick off an ad-hoc run for any agent straight from the overview. */
export function QuickStart({ companyId, agents }: { companyId: string; agents: Agent[] }) {
  const router = useRouter();
  const enabled = agents.filter((a) => a.enabled);
  const [agentId, setAgentId] = useState(enabled.find((a) => a.kind === "orchestrator")?.id ?? enabled[0]?.id ?? "");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!instruction.trim() || !agentId) return;
    setBusy(true);
    setError(null);
    try {
      const { run } = await browserApi.post<{ run: Run }>(`/companies/${companyId}/runs`, { agentId, instruction: instruction.trim() });
      setInstruction("");
      router.push(`/app/c/${companyId}/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start run");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="nb-panel-flat border-2 border-[#1c1917] p-3 shadow-[4px_4px_0_#1c1917]">
      <div className="mb-2 flex items-center gap-2">
        <Icon.Sparkle size={16} aria-hidden="true" />
        <span className="nb-section-label">MANUAL TASK</span>
      </div>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <select aria-label="Agent" className="input w-full md:w-56" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {enabled.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input
          aria-label="Instruction"
          className="input min-w-0 flex-1"
          placeholder="Give an agent something to do, e.g. “Research the top 5 competitors and write a positioning doc”"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <button className="btn btn-primary" disabled={busy || !instruction.trim() || !agentId}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon.ArrowRight size={16} />}
          {busy ? "Starting…" : "Run"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </form>
  );
}