import Link from "next/link";
import { redirect } from "next/navigation";
import { getMeOptional } from "@/lib/server";
import { Icon } from "@/components/icons";

const PILLARS = [
  [Icon.Agents, "Persistent agents", "Orchestrator, research, engineering, marketing, sales, support, finance and operations agents that plan and execute against your goals — on a schedule or on demand."],
  [Icon.Runs, "Durable by design", "Every run is a Temporal workflow: retries, approval pauses, timers and crash recovery are first-class. Nothing is lost when a worker restarts."],
  [Icon.Lock, "You hold the keys", "Bring your own model providers (OpenAI, Anthropic, Gemini, Bedrock, Ollama and 20+ more). Secrets are encrypted at rest and never leave your deployment."],
  [Icon.Approvals, "Explicit permissions", "Autonomy levels 0–4, per-dimension policies, budgets with hard stops, and approval gates for anything externally visible."],
  [Icon.Eye, "Total observability", "Every model call, tool call, decision, artifact and cost is recorded and streamed live. Inspect what happened, why, and under which authorization."],
  [Icon.Server, "Self-hosted, open source", "Postgres + Redis + Temporal. One docker compose. Your data, your infrastructure, your rules."],
] as const;

const PIPELINE = ["Event", "Plan", "Policy", "Route", "Execute", "Verify", "Persist"];

export default async function Landing() {
  const me = await getMeOptional();
  if (me.user) redirect("/app");
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 border-b-2 border-line bg-panel">
        <nav className="mx-auto flex h-13 max-w-6xl items-center justify-between px-4 sm:px-6" aria-label="Primary">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Icon.Logo size={22} />
            Steward
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn btn-ghost">Sign in</Link>
            <Link href="/register" className="btn btn-primary">Get started</Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-20 sm:px-6 md:pt-28">
        <section className="nb-hero rise-in mx-auto max-w-5xl text-left">
          <span className="pill pill-accent mb-6">
            <Icon.Sparkle size={14} />
            Open source · Apache-2.0
          </span>
          <h1 className="text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">
            An autonomous operating system for your company — that you actually control.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            Describe a business. Steward builds a team of AI agents that research, build, ship and grow it — running unattended, pausing for your approval when it matters, and leaving a complete audit trail.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/register" className="btn btn-primary h-11 px-5 text-[15px]">
              Create your first company
              <Icon.ArrowRight size={16} />
            </Link>
            <a href="/api/v1/openapi.json" className="btn h-11 px-5 text-[15px]">API reference</a>
          </div>
        </section>

        <section className="rise-in-delayed mx-auto mt-12 max-w-5xl" aria-label="How a run flows">
          <div className="card nb-left-purple flex flex-wrap items-center justify-center gap-y-3 px-4 py-4 sm:justify-between sm:px-6">
            {PIPELINE.map((step, i) => (
              <span key={step} className="flex items-center gap-2 text-sm">
                <span className={`mono text-[13px] ${i === 0 || i === PIPELINE.length - 1 ? "text-accent" : "text-fg-2"}`}>{step}</span>
                {i < PIPELINE.length - 1 && <Icon.ChevronRight size={14} className="text-faint" />}
              </span>
            ))}
          </div>
          <p className="mt-3 text-center text-xs text-muted">Every step is recorded with its model, tool, cost and authorization — then persisted before the next event fires.</p>
        </section>

        <section className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-label="Capabilities">
          {PILLARS.map(([Glyph, title, body]) => (
            <article key={title} className="card nb-left-blue">
              <span className="nb-panel-flat mb-4 flex h-10 w-10 items-center justify-center p-0 text-accent">
                <Glyph size={18} />
              </span>
              <h2 className="text-[15px] font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </article>
          ))}
        </section>
      </main>

      <footer className="hairline mx-auto max-w-6xl border-x-0 border-b-0 px-4 py-8 text-xs text-muted sm:px-6">
        Steward is open source (Apache-2.0). Self-host it anywhere Docker runs.
      </footer>
    </div>
  );
}
