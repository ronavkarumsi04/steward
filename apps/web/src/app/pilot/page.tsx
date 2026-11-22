import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { PublicFrame } from "@/components/work-order/public-frame";
import s from "@/components/work-order/work-order.module.css";

export const metadata: Metadata = {
  title: "Assisted pilot",
  description: "An invite-only Steward pilot with hands-on onboarding for your first workspace and workflow.",
  alternates: { canonical: "/pilot" },
};

const STEPS = [
  ["Request an invitation", "We invite teams from the Steward waitlist. Joining is free and does not create an account."],
  ["Arrange onboarding", "If invited, we’ll reach out to schedule your onboarding and help set up one Steward workspace."],
  ["Run your first workflow", "We’ll help you configure one workflow and show you how to review approvals, budgets and the run record."],
] as const;

function stripePaymentLink(value: string | undefined): string | null {
  const url = URL.parse(value?.trim() ?? "");
  if (!url || url.origin !== "https://buy.stripe.com" || url.username || url.password || !/^\/[A-Za-z0-9_]+$/.test(url.pathname)) return null;
  return url.href;
}

export default async function PilotPage() {
  await connection();
  const paymentLink = stripePaymentLink(process.env.STEWARD_PILOT_PAYMENT_LINK);

  return (
    <PublicFrame current="pilot">
      <section className={s.spread} aria-labelledby="pilot-title">
        <div className={s.leadColumn}>
          <p className={s.kicker}>Early access · By invitation</p>
          <h1 id="pilot-title" className={s.h1}>Steward <span>Assisted Pilot</span></h1>
          <p className={s.lede}>Get hands-on help setting up Steward and running your first workflow. We onboard invited teams ourselves; this is not self-serve signup.</p>
        </div>
        <div className={s.rate} data-tone="canary">
          <h2 className={s.fieldLabel}>One workspace · One guided setup</h2>
          <p className={s.ratePrice}>$49 <small>USD · One-time fee</small></p>
          <p className={s.rateNote}>No subscription or automatic renewal. Bring your own model key; provider usage is billed separately by your provider.</p>
          {paymentLink ? (
            <>
              <a className="btn btn-primary w-fit" href={paymentLink} aria-describedby="pilot-cta-note">Buy the pilot</a>
              <p id="pilot-cta-note" className={s.signNote}>Already invited? Pay on Stripe. Payment does not create a Steward account.</p>
            </>
          ) : (
            <>
              <Link className="btn btn-primary w-fit" href="/pilot/waitlist" aria-describedby="pilot-cta-note">Join the waitlist</Link>
              <p id="pilot-cta-note" className={s.signNote}>The pilot is not open for payment yet. Joining does not reserve a spot.</p>
            </>
          )}
        </div>
      </section>

      <section className={s.leaf} aria-labelledby="pilot-steps">
        <div className={s.leafHead}>
          <h2 id="pilot-steps" className={s.h2}>How it works</h2>
        </div>
        <ol className={s.conditions}>
          {STEPS.map(([title, detail]) => (
            <li key={title}>
              <h3 className={s.h3}>{title}</h3>
              <p>{detail}</p>
            </li>
          ))}
        </ol>
      </section>
    </PublicFrame>
  );
}
