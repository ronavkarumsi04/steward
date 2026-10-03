"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  OverclockConfig,
  OVERCLOCK_DEFAULTS,
  type AgentSkill,
} from "@steward/schema";
import { ApiError, browserApi } from "@/lib/api";
import type { Agent } from "@/lib/types";

export function OverclockToggle({
  companyId,
  enabled,
  isAdmin,
}: {
  companyId: string;
  enabled: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await browserApi.put(`/companies/${companyId}/overclock`, {
        enabled: !enabled,
      });
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not update Overclock. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card space-y-4" aria-labelledby="overclock-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="eyebrow">Developer controls</p>
          <h2 id="overclock-title" className="mt-2 text-2xl">
            Overclock Mode
          </h2>
          <p className="mt-2 text-sm text-muted">
            Fine-tune each agent’s models, sampling, context and skills. Changes
            apply to new runs; existing runs retain their recorded settings.
            Turning this off preserves your configuration and restores standard
            sampling and context for new runs.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Overclock Mode"
          className={`btn ${enabled ? "btn-primary" : ""}`}
          disabled={!isAdmin || busy}
          onClick={toggle}
        >
          {busy ? "Saving…" : enabled ? "On" : "Off"}
        </button>
      </div>
      <p className="text-xs text-muted">
        Admins manage these shared workspace settings. Policy, approval, budget
        and network controls always apply.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {enabled && (
        <Link href={`/app/c/${companyId}/agents`} className="btn">
          Configure agents ↗
        </Link>
      )}
    </section>
  );
}

const PHASES = ["planning", "acting", "review"] as const;

