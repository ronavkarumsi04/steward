import Link from "next/link";
import type { ReactNode } from "react";
import { StewardMark } from "@/components/brand";
import { ThemeToggle } from "@/components/feedback";

export function QuietPublicFrame({ children, current }: { children: ReactNode; current?: string }) {
  return (
    <div className="public-family quiet-site">
      <a className="quiet-skip" href="#main">Skip to content</a>
      <header className="public-header">
        <Link href="/" className="public-brand" aria-label="Steward home"><StewardMark size={28} />Steward</Link>
        <nav aria-label="Main navigation">
          <Link href="/pilot" aria-current={current === "pilot" ? "page" : undefined}>Assisted pilot</Link>
          <Link href="/legal" aria-current={current === "legal" ? "page" : undefined}>Trust &amp; legal</Link>
        </nav>
        <div className="public-header-actions"><ThemeToggle /><Link href="/login" className="btn btn-ghost">Sign in</Link></div>
      </header>
      <main id="main" className="public-main">{children}</main>
      <footer className="public-footer">
        <Link href="/" className="public-brand"><StewardMark size={22} />Steward</Link>
        <p>Work with momentum. Keep the authority.</p>
        <nav aria-label="Footer"><Link href="/pricing">Pricing</Link><Link href="/compare">Compare</Link><Link href="/legal/terms">Terms</Link><Link href="/legal/privacy">Privacy</Link><Link href="/legal/support">Support</Link><a href="/api/v1/openapi.json">API reference</a></nav>
        <span>© {new Date().getFullYear()} Steward. All rights reserved.</span>
      </footer>
    </div>
  );
}
