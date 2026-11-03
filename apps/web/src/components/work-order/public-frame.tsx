import Link from "next/link";
import type { ReactNode } from "react";
import { StewardMark } from "@/components/brand";
import { Icon } from "@/components/icons";
import { Pad } from "@/components/work-order/pad";
import s from "@/components/work-order/work-order.module.css";

/** The pad's binding and footer around any public page that is not the landing itself. */
export function PublicFrame({ current, children }: { current: "pricing" | "compare"; children: ReactNode }) {
  return (
    <Pad className={`paper ${s.home}`}>
      <a className={s.skip} href="#main">
        Skip to content
      </a>
      <header className={s.binding}>
        <nav className={s.bindingInner} aria-label="Primary">
          <Link href="/" className={s.brand} aria-label="Steward home">
            <StewardMark size={22} /> Steward
          </Link>
          <div className={s.navLinks}>
            <Link href="/#how">How it works</Link>
            <Link href="/pricing" aria-current={current === "pricing" ? "page" : undefined}>
              Pricing
            </Link>
            <Link href="/compare" aria-current={current === "compare" ? "page" : undefined}>
              Compare
            </Link>
          </div>
          <div className={s.navActions}>
            <Link href="/login" className={s.navSignIn}>
              Sign in
            </Link>
            <Link href="/register" className={s.navCta}>
              Create your company
            </Link>
          </div>
        </nav>
      </header>

      <main id="main" className={s.pad}>
        {children}
      </main>

      <footer className={s.footer}>
        <span>Form STW-1 · © 2026 Steward. All rights reserved.</span>
        <nav aria-label="Footer">
          <Link href="/pricing">Pricing</Link>
          <Link href="/compare">Compare</Link>
          <Link href="/legal">Trust &amp; legal</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <a href="/api/v1/openapi.json">API reference</a>
          <Link href="/login">Sign in</Link>
          <a href="#main">
            Back to top <Icon.ArrowRight size={14} className={s.up} />
          </a>
        </nav>
      </footer>
    </Pad>
  );
}
