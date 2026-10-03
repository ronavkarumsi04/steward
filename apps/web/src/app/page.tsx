import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { getMeOptional, getAuthConfig } from "@/lib/server";
import { Icon } from "@/components/icons";
import { landingArrival } from "@/lib/arrivals";
import { JourneyObject } from "@/components/showcase/journey-object";
import { ScrollShowcase } from "@/components/showcase/scroll";
import {
  ArrowGlyph,
  BrandMark,
  CompanyCanvas,
  PlanScene,
  BuildScene,
  VerifyScene,
  ApprovalScene,
  StudioArt,
} from "@/components/showcase/scenes";
import s from "@/components/showcase/showcase.module.css";

export const metadata: Metadata = {
  title: { absolute: "Steward — Big ideas. Real momentum." },
  description:
    "An AI-native operating system for building and operating companies. Bring agents, studios, workflows and company knowledge together, with you in control.",
};
const ARRIVAL = landingArrival();
const CHAPTERS = [
  {
    id: "intent",
    title: "Start with intent.",
    number: "01",
    label: "Give it direction",
    copy: "A business starts with a point of view. Give your agents the goal, the context and the boundaries. Make the plan visible before the work begins.",
    Scene: PlanScene,
  },
  {
    id: "build",
    title: "Make it tangible.",
    number: "02",
    label: "Build in context",
    copy: "Move between Site Studio and Code IDE. Work with the design, inspect the source and review proposed changes in your company’s workspace.",
    Scene: BuildScene,
  },
  {
    id: "verify",
    title: "Evidence over instinct.",
    number: "03",
    label: "Inspect the work",
    copy: "Use browser traces, test output and run records to understand what happened. A finished-looking screen is the start of verification, not the end.",
    Scene: VerifyScene,
  },
  {
    id: "decide",
    title: "You call the shots.",
    number: "04",
    label: "Keep control",
    copy: "Policies and budgets define the room to act. Approvals govern the consequential steps. Inspect the proposal before a change leaves your workspace.",
    Scene: ApprovalScene,
  },
];
const STUDIOS = [
  {
    id: "site-studio",
    name: "A place to build.",
    tag: "SITE STUDIO + CODE IDE",
    copy: "Visual editing, owned source, versions and proposed changes. Design and engineering can share the same starting point.",
    kind: "site" as const,
  },
  {
    id: "workflow-studio",
    name: "A way to operate.",
    tag: "WORKFLOW STUDIO + AGENTS",
    copy: "Turn repeatable work into inspectable workflows. Connect agents and tools behind explicit policies and approval gates.",
    kind: "workflow" as const,
  },
  {
    id: "company-memory",
    name: "A memory to grow.",
    tag: "KNOWLEDGE GRAPH + MEMORY",
    copy: "Keep company context close to the work: facts, relationships, provenance and memories that can be reviewed and corrected.",
    kind: "memory" as const,
  },
];

