import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { legalConfig, legalContactChannel, documentsForHub } from "@/lib/legal";

export default async function LegalLayout({ children }: { children: ReactNode }) {
  const cfg = legalConfig();
  const docs = documentsForHub();
  const everyone = docs.filter((d) => d.audience === "everyone");
  const business = docs.filter((d) => d.audience === "business-customers");

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-[var(--z-nav)] border-b border-line bg-bg shadow-e1">
        <div className="mx-auto flex h-13 max-w-[1360px] items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-black tracking-tight">
            <Icon.Logo size={22} />
            Steward
            <span className="hidden text-sm font-semibold text-muted sm:inline">/ Legal</span>
          </Link>
          <nav aria-label="Legal" className="flex items-center gap-2">
            <Link href="/legal" className="btn btn-ghost">
              All documents
            </Link>
            <Link href="/" className="btn btn-ghost hidden sm:inline-flex">
              Home
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1360px] gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[240px_1fr] lg:py-12">
        <nav aria-label="Document list" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <p className="label mb-2">Everyone</p>
          <ul className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible">
            {everyone.map((doc) => (
              <li key={doc.slug}>
                <Link href={`/legal/${doc.slug}`} className="block whitespace-nowrap rounded-lg px-3 py-2 text-sm lg:whitespace-normal font-medium text-fg-2 hover:bg-panel-2 hover:text-fg">
                  {doc.title}
                </Link>
              </li>
            ))}
          </ul>
          <p className="label mb-2 mt-5">Business customers</p>
          <ul className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible">
            {business.map((doc) => (
              <li key={doc.slug}>
                <Link href={`/legal/${doc.slug}`} className="block whitespace-nowrap rounded-lg px-3 py-2 text-sm lg:whitespace-normal font-medium text-fg-2 hover:bg-panel-2 hover:text-fg">
                  {doc.title}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs leading-relaxed text-muted">
            Questions, requests, or a report: <span className="font-medium text-fg-2">{legalContactChannel()}</span>
          </p>
        </nav>

        <main className="min-w-0">{children}</main>
      </div>

      <footer className="hairline mx-auto max-w-[1200px] border-x-0 border-b-0 px-4 py-8 text-xs text-muted sm:px-6">
        {cfg.operator}. Steward is proprietary software. All rights reserved. Governing law: {cfg.governingLaw}.
      </footer>
    </div>
  );
}
