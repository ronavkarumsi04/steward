import Link from "next/link";
import { redirect } from "next/navigation";
import { getMeOptional } from "@/lib/server";

const PILLARS = [
  ["Persistent agents", "Orchestrator, research, engineering, marketing, sales, support, finance and operations agents that plan and execute against your goals — on a schedule or on demand."],
  ["Durable by design", "Every run is a Temporal workflow: retries, approval pauses, timers and crash recovery are first-class. Nothing is lost when a worker restarts."],
  ["You hold the keys", "Bring your own model providers (OpenAI, Anthropic, Gemini, Bedrock, Ollama and 20+ more). Secrets are encrypted at rest and never leave your deployment."],
  ["Explicit permissions", "Autonomy levels 0–4, per-dimension policies, budgets with hard stops, and approval gates for anything externally visible."],
  ["Total observability", "Every model call, tool call, decision, artifact and cost is recorded and streamed live. Inspect what happened, why, and under which authorization."],
  ["Self-hosted, open source", "Postgres + Redis + Temporal. One docker compose. Your data, your infrastructure, your rules."],
];

export default async function Landing() {
  const me = await getMeOptional();
  if (me.user) redirect("/app");
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <nav className="mb-16 flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">Steward</span>
        <div className="flex gap-2">
          <Link href="/login" className="btn">Sign in</Link>
          <Link href="/register" className="btn btn-primary">Get started</Link>
        </div>
      </nav>
      <section className="mb-20">
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
          An autonomous operating system for your company — that you actually control.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">
          Describe a business. Steward builds a team of AI agents that research, build, ship and grow it — running unattended, pausing for your approval when it matters, and leaving a complete audit trail.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/register" className="btn btn-primary">Create your first company</Link>
          <a href="/api/v1/openapi.json" className="btn">API reference</a>
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map(([title, body]) => (
          <div key={title} className="card">
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-2 text-sm text-muted">{body}</p>
          </div>
        ))}
      </section>
      <footer className="mt-20 text-xs text-muted">Steward is open source (Apache-2.0). Self-host it anywhere Docker runs.</footer>
    </main>
  );
}