export default async function Landing() {
  const [me, auth] = await Promise.all([getMeOptional(), getAuthConfig()]);
  if (me.user) redirect("/app");
  const open = auth?.signupOpen === true;
  const entry = open ? "/register" : "/login";
  const entryLabel = open ? "Create your company" : "Enter workspace";
  return (
    <ScrollShowcase className={s.home}>
      <a className={s.skipLink} href="#main">
        Skip to content
      </a>
      <header className={s.header}>
        <nav className={s.nav} aria-label="Primary">
          <Link href="/" className={s.brand} aria-label="Steward home">
            <BrandMark /> steward
          </Link>
          <div className={s.navMiddle}>
            <a href="#story">The story</a>
            <a href="#studios">The workspace</a>
            <a href="#control">Your control</a>
          </div>
          <Link href={entry} className={s.navCta}>
            {open ? "Get started" : "Sign in"}
            <Icon.ArrowRight size={15} />
          </Link>
        </nav>
      </header>
      <main id="main">
        <section className={s.hero} aria-labelledby="hero-title" data-hero>
          <div className={`${s.heroEyebrow} rise-in`}>
            <span className={s.tinyStar}>✳︎</span> THE COMPANY OPERATING SYSTEM{" "}
            <span className={s.edition}>BUILT FOR WHAT’S NEXT / 001</span>
          </div>
          <h1
            data-sc-copy
            id="hero-title"
            className={`${s.heroTitle} rise-in`}
            style={
              { "--enter-delay": `${ARRIVAL.delayMs(1)}ms` } as CSSProperties
            }
          >
            Big ideas.
            <br />
            <span>
              Real <em>momentum.</em>
            </span>
          </h1>
          <div
            className={`${s.heroBottom} rise-in`}
            style={
              { "--enter-delay": `${ARRIVAL.delayMs(2)}ms` } as CSSProperties
            }
          >
            <p data-sc-copy>
              One place to build and operate your company.
              <br />
              AI agents, connected tools, and you at the controls.
            </p>
            <div className={s.heroActions}>
              <Link href={entry} className={s.button}>
                {entryLabel}
                <Icon.ArrowRight size={18} />
              </Link>
              <a className={s.textLink} href="#story">
                Explore the story <span>↓</span>
              </a>
            </div>
          </div>
          <div className={s.heroMeta}>
            <span>BUILT BY RONAV KARUMSI.</span>
            <span>
              {open
                ? "YOUR COMPANY. YOUR CONTROL."
                : auth
                  ? "HOSTED ACCESS BY INVITATION."
                  : "HOSTED ACCESS STATUS UNAVAILABLE."}
            </span>
          </div>
        </section>
        <section
          className={s.zoom}
          data-zoom
          data-sc-act="pin"
          aria-label="A closer look at the company workspace"
        >
          <div className={s.zoomSticky} data-sc-stage>
            <div className={s.zoomBackdrop} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className={s.orbitLabel}>
              An idea.
              <br />
              <em>A whole operating system.</em>
              <span>
                <ArrowGlyph direction="down-right" />
              </span>
            </div>
            <div className={s.canvasTransform}>
              <CompanyCanvas />
            </div>

            <span className={s.canvasDisclaimer}>
              Illustrative product preview · not a live company
            </span>
          </div>
        </section>
        <section className={s.bridge}>
          <span className={s.eyebrow}>LESS FRAGMENTATION. MORE FORWARD.</span>
          <h2 data-sc-copy>
            Your company doesn’t
            <br />
            happen in <em>one tab.</em>
          </h2>
          <div className={s.bridgeBottom}>
            <span className={s.bridgeSymbol} aria-hidden="true">
              ↳
            </span>
            <p data-sc-copy>
              Give the work a shared home. Bring your agents, your context and
              your decisions into one connected system.
            </p>
            <a
              href="#story"
              className={s.circleLink}
              aria-label="Explore the workflow story"
            >
              <span aria-hidden="true">↓</span>
            </a>
          </div>
        </section>
        <section
          className={s.story}
          id="story"
          data-story
          data-sc-act="pin"
          aria-label="From idea to authorized action"
        >
          <div className={s.storySticky} data-sc-stage>
            <div className={s.storyIntro}>
              <span className={s.eyebrow}>THE STEWARD WAY</span>
              <h2 data-sc-copy>
                From “what if”
                <br />
                to <em>what’s next.</em>
              </h2>
              <nav className={s.chapterNav} aria-label="Workflow chapters">
                {CHAPTERS.map((chapter, index) => (
                  <a
                    href={`#${chapter.id}`}
                    data-chapter-link={index}
                    key={chapter.id}
                  >
                    <span>{chapter.number}</span>
                    {chapter.label}
                    <span className={s.chapterArrow}>
                      <ArrowGlyph />
                    </span>
                  </a>
                ))}
              </nav>
              <div className={s.storyMeter} aria-hidden="true">
                <span />
              </div>
              <p data-sc-copy className={s.storyDisclaimer}>
                An illustrated journey through Steward’s tools.
                <br />
                Execution depends on your configured services.
              </p>
            </div>
            <div className={s.chapterStage}>
              <JourneyObject />
              {CHAPTERS.map(({ id, title, copy, Scene, number }) => (
                <article
                  className={s.chapter}
                  id={id}
                  key={id}
                  data-chapter-panel
                >
                  <div className={s.chapterCopy}>
                    <span>{number} / FOUR CHAPTERS</span>
                    <h3 data-sc-copy>{title}</h3>
                    <p data-sc-copy>{copy}</p>
                  </div>
                  <Scene />
                </article>
              ))}
            </div>
          </div>
        </section>
        <section
          className={s.studios}
          id="studios"
          data-rail
          data-sc-act="pan"
          aria-labelledby="studios-title"
        >
          <div className={s.railSticky} data-sc-stage>
            <div className={s.studioHeading}>
              <div>
                <span className={s.eyebrow}>
                  ONE SYSTEM. MANY WAYS FORWARD.
                </span>
                <h2 data-sc-copy id="studios-title">
                  Space for your
                  <br />
                  <em>whole company.</em>
                </h2>
              </div>
              <div className={s.studioNav}>
                <span>
                  EXPLORE THE WORKSPACE <ArrowGlyph />
                </span>
                <nav aria-label="Workspace showcase">
                  {STUDIOS.map((studio, index) => (
                    <a
                      key={studio.id}
                      href={`#${studio.id}`}
                      data-rail-link={index}
                      aria-label={`0${index + 1}: Explore ${studio.tag}`}
                    >
                      0{index + 1}
                    </a>
                  ))}
                </nav>
              </div>
            </div>
            <div className={s.railViewport}>
              <div className={s.studioTrack} data-track data-sc-pan>
                {STUDIOS.map((studio, index) => (
                  <article
                    className={s.studioCard}
                    key={studio.id}
                    id={studio.id}
                  >
                    <div className={s.studioCardTop}>
                      <span>{studio.tag}</span>
                      <span>0{index + 1} / 03</span>
                    </div>
                    <StudioArt kind={studio.kind} />
                    <div className={s.studioCardCopy}>
                      <h3 data-sc-copy>{studio.name}</h3>
                      <p data-sc-copy>{studio.copy}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className={s.railMeter} aria-hidden="true">
              <span />
            </div>
          </div>
        </section>
        <section
          className={s.control}
          id="control"
          aria-labelledby="control-title"
        >
          <div className={s.controlTop}>
            <span className={s.eyebrow}>AUTONOMY NEEDS A FOUNDATION.</span>
            <h2 data-sc-copy id="control-title">
              Ambitious by nature.
              <br />
              <em>Accountable by design.</em>
            </h2>
            <p data-sc-copy>
              Give your company room to move without losing sight of the work.
            </p>
          </div>
          <div className={s.controlGrid}>
            {[
              [
                Icon.Approvals,
                "You set the boundaries.",
                "Per-company policies, budgets and approval gates define what your agents are authorized to do.",
              ],
              [
                Icon.Eye,
                "The record stays with you.",
                "Inspect runs, steps, tool calls and decisions. Every step is recorded so you can trace the work and diagnose failures.",
              ],
              [
                Icon.Server,
                "Your stack. Your choice.",
                "Connect your model providers and integrations. Keep company permissions scoped and credentials encrypted at rest.",
              ],
            ].map(([Glyph, title, copy]) => {
              const G = Glyph as typeof Icon.Eye;
              return (
                <article key={title as string}>
                  <G size={24} />
                  <h3 data-sc-copy>{title as string}</h3>
                  <p data-sc-copy>{copy as string}</p>
                </article>
              );
            })}
          </div>
        </section>
        <section className={s.finalCta}>
          <span className={s.eyebrow}>
            FOR THE THING YOU CAN’T STOP THINKING ABOUT.
          </span>
          <h2 data-sc-copy>
            Let’s give it
            <br />
            <em>some momentum.</em>
            <span aria-hidden="true">
              <ArrowGlyph />
            </span>
          </h2>
          <div className={s.finalBottom}>
            <p data-sc-copy>
              The idea is yours.
              <br />
              Make Steward your place to move it forward.
            </p>
            <Link href={entry} className={s.button}>
              {entryLabel}
              <Icon.ArrowRight size={20} />
            </Link>
          </div>
        </section>
      </main>
      <footer className={s.footer}>
        <Link href="/" className={s.brand}>
          <BrandMark /> steward
        </Link>
        <span>
          A COMPANY OS, BUILT WITH INTENT.
          <br />© 2026 Ronav Karumsi. All rights reserved.
        </span>
        <nav aria-label="Footer">
          <a href="/api/v1/openapi.json">
            API reference <ArrowGlyph />
          </a>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/login">Sign in</Link>
        </nav>
        <a href="#main" className={s.backTop}>
          BACK TO TOP ↑
        </a>
      </footer>
    </ScrollShowcase>
  );
}
