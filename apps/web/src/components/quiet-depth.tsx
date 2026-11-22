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
