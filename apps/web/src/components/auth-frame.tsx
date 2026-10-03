import Link from "next/link";
import type { ReactNode } from "react";
import { StewardMark } from "./brand";

/** Shared public access frame; the same identity extends through every auth state. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="access-frame">
      <header className="access-header">
        <Link
          href="/"
          className="inline-flex items-center gap-3 text-xl font-semibold tracking-tight"
        >
          <StewardMark size={28} />
          steward
        </Link>
        <Link href="/legal" className="text-sm text-muted hover:text-fg">
          Trust &amp; legal ↗
        </Link>
      </header>
      <main className="access-main">
        <section className="access-story" aria-labelledby="access-story-title">
          <p className="eyebrow">Your company, connected.</p>
          <h2 id="access-story-title">
            A place for <br />
            your next <em>chapter.</em>
          </h2>
          <p>
            Intent becomes work. Work leaves evidence.
            <br />
            You stay in control of what happens next.
          </p>
          <div className="access-folio" aria-hidden="true">
            <StewardMark size={80} />
            <span>STEWARD / COMPANY OS</span>
            <div>
              Context.
              <br />
              Continuity.
              <br />
              Control.
            </div>
            <small>Built around the work that matters.</small>
          </div>
        </section>
        <div className="access-form">{children}</div>
      </main>
      <footer className="access-footer">
        <span>© {new Date().getFullYear()} Ronav Karumsi</span>
        <Link href="/">Back to Steward ←</Link>
      </footer>
    </div>
  );
}
