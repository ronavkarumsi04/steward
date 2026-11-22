import Link from "next/link";
import type { ReactNode } from "react";
import { StewardMark } from "./brand";

/** Shared public access frame: the same work-order pad as the landing page, around every auth state. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="paper access-frame public-family">
      <a className="quiet-skip" href="#access-main">Skip to content</a>
      <header className="access-binding">
        <div>
          <Link href="/" className="inline-flex items-center gap-2.5 text-lg font-bold" style={{ fontStretch: "112%" }}>
            <StewardMark size={22} />
            Steward
          </Link>
          <Link href="/legal" className="text-[15px]">
            Trust &amp; legal
          </Link>
        </div>
      </header>
      <main id="access-main" className="access-main">
        <div className="access-form">{children}</div>
        <aside className="access-guide" aria-labelledby="access-guide-title">
          <h2 id="access-guide-title">Joining a team?</h2>
          <p>Use the invitation from your organization admin. Open it with the email address they invited.</p>
          <Link href="/legal/support">Contact support</Link>
        </aside>
      </main>
      <footer className="access-footer">
        <span>Form STW-1 · © {new Date().getFullYear()} Steward</span>
        <Link href="/">Back to Steward</Link>
      </footer>
    </div>
  );
}
