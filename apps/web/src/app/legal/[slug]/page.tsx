import Link from "next/link";
import { notFound } from "next/navigation";
import { LegalBlock, LegalTable } from "@/components/legal-blocks";
import { activeSubprocessors, connectedServices, documentBySlug, legalConfig, legalContactChannel, legalSlugs, retentionRules } from "@/lib/legal";

export function generateStaticParams() {
  return legalSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = documentBySlug(slug);
  if (!doc) return { title: "Legal" };
  return { title: doc.title, description: doc.summary };
}

export default async function LegalDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = documentBySlug(slug);
  if (!doc) notFound();
  const cfg = legalConfig();

  return (
    <article>
      <header className="border-b-2 border-line pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-fg-2">{doc.summary}</p>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>
            Version <strong className="text-fg-2">{doc.version}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Effective <strong className="text-fg-2">{doc.effectiveDate}</strong>
          </span>
          {doc.requiresAcceptance && (
            <>
              <span aria-hidden="true">·</span>
              <span className="pill pill-accent">Part of the registration agreement</span>
            </>
          )}
        </p>
      </header>

      {/* Tables generated from the deployment's own configuration, so the page cannot drift from reality. */}
      {slug === "subprocessors" && <SubprocessorTables />}
      {slug === "integrations" && <ConnectedServiceTable />}
      {slug === "retention" && <RetentionTable />}

      <div className="mt-8">
        {doc.sections.map((section) => (
          <section key={section.id} id={section.id} className="mt-8 scroll-mt-20">
            <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>
            {section.blocks.map((block, i) => (
              <LegalBlock key={i} block={block} />
            ))}
          </section>
        ))}
      </div>

      <footer className="hairline mt-12 border-x-0 border-b-0 pt-6 text-sm leading-relaxed text-muted">
        <p>
          This is version {doc.version} of the {doc.title}, effective {doc.effectiveDate}. Previous versions are preserved in the project's git history so you can compare what changed.
        </p>
        <p className="mt-2">
          Questions or requests: <span className="font-medium text-fg-2">{legalContactChannel()}</span>. Operated by {cfg.operator}.
        </p>
        <p className="mt-2">
          <Link href="/legal" className="font-medium text-fg underline underline-offset-4">
            All legal documents
          </Link>
        </p>
      </footer>
    </article>
  );
}

function SubprocessorTables() {
  const active = activeSubprocessors();
  return (
    <section className="mt-8" aria-labelledby="subprocessor-table">
      <h2 id="subprocessor-table" className="text-lg font-semibold tracking-tight">
        Subprocessors in use in this deployment
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Generated from this deployment's configuration. A row only appears when the vendor is actually switched on.
      </p>
      <LegalTable
        head={["Vendor", "Role", "Data categories", "Location", "Transfer mechanism"]}
        rows={active.map((s) => [s.name, s.role, s.dataCategories.join("; ") || "—", s.location, s.transferMechanism])}
      />
    </section>
  );
}

function ConnectedServiceTable() {
  return (
    <section className="mt-8" aria-labelledby="connected-services">
      <h2 id="connected-services" className="text-lg font-semibold tracking-tight">
        Customer-connected services (not subprocessors)
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        You connect these, you hold the contract, and they act on your instructions. They are your providers, not ours.
      </p>
      <LegalTable head={["Service", "Category", "What enabling it lets Steward do", "Whose agreement governs"]} rows={connectedServices().map((s) => [s.name, s.category, s.access, s.contract])} />
    </section>
  );
}

function RetentionTable() {
  const rules = retentionRules();
  return (
    <section className="mt-8" aria-labelledby="retention-table">
      <h2 id="retention-table" className="text-lg font-semibold tracking-tight">
        Retention by data category
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The same configuration drives the scheduled deletion job, so what you read here is what the software enforces.
      </p>
      <LegalTable
        head={["Data", "Where it lives", "Why we keep it", "How long", "What deletion does"]}
        rows={rules.map((r) => [r.data, r.storage, r.purpose, r.retention, r.onDeletion])}
      />
    </section>
  );
}
