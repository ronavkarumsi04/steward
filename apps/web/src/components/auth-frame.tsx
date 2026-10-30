import Link from "next/link";
import type { ReactNode } from "react";
import { StewardMark } from "./brand";

/** Shared public access frame: the same work-order pad as the landing page, around every auth state. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="paper access-frame">
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
      <main className="access-main">
        <section className="access-story" aria-labelledby="access-story-title">
          <div className="access-sheet">
            <div className="access-head">
              <span>Work order · Access</span>
              <span>No. 000001</span>
            </div>
            <h2 id="access-story-title">
              Sign the order. <span>Agents take it from there.</span>
            </h2>
            <p>Every task your agents take on is planned, budgeted and approved by you, and every step is recorded.</p>
            <dl className="access-fields">
              <div>
                <dt>Autonomy</dt>
                <dd>Set by you, level 0 to 4</dd>
              </div>
              <div>
                <dt>Approvals</dt>
                <dd>Consequential steps wait for you</dd>
              </div>
              <div>
                <dt>Record</dt>
                <dd>Plan, calls, cost and decisions kept</dd>
              </div>
            </dl>
          </div>
        </section>
        <div className="access-form">{children}</div>
      </main>
      <footer className="access-footer">
        <span>Form STW-1 · © {new Date().getFullYear()} Steward</span>
        <Link href="/">Back to Steward</Link>
      </footer>
    </div>
  );
}
