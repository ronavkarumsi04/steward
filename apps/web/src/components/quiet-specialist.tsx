import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { workspaceShell } from "@/lib/workspace-theme";
import { getLocale } from "@/lib/server";
import { t } from "@/lib/i18n";
import { QuietSpecialistProvider } from "./quiet-specialist-context";
import { SpecialistRecovery } from "./quiet-specialist-recovery";
import { PageSkeleton } from "./feedback";
import "@/app/app/quiet-specialist.css";

export function quietSpecialistEnabled() {
  return workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet";
}

/** Share presentation, not data: every surface retains its existing scoped API reads and actions. */
export async function specialistPage(surface: string, render: () => Promise<ReactNode>) {
  if (!quietSpecialistEnabled()) return render();
  try {
    return <QuietSpecialistProvider surface={surface}>{await render()}</QuietSpecialistProvider>;
  } catch (error) {
    // Preserve Next redirects/notFound and unexpected exceptions. Never expose API bodies or secrets.
    const networkFailure = error instanceof TypeError && /fetch|network/i.test(error.message);
    if (!(error instanceof ApiError) && !networkFailure) throw error;
    if (error instanceof ApiError && error.status === 401) throw error;
    if (error instanceof ApiError && error.status === 404) notFound();
    return <QuietSpecialistProvider surface={surface}><SpecialistRecovery forbidden={error instanceof ApiError && error.status === 403} /></QuietSpecialistProvider>;
  }
}

export async function SpecialistLoading() {
  if (!quietSpecialistEnabled()) return <PageSkeleton />;
  const locale = await getLocale();
  return <div className="q-specialist q-specialist-loading" role="status" aria-busy="true" aria-label={t(locale, "activity.loading")}><span className="sr-only">{t(locale, "activity.loading")}</span><div /><div /><div /></div>;
}