export function AgentOverclock({
  companyId,
  agent,
  isAdmin,
}: {
  companyId: string;
  agent: Agent;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const initial = OverclockConfig.safeParse(agent.config?.overclock ?? {});
  const [config, setConfig] = useState<OverclockConfig>(
    initial.success ? initial.data : structuredClone(OVERCLOCK_DEFAULTS),
  );
  const [revision, setRevision] = useState(
    Number(agent.config?.overclockRevision ?? 0),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    initial.success
      ? null
      : "The stored configuration is invalid. Review these defaults before replacing it.",
  );
  const [status, setStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  function update(next: OverclockConfig) {
    setConfig(next);
    setStatus(null);
    setPreview(null);
  }
  function skill(index: number, patch: Partial<AgentSkill>) {
    update({
      ...config,
      skills: config.skills.map((s, i) =>
        i === index ? { ...s, ...patch } : s,
      ),
    });
  }
  async function run(save: boolean) {
    const parsed = OverclockConfig.safeParse(config);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const base = `/companies/${companyId}/agents/${agent.id}/overclock`;
      if (save) {
        const res = await browserApi.put<{ agent: Agent }>(base, {
          revision,
          config: parsed.data,
        });
        setRevision(Number(res.agent.config?.overclockRevision));
        setStatus("Configuration saved. New runs will record this revision.");
        router.refresh();
      } else {
        const res = await browserApi.post<{ instructionBlock: string }>(
          `${base}/preview`,
          parsed.data,
        );
        setPreview(
          res.instructionBlock ||
            "No enabled skills. The agent’s role and runtime instructions still apply.",
        );
        setStatus(
          "Configuration validated. Preview assembled without running an agent or calling a model.",
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not save or validate. Your edits are still here; retry when connected.",
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(true);
  }
  return (
    <form
      onSubmit={submit}
      className="card space-y-5"
      aria-labelledby={`tuning-${agent.id}`}
    >
      <div>
        <p className="eyebrow">Overclock / revision {revision}</p>
        <h3 id={`tuning-${agent.id}`} className="mt-2 text-xl">
          {agent.name}: runtime tuning
        </h3>
        <p className="mt-2 text-sm text-muted">
          Provider support varies. Unsupported parameters produce a visible
          provider error; they are never reported as applied. Choose one
          sampling method per phase.
        </p>
      </div>
      <fieldset disabled={!isAdmin || busy} className="space-y-5">
        <legend className="sr-only">Advanced agent configuration</legend>
        <div className="grid gap-4 xl:grid-cols-3">
          {PHASES.map((phase) => (
            <fieldset key={phase} className="card-inset space-y-3 p-4">
              <legend className="px-1 text-sm font-semibold capitalize">
                {phase}
              </legend>
              <label className="block text-xs text-muted">
                Sampling method
                <select
                  aria-label={`${phase} sampling method`}
                  className="input mt-1"
                  value={config[phase].sampler}
                  onChange={(e) =>
                    update({
                      ...config,
                      [phase]: { ...config[phase], sampler: e.target.value },
                    })
                  }
                >
                  <option value="temperature">Temperature</option>
                  <option value="top_p">Top P</option>
                  <option value="provider_default">Provider default</option>
                </select>
              </label>
              <label className="block text-xs text-muted">
                {config[phase].sampler === "top_p"
                  ? "Top P (0.01–1)"
                  : "Temperature (0–1)"}
                <input
                  aria-label={`${phase} ${config[phase].sampler === "top_p" ? "top P" : "temperature"}`}
                  className="input mt-1"
                  type="number"
                  step="0.01"
                  min={config[phase].sampler === "top_p" ? 0.01 : 0}
                  max={1}
                  disabled={config[phase].sampler === "provider_default"}
                  value={
                    config[phase].sampler === "top_p"
                      ? config[phase].topP
                      : config[phase].temperature
                  }
                  onChange={(e) =>
                    update({
                      ...config,
                      [phase]: {
                        ...config[phase],
                        [config[phase].sampler === "top_p"
                          ? "topP"
                          : "temperature"]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
              <label className="block text-xs text-muted">
                Output token limit
                <input
                  aria-label={`${phase} output token limit`}
                  type="number"
                  min={128}
                  max={16384}
                  className="input mt-1"
                  value={config[phase].maxTokens}
                  onChange={(e) =>
                    update({
                      ...config,
                      [phase]: {
                        ...config[phase],
                        maxTokens: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            </fieldset>
          ))}
        </div>
        <fieldset>
          <legend className="mb-3 text-sm font-semibold">
            Context window allocation
          </legend>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(
              [
                ["memoryLimit", "Memory results", 0, 30],
                ["memoryMaxChars", "Memory characters", 0, 12000],
                ["conversationLimit", "Conversation messages", 0, 60],
                ["toolOutputMaxChars", "Tool output characters", 1000, 24000],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key} className="text-xs text-muted">
                {label}
                <input
                  className="input mt-1"
                  type="number"
                  min={min}
                  max={max}
                  value={config[key]}
                  onChange={(e) =>
                    update({ ...config, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <p className="hint">
            Set either memory allocation to zero to omit retrieval. Tool output
            is capped independently of the immutable tool log.
          </p>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">
            Skill development
          </legend>
          <p className="text-sm text-muted">
            Write reusable standing instructions for this agent. Skills are
            versioned with this configuration and included in recorded run
            context. They cannot grant tools or override runtime safeguards.
          </p>
          {config.skills.map((s, index) => (
            <div key={index} className="card-inset space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-muted">
                  Skill name
                  <input
                    aria-label={`Skill ${index + 1} name`}
                    className="input mt-1"
                    value={s.name}
                    onChange={(e) => skill(index, { name: e.target.value })}
                    maxLength={100}
                    required
                  />
                </label>
                <label className="text-xs text-muted">
                  Stable ID
                  <input
                    aria-label={`Skill ${index + 1} ID`}
                    className="input mono mt-1"
                    value={s.id}
                    onChange={(e) => skill(index, { id: e.target.value })}
                    pattern={"[a-z0-9][a-z0-9_\\-]{0,63}"}
                    required
                  />
                </label>
              </div>
              <label className="block text-xs text-muted">
                Instructions
                <textarea
                  aria-label={`Skill ${index + 1} instructions`}
                  className="input mono mt-1 min-h-36"
                  value={s.instructions}
                  onChange={(e) =>
                    skill(index, { instructions: e.target.value })
                  }
                  maxLength={4000}
                  required
                />
              </label>
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) =>
                      skill(index, { enabled: e.target.checked })
                    }
                  />
                  Include in new runs
                </label>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    if (
                      confirm(
                        `Remove ${s.name || "this skill"} from this configuration? It takes effect when you save.`,
                      )
                    )
                      update({
                        ...config,
                        skills: config.skills.filter((_, i) => i !== index),
                      });
                  }}
                >
                  Remove skill
                </button>
              </div>
            </div>
          ))}
          <button
            className="btn"
            type="button"
            disabled={config.skills.length >= 8}
            onClick={() =>
              update({
                ...config,
                skills: [
                  ...config.skills,
                  {
                    id: `skill-${crypto.randomUUID().slice(0, 8)}`,
                    name: "",
                    instructions: "",
                    enabled: true,
                  },
                ],
              })
            }
          >
            Add skill
          </button>
        </fieldset>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-sm text-ok">
          {status}
        </p>
      )}
      {preview !== null && (
        <div className="card-inset p-4">
          <h4 className="mb-2 text-sm">Skill instruction preview</h4>
          <pre className="mono whitespace-pre-wrap break-words text-xs">
            {preview}
          </pre>
        </div>
      )}
      <details className="card-inset p-3">
        <summary className="cursor-pointer text-sm">
          Inspect configuration JSON
        </summary>
        <pre className="mono mt-3 overflow-auto text-xs">
          {JSON.stringify(config, null, 2)}
        </pre>
      </details>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn"
          disabled={!isAdmin || busy}
          onClick={() => {
            if (
              confirm(
                "Replace your unsaved edits with standard defaults? Save to apply.",
              )
            )
              update(structuredClone(OVERCLOCK_DEFAULTS));
          }}
        >
          Restore defaults
        </button>
        <button
          type="button"
          className="btn"
          disabled={!isAdmin || busy}
          onClick={() => run(false)}
        >
          Validate &amp; preview
        </button>
        <button className="btn btn-primary" disabled={!isAdmin || busy}>
          {busy ? "Working…" : "Save Overclock configuration"}
        </button>
      </div>
    </form>
  );
}
