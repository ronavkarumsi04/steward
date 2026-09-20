import Link from "next/link";
import type { Membership } from "@/lib/types";

export function OrgHeader({ orgId, membership, title }: { orgId: string; membership: Membership | undefined; title: string }) {
  const tabs = [["providers", "AI providers"], ["integrations", "Integrations"], ["members", "Members"]];
  return (
    <header className="mb-4">
      <div className="text-xs text-muted">{membership?.name ?? "Organization"} · your role: {membership?.role ?? "—"}</div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        <nav className="flex gap-1 text-sm">
          {tabs.map(([slug, label]) => <Link key={slug} href={`/app/org/${orgId}/${slug}`} className="btn">{label}</Link>)}
        </nav>
      </div>
    </header>
  );
}
