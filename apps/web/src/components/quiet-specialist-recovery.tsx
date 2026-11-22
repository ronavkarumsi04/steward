"use client";

import { useRouter } from "next/navigation";
import { useT } from "./locale-provider";

export function SpecialistRecovery({ forbidden }: { forbidden: boolean }) {
  const router = useRouter();
  const t = useT();
  return <section className="q-specialist-recovery" role="alert">
    <h1 className="desk-title">{t(forbidden ? "quiet.specialistPermission" : "quiet.specialistUnavailable")}</h1>
    <p>{t(forbidden ? "quiet.specialistPermissionHelp" : "quiet.specialistUnavailableHelp")}</p>
    {!forbidden && <button type="button" className="btn" onClick={() => router.refresh()}>{t("quiet.specialistRetry")}</button>}
  </section>;
}
