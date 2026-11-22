import Link from "next/link";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { depthCopy } from "@/lib/depth-copy";
import type { Locale } from "@/lib/i18n";
import "@/app/app/quiet-depth.css";

export function QuietDepth({ title, description, children, action }: { title: string; description: string; children: ReactNode; action?: ReactNode }) {
  return <div className="q-decision-page q-depth"><header className="q-page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</header>{children}</div>;
}

export function DepthFailure({ error, href, locale }: { error?: unknown; href: string; locale: Locale }) {
  const c = depthCopy(locale);
  const denied = error instanceof ApiError && [401, 403, 404].includes(error.status);
  return <div className="q-notice q-depth-failure" role="alert"><p>{denied ? c.denied : c.failed}</p><Link className="q-link" href={href}>{c.retry}</Link></div>;
}

export function DepthLoading({ locale }: { locale: Locale }) {
  return <div className="q-depth q-depth-loading" role="status" aria-busy="true"><p>{depthCopy(locale).loading}</p><div /><div /><div /></div>;
}

export { QuietSectionNav } from "./quiet-section-nav";

/** Same section-local recovery language used by the decision/work screens. No raw API errors. */
export function QuietUnavailable({ href, locale = "en" }: { href: string; locale?: Locale }) {
  // A native, fragment-free navigation reruns server fetches even when already on this page.
  return <p className="q-depth-notice" role="status">{locale === "es" ? "No se pudo cargar esta sección. El resto del trabajo sigue disponible." : "This section could not be loaded. Other work is still available."} <a className="q-link" href={href.split("#")[0]}>{locale === "es" ? "Reintentar" : "Try again"}</a></p>;
}

export function QuietPageHeading({ title, description, scope, actions, level = 1 }: { title: string; description?: ReactNode; scope?: ReactNode; actions?: ReactNode; level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return <header className="q-depth-heading"><div><Heading>{title}</Heading>{description && <p>{description}</p>}{scope && <div className="q-depth-scope">{scope}</div>}</div>{actions && <div className="q-depth-actions">{actions}</div>}</header>;
}

export function QuietTable({ label, children }: { label: string; children: ReactNode }) {
  return <div className="q-depth-table" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

/** No wrapper at all in legacy: incumbent spacing selectors and landmark structure stay intact. */
export function QuietDepthLayout({ quiet, navigation, children }: { quiet: boolean; navigation: ReactNode; children: ReactNode }) {
  if (!quiet) return <>{children}</>;
  return <div className="q-depth-layout">{navigation}<div className="q-depth-content">{children}</div></div>;
}

export function QuietDepthLoading({ label }: { label: string }) {
  return <div className="q-depth q-depth-page" role="status" aria-label={label}><div className="q-depth-heading"><div className="skeleton h-8 w-48 max-w-full" /></div><div className="q-depth-layout"><div className="skeleton h-48" /><div className="space-y-6"><div className="skeleton h-64" /><div className="skeleton h-48" /></div></div><span className="sr-only">{label}</span></div>;
}
