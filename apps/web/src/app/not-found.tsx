import Link from "next/link";
import { Icon } from "@/components/icons";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(900px_500px_at_50%_-10%,var(--bg-tint),transparent_70%)] p-4 sm:p-6">
      <section aria-labelledby="nf-title" className="card rise-in w-full max-w-md p-6 text-center shadow-e2 sm:p-7">
        <Link href="/" className="inline-flex rounded-xl p-1" aria-label="Steward home">
          <Icon.Logo size={36} />
        </Link>
        <p className="mono mt-4 text-xs uppercase tracking-widest text-muted">404</p>
        <h1 id="nf-title" className="mt-1 text-xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">The link may be outdated, or the resource belongs to an organization you&apos;re not a member of.</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/app" className="btn btn-primary h-11 w-full text-[15px]">Go to your workspace</Link>
          <Link href="/" className="btn btn-ghost h-11 w-full text-[15px]">Back to home</Link>
        </div>
      </section>
    </main>
  );
}
