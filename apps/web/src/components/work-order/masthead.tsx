import Link from "next/link";
import { StewardMark } from "@/components/brand";
import s from "./work-order.module.css";

export function Masthead({ current, href, label }: { current: "home" | "pricing" | "compare"; href: string; label: string }) {
  return (
    <header className={s.binding}>
      <nav className={s.bindingInner} aria-label="Primary">
        <Link href="/" className={s.brand} aria-label="Steward home">
          <StewardMark size={28} /> Steward
        </Link>
        <div className={s.navLinks}>
          <Link href="/#how">How it works</Link>
          <Link href="/#workspace">Workspace</Link>
          <Link href="/pricing" aria-current={current === "pricing" ? "page" : undefined}>Pricing</Link>
          <Link href="/compare" aria-current={current === "compare" ? "page" : undefined}>Compare</Link>
        </div>
        <div className={s.navActions}>
          {href !== "/login" && <Link href="/login" className={s.navSignIn}>Sign in</Link>}
          <Link href={href} className={s.navCta}>{label}</Link>
        </div>
      </nav>
    </header>
  );
}
