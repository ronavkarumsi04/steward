import Link from "next/link";
import { LEGAL_DOCUMENTS, acceptanceDocuments, resolveDocument } from "@steward/legal";
import { legalConfig, legalContactChannel } from "@/lib/legal";

export const metadata = {
  title: "Legal",
  description: "Terms, privacy, data protection, and disclosure documents.",
};

export default async function LegalHub() {
  const cfg = legalConfig();
  const docs = LEGAL_DOCUMENTS.map((d) => resolveDocument(d, cfg));
  const required = acceptanceDocuments();

  return (
    <div>
      <p className="eyebrow">Clarity, by design</p>
      <h1 className="mt-4 text-5xl font-extrabold tracking-tight sm:text-6xl" style={{ fontStretch: "115%" }}>The terms of<br /><span className="text-accent">working together.</span></h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fg-2">
        Everything that governs the hosted {cfg.serviceName} service, in one place. Each document is versioned and dated, so you can always tell which version you agreed to.
      </p>

      <section aria-labelledby="required" className="card nb-left-purple mt-8 p-5">
        <h2 id="required" className="text-[15px] font-semibold">
          What you accept when you create an account
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          These three are part of the clickwrap: you must accept them to register, and we re-prompt you if we publish a new version.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          {required.map((d) => (
            <li key={d.slug}>
              <Link href={`/legal/${d.slug}`} className="nb-panel-flat block px-3 py-2 hover:border-fg">
                <span className="text-sm font-semibold">{d.title}</span>
                <span className="mt-1 block text-xs text-muted">version {d.version}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <dl className="mt-8 space-y-3">
        {docs.map((doc) => (
          <div key={doc.slug} className="card p-4">
            <dt className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/legal/${doc.slug}`} className="text-[15px] font-semibold text-fg hover:underline">
                {doc.title}
              </Link>
              <span className="text-xs text-muted">
                v{doc.version} · effective {doc.effectiveDate}
              </span>
            </dt>
            <dd className="mt-1 text-sm leading-relaxed text-muted">{doc.summary}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-8 text-sm leading-relaxed text-muted">
        Requests and questions go to <span className="font-medium text-fg-2">{legalContactChannel()}</span>. We do not have an incorporated legal entity;{" "}
        <Link href="/legal/terms" className="font-medium text-fg underline underline-offset-4">
          the Terms
        </Link>{" "}
        explain what that means for you.
      </p>
    </div>
  );
}
