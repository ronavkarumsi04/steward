import Link from "next/link";
import type { Membership } from "@/lib/types";

const TABS = [
  ["providers", "AI providers"],
  ["integrations", "Integrations"],
  ["members", "Members"],
] as const;

export function OrgHeader({ orgId, membership, title }: { orgId: string; membership: Membership | undefined; title: string }) {
  return (
    <header className="mb-6">
      <div className="eyebrow mb-1">
        {membership?.name ?? "Organization"} · {membership?.role ?? "—"}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <nav aria-label="Organization settings" className="segmented">
          {TABS.map(([slug, label]) => (
            <Link key={slug} href={`/app/org/${orgId}/${slug}`} aria-current={label === title ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
