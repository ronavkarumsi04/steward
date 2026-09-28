"use client";

import { useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { McpInspectionResult, McpInstallForm, McpMarketplaceRead, McpServerView, McpToolView } from "@/lib/types";
import { bodyFromForm, describeInspection, emptyForm, formFrom, grantSummary, heldCount, serverPattern, sortTools, standing, standingLabel, standingTone, transportHint, transportLabel } from "@/lib/mcp";
import { Ago, Card, Empty, Pill, RiskPill, Spinner } from "./ui";

/**
 * The MCP marketplace: install a server, and see what it may do.
 *
 * Three states are kept visibly apart, because a marketplace that blurred them would be a way to give an agent a
 * new power without anybody reading it:
 *
 *   1. **Installed** is a row. Nothing has been reached and nothing is available — the card says so, in the same
 *      words the API uses.
 *   2. **Inspected** is the record of one conversation with the server. Every tool it offers is listed with the
 *      risk band Steward derived and *where that band came from* — a company's own classification, the server's
 *      claim about itself, the tool's name, or nothing at all — because a band that reads as a fact is a band
 *      nobody can argue with.
 *   3. **Granted** is an agent's own tool allowlist and nothing else. The buttons here write that one field
 *      through the API's grant route, so what this page says an agent may call and what a run can actually call
 *      are the same answer rather than two answers kept in step by hand.
 *
 * Nothing on this page validates anything: the server's refusals are rendered, field by field, from the problem
 * list the API returns. A second set of rules in the browser would be a second opinion about whether a program may
 * be spawned and an address dialled, and it would drift exactly where it matters.
 */
export function McpMarketplace({ companyId, initial }: { companyId: string; initial: McpMarketplaceRead }) {
  const [data, setData] = useState(initial);
  const [form, setForm] = useState<McpInstallForm | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Array<{ code: string; where: string; message: string }>>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const canManage = data.canManage;
  const agents = data.agents;

  function reportProblem(err: unknown) {
    if (err instanceof ApiError) {
      setError(err.message);
      // The problem list is the API's, rendered as it arrived: nothing here decides what is wrong with a server.
      const details = err.details as { problems?: unknown } | undefined;
      setProblems(Array.isArray(details?.problems) ? (details.problems as Array<{ code: string; where: string; message: string }>) : []);
      return;
    }
    setError("That did not work. Nothing was changed.");
  }

  /** Every write re-reads, so the surface shows what the rows hold rather than what this page hoped they would. */
  async function reload() {
    const fresh = await browserApi.get<McpMarketplaceRead>(`/companies/${companyId}/mcp`);
    setData(fresh);
  }

  async function run(key: string, work: () => Promise<string | null>) {
    setBusy(key);
    setError(null);
    setProblems([]);
    setNotice(null);
    try {
      setNotice(await work());
    } catch (err) {
      reportProblem(err);
    } finally {
      setBusy(null);
    }
  }

  const submit = () =>
    run("save", async () => {
      if (!form) return null;
      const body = bodyFromForm(form, { editing: editing !== null });
      if (editing) {
        const result = await browserApi.patch<{ notice?: string; uninspected: boolean; notices: string[] }>(`/companies/${companyId}/mcp/${editing}`, body);
        setForm(null);
        setEditing(null);
        await reload();
        return result.uninspected ? "Saved. Its tool list was discarded because where it points changed — inspect it again to see what it offers now." : "Saved.";
      }
      const created = await browserApi.post<{ server: McpServerView }>(`/companies/${companyId}/mcp`, body);
      setForm(null);
      await reload();
      return `“${created.server.name}” is installed and has not been inspected, so it offers nothing yet.`;
    });

  const inspect = (server: McpServerView) =>
    run(`inspect:${server.id}`, async () => {
      const result = await browserApi.post<McpInspectionResult>(`/companies/${companyId}/mcp/${server.id}/inspect`, {});
      await reload();
      return [describeInspection(result), ...result.notices].join(" ");
    });

  const toggle = (server: McpServerView) =>
    run(`enable:${server.id}`, async () => {
      await browserApi.post(`/companies/${companyId}/mcp/${server.id}/enabled`, { enabled: !server.enabled });
      await reload();
      return server.enabled ? `Paused “${server.name}”: no agent can call any of its tools until it is resumed.` : `Resumed “${server.name}”.`;
    });

  const remove = (server: McpServerView) =>
    run(`remove:${server.id}`, async () => {
      const result = await browserApi.del<{ removed: { slug: string; tools: number } }>(`/companies/${companyId}/mcp/${server.id}`);
      setConfirming(null);
      await reload();
      return `Removed “${server.name}” and its ${result.removed.tools} recorded tool(s). Grants that named it now match nothing.`;
    });

  const blockTool = (server: McpServerView, tool: McpToolView) =>
    run(`tool:${tool.id}`, async () => {
      await browserApi.patch(`/companies/${companyId}/mcp/${server.id}/tools/${tool.id}`, { enabled: !tool.enabled });
      await reload();
      return tool.enabled ? `“${tool.name}” is blocked: no agent can be granted it, whatever its allowlist says.` : `“${tool.name}” is available again.`;
    });

  const grant = (server: McpServerView, agentId: string, granted: boolean, toolNames: string[] | null = null) =>
    run(`grant:${server.id}:${agentId}`, async () => {
      const result = await browserApi.post<{ notices: string[]; agent: { name: string } }>(`/companies/${companyId}/mcp/${server.id}/grant`, { agentId, toolNames, granted });
      await reload();
      const what = toolNames ? `${toolNames.length} tool(s)` : `every tool`;
      return [`${granted ? "Granted" : "Revoked"} ${what} of “${server.name}” ${granted ? "to" : "from"} ${result.agent.name}.`, ...result.notices].join(" ");
    });

  const openForm = (server?: McpServerView) => {
    setError(null);
    setProblems([]);
    setNotice(null);
    setEditing(server?.id ?? null);
    setForm(server ? formFrom(server) : emptyForm());
  };

  return (
    <div className="space-y-5">
      <div className="rise-in flex flex-wrap items-center justify-between gap-3">
        {/*
          What this deployment will carry, stated before anything is installed. These two are sentences rather than
          short badges, so they are allowed to fold: a `.pill` is nowrap and uppercased, and one of them is long
          enough that the font a browser happens to have decides whether the page scrolls sideways on a phone.
          The two utilities win over the component rule, which is why they are enough.
        */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Pill tone={data.catalog.stdio ? "ok" : "neutral"} className="max-w-full whitespace-normal normal-case">
            {data.catalog.stdio ? "This deployment runs programs for stdio servers" : "This deployment will not run programs — HTTP and SSE only"}
          </Pill>
          <Pill tone={data.catalog.privateTargets ? "warn" : "neutral"} className="max-w-full whitespace-normal normal-case">
            {data.catalog.privateTargets ? "Its own network is allowed" : "Its own network is refused"}
          </Pill>
          <span>
            {data.servers.length} of {data.catalog.limits.serversPerCompany} installed
          </span>
        </div>
        {canManage && (
          <button data-testid="mcp-new" className="btn btn-primary" onClick={() => openForm()} disabled={busy !== null || data.servers.length >= data.catalog.limits.serversPerCompany}>
            Install a server
          </button>
        )}
      </div>

      {(error || notice) && (
        <div className="rise-in space-y-2">
          {error && (
            <div data-testid="mcp-problems" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm" role="alert">
              <p>{error}</p>
              {problems.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {problems.map((problem, index) => (
                    <li key={`${problem.code}-${index}`} className="text-xs">
                      <code className="font-mono text-[11px]">{problem.where}</code> — {problem.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {notice && (
            <div className="rounded-lg border border-line bg-panel-2 p-3 text-sm" role="status">
              {notice}
            </div>
          )}
        </div>
      )}

      {form && (
        <InstallForm
          form={form}
          editing={editing !== null}
          transports={data.catalog.transports}
          busy={busy !== null}
          onChange={setForm}
          onCancel={() => {
            setForm(null);
            setEditing(null);
            setProblems([]);
            setError(null);
          }}
          onSubmit={submit}
        />
      )}

      {data.servers.length === 0 && !form && (
        <Card>
          <Empty icon="🔌">
            <p className="font-medium">No server is installed.</p>
            <p className="mt-1 text-sm text-muted">
              An MCP server is somebody else&rsquo;s tools speaking a protocol Steward understands: a CRM, a ledger, a filesystem, whatever this company already runs. Installing one only writes down where it is
              — nothing is reached and no agent may call anything until you inspect it and grant what you have read.
            </p>
          </Empty>
        </Card>
      )}

      {data.servers.map((server) => (
        <ServerCard
          key={server.id}
          server={server}
          agents={agents}
          canManage={canManage}
          busy={busy}
          confirming={confirming === server.id}
          onInspect={() => inspect(server)}
          onToggle={() => toggle(server)}
          onEdit={() => openForm(server)}
          onRemove={() => (confirming === server.id ? remove(server) : setConfirming(server.id))}
          onCancelRemove={() => setConfirming(null)}
          onBlockTool={(tool) => blockTool(server, tool)}
          onGrant={(agentId, granted) => grant(server, agentId, granted)}
          onGrantTool={(agentId, toolNames, granted) => grant(server, agentId, granted, toolNames)}
        />
      ))}
    </div>
  );
}

function InstallForm({ form, editing, transports, busy, onChange, onCancel, onSubmit }: { form: McpInstallForm; editing: boolean; transports: string[]; busy: boolean; onChange: (form: McpInstallForm) => void; onCancel: () => void; onSubmit: () => void }) {
  const set = (patch: Partial<McpInstallForm>) => onChange({ ...form, ...patch });
  const field = "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm";
  const label = "block text-xs font-semibold tracking-wide text-muted";
  const stdio = form.transport === "stdio";

  return (
    <Card title={editing ? "Edit this server" : "Install a server"}>
      <form
        data-testid="mcp-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className={label}>NAME</span>
            <input data-testid="mcp-name" className={field} value={form.name} onChange={(event) => set({ name: event.target.value })} placeholder="Ledger" autoFocus />
          </label>
          <label className="space-y-1">
            <span className={label}>SLUG</span>
            <input data-testid="mcp-slug" className={field} value={form.slug} onChange={(event) => set({ slug: event.target.value })} disabled={editing} placeholder="ledger" />
            <span className="block text-[11px] text-muted">{editing ? "A slug cannot be changed: every tool name and every grant is written in terms of it." : "Tool names are built from it, so it has to be unique and stay the same."}</span>
          </label>
        </div>

        <label className="space-y-1">
          <span className={label}>WHAT IT IS FOR</span>
          <input data-testid="mcp-purpose" className={field} value={form.purpose} onChange={(event) => set({ purpose: event.target.value })} placeholder="Invoices and customers." />
        </label>

        <div className="space-y-2">
          <span className={label}>HOW IT IS REACHED</span>
          <div className="flex flex-wrap gap-2">
            {transports.map((transport) => (
              <button
                key={transport}
                type="button"
                data-testid={`mcp-transport-${transport}`}
                className={`btn ${form.transport === transport ? "btn-primary" : ""}`}
                onClick={() => set({ transport })}
                aria-pressed={form.transport === transport}
              >
                {transportLabel(transport)}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted">{transportHint(form.transport)}</p>
        </div>

        {stdio ? (
          <div className="space-y-4">
            <label className="space-y-1">
              <span className={label}>COMMAND</span>
              <input data-testid="mcp-command" className={field} value={form.command} onChange={(event) => set({ command: event.target.value })} placeholder="npx" />
            </label>
            <label className="space-y-1">
              <span className={label}>ARGUMENTS — ONE PER LINE</span>
              <textarea data-testid="mcp-args" className={`${field} font-mono text-xs`} rows={3} value={form.args} onChange={(event) => set({ args: event.target.value })} placeholder={"-y\n@acme/ledger-mcp"} />
            </label>
            <label className="space-y-1">
              <span className={label}>VARIABLES — KEY=VALUE, ONE PER LINE</span>
              <textarea data-testid="mcp-env" className={`${field} font-mono text-xs`} rows={3} value={form.env} onChange={(event) => set({ env: event.target.value })} placeholder="LEDGER_TOKEN=…" />
              <span className="block text-[11px] text-muted">
                {editing ? "Leave empty to keep the variables already stored; anything typed here replaces the whole set. Values are never shown once saved." : "The process gets these and the machine's minimum, and nothing else — this deployment's database and keys are not visible to it."}
              </span>
            </label>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="space-y-1">
              <span className={label}>ADDRESS</span>
              <input data-testid="mcp-url" className={field} value={form.url} onChange={(event) => set({ url: event.target.value })} placeholder="https://mcp.example.com/mcp" />
            </label>
            <label className="space-y-1">
              <span className={label}>HEADERS — NAME: VALUE, ONE PER LINE</span>
              <textarea data-testid="mcp-headers" className={`${field} font-mono text-xs`} rows={3} value={form.headers} onChange={(event) => set({ headers: event.target.value })} placeholder="Authorization: Bearer …" />
              <span className="block text-[11px] text-muted">{editing ? "Leave empty to keep the headers already stored." : "Credentials belong here rather than in the address."}</span>
            </label>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button data-testid="mcp-submit" className="btn btn-primary" type="submit" disabled={busy}>
            {editing ? "Save" : "Install"}
          </button>
          <button data-testid="mcp-cancel" className="btn" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {busy && <Spinner label="Working" />}
        </div>
      </form>
    </Card>
  );
}

function ServerCard({
  server,
  agents,
  canManage,
  busy,
  confirming,
  onInspect,
  onToggle,
  onEdit,
  onRemove,
  onCancelRemove,
  onBlockTool,
  onGrant,
  onGrantTool,
}: {
  server: McpServerView;
  agents: Array<{ id: string; name: string; kind: string; enabled: boolean }>;
  canManage: boolean;
  busy: string | null;
  confirming: boolean;
  onInspect: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onCancelRemove: () => void;
  onBlockTool: (tool: McpToolView) => void;
  onGrant: (agentId: string, granted: boolean) => void;
  onGrantTool: (agentId: string, toolNames: string[], granted: boolean) => void;
}) {
  const [agentId, setAgentId] = useState(agents.find((agent) => agent.enabled)?.id ?? "");
  const state = standing(server);
  const tools = sortTools(server.tools);
  const held = heldCount(server, agentId);
  const working = busy?.endsWith(server.id) ?? false;
  const canGrant = canManage && server.enabled && server.tools.length > 0 && Boolean(agentId);

  return (
    <div data-testid="mcp-server" data-slug={server.slug}>
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{server.name}</h2>
            <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11px]">{server.slug}</code>
            <Pill tone="neutral">{transportLabel(server.transport)}</Pill>
            <span data-testid="mcp-standing">
              <Pill tone={standingTone(state)} title={server.inspectedAt ? `Inspected ${server.inspectedAt}` : undefined}>
                {standingLabel(state)}
              </Pill>
            </span>
          </div>
          {/* Somebody else's sentence, carrying the command line or the address verbatim: it has to be able to
              break, because a long path is exactly what a third-party string looks like. */}
          <p className="mt-1 break-words text-sm text-muted">{server.description}</p>
          {server.purpose && <p className="mt-1 text-xs text-muted">{server.purpose}</p>}
          {server.error && (
            <p data-testid="mcp-error" className="mt-2 break-words text-sm text-danger">
              {server.error}
            </p>
          )}
          {server.inspectedAt && (
            <p className="mt-2 text-[11px] text-muted">
              Last read from the server <Ago iso={server.inspectedAt} />.
            </p>
          )}
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button data-testid="mcp-inspect" className="btn btn-primary" onClick={onInspect} disabled={working}>
              {server.inspectedAt ? "Inspect again" : "Inspect"}
            </button>
            <button data-testid="mcp-toggle" className="btn" onClick={onToggle} disabled={working}>
              {server.enabled ? "Pause" : "Resume"}
            </button>
            <button data-testid="mcp-edit" className="btn" onClick={onEdit} disabled={working}>
              Edit
            </button>
            {confirming ? (
              <>
                <button data-testid="mcp-remove-confirm" className="btn btn-danger" onClick={onRemove} disabled={working}>
                  Remove it
                </button>
                <button className="btn" onClick={onCancelRemove} disabled={working}>
                  Keep it
                </button>
              </>
            ) : (
              <button data-testid="mcp-remove" className="btn" onClick={onRemove} disabled={working}>
                Remove
              </button>
            )}
            {working && <Spinner label="Working" />}
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        {server.tools.length === 0 ? (
          <p className="text-sm text-muted">
            {state === "never_inspected"
              ? "Nothing is known about this server yet, so there is nothing to grant. Inspecting it asks it once what it offers and writes the answer down."
              : state === "unreachable"
                ? "Because it could not be reached, it offers nothing — a server nobody has read is not a server an agent may call."
                : "It answered, and it offers no tools."}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p data-testid="mcp-grant-summary" className="text-xs text-muted">
                {grantSummary(server)}
              </p>
              {canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-muted">Agent</span>
                    <select className="rounded-md border border-line bg-bg px-2 py-1 text-xs" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id} disabled={!agent.enabled}>
                          {agent.name}
                          {agent.enabled ? "" : " (disabled)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button data-testid="mcp-grant-all" className="btn" disabled={!canGrant || busy !== null} onClick={() => onGrant(agentId, true)} title={`Writes ${serverPattern(server.slug)} into ${agents.find((agent) => agent.id === agentId)?.name ?? "the agent"}'s tools`}>
                    Grant every tool
                  </button>
                  <button data-testid="mcp-revoke-all" className="btn" disabled={!canGrant || busy !== null || held === 0} onClick={() => onGrant(agentId, false)}>
                    Revoke all ({held})
                  </button>
                </div>
              )}
            </div>

            <ul data-testid="mcp-tools" className="divide-y divide-line">
              {tools.map((tool) => {
                const mine = tool.grantedTo.some((grant) => grant.agentId === agentId);
                return (
                  <li key={tool.id} data-testid="mcp-tool" data-name={tool.name} className={`flex flex-wrap items-start justify-between gap-3 py-3 ${tool.enabled ? "" : "opacity-60"}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{tool.name}</span>
                        <span data-testid="mcp-risk">
                          <RiskPill risk={tool.risk} />
                        </span>
                        {!tool.enabled && <Pill tone="neutral">Blocked</Pill>}
                        {tool.idempotent && <Pill tone="neutral">Repeat-safe</Pill>}
                        {tool.sideEffects === "none" && <Pill tone="neutral">Reads only</Pill>}
                      </div>
                      <p className="mt-1 break-words text-sm text-muted">{tool.description || "The server gave no description."}</p>
                      <p className="mt-1 text-[11px] text-muted">
                        {tool.riskReason} <span className="opacity-70">(from {tool.riskSource === "override" ? "this company" : tool.riskSource === "hint" ? "the server's own claim" : tool.riskSource === "name" ? "its name" : "nothing the server said"})</span>
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-muted">{tool.toolName}</p>
                      {tool.grantedTo.length > 0 && (
                        <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                          <span className="text-muted">Granted to</span>
                          {tool.grantedTo.map((grant) => (
                            <Pill key={grant.agentId} tone="accent" title={grant.pattern}>
                              {grant.agentName}
                            </Pill>
                          ))}
                        </p>
                      )}
                    </div>
                    {canManage && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button data-testid="mcp-tool-grant" className="btn" disabled={!canGrant || busy !== null} onClick={() => onGrantTool(agentId, [tool.toolName], !mine)}>
                          {mine ? `Revoke from ${agents.find((agent) => agent.id === agentId)?.name ?? "agent"}` : `Grant to ${agents.find((agent) => agent.id === agentId)?.name ?? "agent"}`}
                        </button>
                        <button data-testid="mcp-tool-block" className="btn" disabled={busy !== null} onClick={() => onBlockTool(tool)}>
                          {tool.enabled ? "Block" : "Unblock"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Card>
    </div>
  );
}
