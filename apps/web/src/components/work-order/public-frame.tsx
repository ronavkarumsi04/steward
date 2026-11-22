import Link from "next/link";
import type { ReactNode } from "react";
import { getAuthConfig } from "@/lib/server";
import { Masthead } from "./masthead";
import { Icon } from "@/components/icons";
import { Pad } from "@/components/work-order/pad";
import s from "@/components/work-order/work-order.module.css";
import { quietPublicEnabled } from "@/lib/public-design";
import { QuietPublicFrame } from "@/components/quiet-public";

/** Where a visitor can go from a public page: the sign-up form while sign-up is open, otherwise the workspace door. */
export async function publicEntry(): Promise<{ href: string; label: string; open: boolean; state: "open" | "closed" | "unknown" }> {
  const auth = await getAuthConfig();
  // `null` is an outage, not a closed door: say so rather than claim access is by invitation.
  const state = auth === null ? "unknown" : auth.signupOpen === true ? "open" : "closed";
  return state === "open" ? { href: "/register", label: "Create your company", open: true, state } : { href: "/login", label: "Enter workspace", open: false, state };
}

/** The pad's binding and footer around any public page that is not the landing itself. */
export async function PublicFrame({ current, children }: { current: "pricing" | "compare" | "pilot"; children: ReactNode }) {
  if (quietPublicEnabled(process.env)) return <QuietPublicFrame current={current}>{children}</QuietPublicFrame>;
  const entry = current === "pilot" ? { href: "/login", label: "Sign in" } : await publicEntry();
  return (
    <Pad className={`paper ${s.home}`}>
      <a className={s.skip} href="#main">
        Skip to content
      </a>
      <Masthead current={current} href={entry.href} label={entry.label} />

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
