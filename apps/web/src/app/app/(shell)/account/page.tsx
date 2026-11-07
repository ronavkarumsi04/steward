import Link from "next/link";
import { LEGAL_DOCUMENTS } from "@steward/legal";
import { LanguageSelect } from "@/components/language-select";
import { DeleteAccountForm, MarketingConsentToggle } from "@/components/privacy-controls";
import { getLocale, requireMe, serverApi } from "@/lib/server";
import { t, tf, type MessageKey } from "@/lib/i18n";
import type { PendingAgreement } from "@/lib/types";

export async function generateMetadata() {
  return { title: t(await getLocale(), "account.title") };
}

interface AgreementRecord {
  id: string;
  document: string;
  version: string;
  statement: string;
  source: string;
  ip: string | null;
  acceptedAt: string;
}

interface PrivacyRequestRecord {
  id: string;
  kind: string;
  status: string;
  details: string;
  createdAt: string;
  fulfilledAt: string | null;
}

export default async function AccountPage() {
  const [me, api] = await Promise.all([requireMe("/app/account"), serverApi()]);
  const locale = await getLocale();
  const T = (key: MessageKey) => t(locale, key);
  const [agreements, requests, marketing] = await Promise.all([
    api.get<{ accepted: Array<{ document: string; version: string; acceptedAt: string }>; history: AgreementRecord[]; pending: PendingAgreement[]; versions: Record<string, string> }>("/auth/agreements"),
    api.get<{ requests: PrivacyRequestRecord[] }>("/privacy/requests").catch(() => ({ requests: [] as PrivacyRequestRecord[] })),
    api.get<{ marketing: { optedIn: boolean | null; updatedAt: string | null } }>("/privacy/marketing-consent").catch(() => ({ marketing: { optedIn: null, updatedAt: null } })),
  ]);

  const titles = new Map<string, string>(LEGAL_DOCUMENTS.map((d) => [d.slug, d.title] as const));
  // Never chosen is treated as off, but the copy below says so rather than implying a prior opt-out.
  const marketingOn = marketing.marketing.optedIn === true;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-3 py-6 sm:px-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{T("account.title")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {T("account.intro")}
        </p>
      </header>

      <section className="card p-5" aria-labelledby="agreements">
        <h2 id="agreements" className="text-[15px] font-semibold">
          {T("account.agreed")}
        </h2>
        <p className="mt-1 text-sm text-muted">{T("account.agreedHelp")}</p>
        {agreements.pending.length > 0 && (
          <p role="alert" className="nb-panel-flat nb-left-red mt-3 px-3 py-2 text-sm text-danger">
            {agreements.pending.length === 1
              ? tf(locale, "account.outstandingOne", { titles: agreements.pending.map((p) => p.title).join(", ") })
              : tf(locale, "account.outstandingMany", { n: agreements.pending.length, titles: agreements.pending.map((p) => p.title).join(", ") })}
          </p>
        )}
        <table className="mt-4 w-full border-collapse text-left text-sm">
          <caption className="sr-only">{T("account.historyCaption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="border border-line bg-panel-2 px-3 py-2 font-semibold">{T("account.colDocument")}</th>
              <th scope="col" className="border border-line bg-panel-2 px-3 py-2 font-semibold">{T("account.colVersion")}</th>
              <th scope="col" className="border border-line bg-panel-2 px-3 py-2 font-semibold">{T("account.colAccepted")}</th>
            </tr>
          </thead>
          <tbody>
            {agreements.history.map((row) => (
              <tr key={row.id}>
                <td className="border border-line px-3 py-2">
                  <Link href={`/legal/${row.document}`} className="font-medium text-accent hover:underline">
                    {titles.get(row.document) ?? row.document}
                  </Link>
                </td>
                <td className="border border-line px-3 py-2 font-mono text-xs">{row.version}</td>
                <td className="border border-line px-3 py-2 text-muted">{new Date(row.acceptedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-5" aria-labelledby="preferences">
        <h2 id="preferences" className="text-[15px] font-semibold">
          {T("account.comms")}
        </h2>
        <div className="mt-3">
          <MarketingConsentToggle optedIn={marketingOn} />
          {marketing.marketing.optedIn === null && <p className="mt-2 text-xs text-muted">{T("account.marketingUnset")}</p>}
        </div>
      </section>

      <section className="card p-5" aria-labelledby="export">
        <h2 id="export" className="text-[15px] font-semibold">
          {T("account.export")}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {T("account.exportHelp")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/api/v1/privacy/export" className="btn btn-primary h-10" download>
            {T("account.download")}
          </a>
          {me.memberships.map((m) => (
            <a key={m.organizationId} href={`/api/v1/privacy/export?organizationId=${m.organizationId}`} className="btn h-10" download>
              {tf(locale, "account.orgExport", { name: m.name })}
            </a>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{T("account.exportLogged")}</p>
      </section>

      <section className="card p-5" aria-labelledby="requests">
        <h2 id="requests" className="text-[15px] font-semibold">
          {T("account.requests")}
        </h2>
        {requests.requests.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{T("account.noRequests")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {requests.requests.map((r) => (
              <li key={r.id} className="nb-panel-flat flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-medium capitalize">{r.kind.replace("_", " ")}</span>
                <span className="text-xs text-muted">
                  {r.status} · {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {T("account.contactBefore")} <Link href="/legal/privacy" className="font-medium text-accent hover:underline">{T("account.privacyPolicy")}</Link>{T("account.contactAfter")}
        </p>
      </section>

      <section className="card border-danger p-5" aria-labelledby="danger">
        <h2 id="danger" className="text-[15px] font-semibold text-danger">
          {T("account.delete")}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {T("account.deleteBefore")} <Link href="/legal/retention" className="font-medium text-accent hover:underline">{T("account.retentionPolicy")}</Link>{T("account.deleteAfter")}
        </p>
        <div className="mt-3">
          <DeleteAccountForm />
        </div>
      </section>

      {/* Not an account setting: the design system is documented here because this is where a curious person
          already is, and because the interface is something you are entitled to read. */}
      <section className="card p-5" aria-labelledby="interface">
        <h2 id="interface" className="text-[15px] font-semibold">
          {T("account.interface")}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {T("account.interfaceHelp")}
        </p>
        <LanguageSelect current={me.user.locale} />
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {T("account.languageHelp")}
        </p>
        <p className="mt-3">
          <Link href="/app/design" className="btn">
            {T("account.openDesign")}
          </Link>
        </p>
      </section>
    </div>
  );
}
