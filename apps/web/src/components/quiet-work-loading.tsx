import { workCopy } from "@/lib/work-copy";
import type { Locale } from "@/lib/i18n";

export function QuietWorkLoading({ locale }: { locale: Locale }) {
  const c = workCopy(locale);
  return <div className="q-decision-page q-work-loading" role="status" aria-busy="true"><h1>{c.work}</h1><p>{c.refresh}…</p><div aria-hidden="true"><div /><div /><div /></div></div>;
}
