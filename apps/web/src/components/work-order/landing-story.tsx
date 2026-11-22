"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { StewardMark } from "@/components/brand";
import { Icon } from "@/components/icons";
import { useStoryController } from "./use-story-controller";
import s from "./landing-story.module.css";

const CHAPTERS = [
  { id: "brief", label: "The instruction" },
  { id: "plan", label: "The work" },
  { id: "gate", label: "The approval" },
  { id: "evidence", label: "The record" },
] as const;

/** The page's copy and entry form are real HTML; the 3D layer is never an access requirement. */
export function LandingStory({ entryForm }: { entryForm: ReactNode }) {
  const { root, canvas, sceneState } = useStoryController();
  return (
    <div ref={root} className={s.story} data-chapter="0" data-story-motion="false" data-scene-state={sceneState}>
      <section id="story-brief" className={s.intro} aria-labelledby="hero-title" data-hero>
        <h1 id="hero-title" className={s.headline}>Agents do the work.<br /><span>You keep<br /> the record.</span></h1>
        <p className={s.lede}>Give AI agents a job, a budget and rules for when to ask you. Get back the work and a record of every step.</p>
        {entryForm}
        <Link href="#story-plan" className={s.follow}>Follow an instruction <Icon.ArrowRight size={18} /></Link>
      </section>

      <aside className={s.visual} aria-label="Work order illustration">
        <div className={s.stage}>
          <div className={s.registration} aria-hidden="true"><span>STW / 001</span><span>ONE ORDER · THREE COPIES</span></div>
          <div className={s.artifact} aria-hidden="true">
            <div className={`${s.sheet} ${s.record}`}>
              <div className={s.sheetHeader}><span>RECORD COPY</span><StewardMark size={20} /></div>
              <div className={s.sheetBody}><span className={s.sheetTitle}>Nothing off<br />the books.</span><div className={s.receiptLine}><span>Plan</span><span>On file</span></div><div className={s.receiptLine}><span>Tool calls</span><span>On file</span></div><div className={s.receiptLine}><span>Decision</span><span>On file</span></div><div className={s.receiptLine}><span>Evidence</span><span>On file</span></div></div>
              <div className={s.sheetFoot}>A record you can inspect.</div>
            </div>
            <div className={`${s.sheet} ${s.approval}`}>
              <div className={s.sheetHeader}><span>APPROVAL COPY</span><StewardMark size={20} /></div>
              <div className={s.sheetBody}><span className={s.sheetTitle}>Your call.<br />Before it ships.</span><div className={s.authority}><span>Authority</span><strong>Yours to set</strong></div><div className={s.authority}><span>Consequential action</span><strong>Waits for approval</strong></div><div className={s.signature}>Your decision goes here.</div></div>
              <div className={s.sheetFoot}>The agent cannot sign for you.</div>
            </div>
            <div className={`${s.sheet} ${s.work}`}>
              <div className={s.sheetHeader}><span>WORK ORDER</span><StewardMark size={20} /></div>
              <div className={s.sheetBody}><span className={s.instructionLabel}>Instruction</span><span className={s.sheetTitle}>A job.<br />A budget.<br />A boundary.</span><div className={s.route}><span>Plan</span><Icon.ArrowRight size={16} /><span>Act</span><Icon.ArrowRight size={16} /><span>Verify</span></div></div>
              <div className={s.sheetFoot}><span className={s.stamp}>Accountable autonomy</span></div>
            </div>
          </div>
          <canvas ref={canvas} className={s.canvas} aria-hidden="true" />
          <div className={s.stageRule} aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
        </div>
        <p className={s.caption}>Illustrated workflow, not a live company or run.</p>
        {sceneState === "loading" && <p className={s.fallbackNote} role="status">Loading 3D. The illustration remains available.</p>}
        {sceneState === "unavailable" && <p className={s.fallbackNote} role="status">3D is unavailable. The illustrated story is still here.</p>}
        <nav className={s.chapters} aria-label="Story chapters">
          {/* Next retains its history tree for Back after a chapter and a cross-page visit. */}
          {CHAPTERS.map((chapter, index) => <Link key={chapter.id} href={`#story-${chapter.id}`} data-story-link={index}><span>{String(index + 1).padStart(2, "0")}</span>{chapter.label}</Link>)}
        </nav>
      </aside>

      <section id="story-plan" className={s.chapter} aria-labelledby="story-plan-title">
        <span className={s.sequence}>01 → 02</span>
        <h2 id="story-plan-title">One instruction.<br /><span>A plan before action.</span></h2>
        <p>Hand over the outcome, not a stream of prompts. Steward turns the job into a durable run, with a plan and the agents that do the work.</p>
        <p className={s.annotation}>Engineering, research, sales, support, marketing and finance. One company context.</p>
      </section>
      <section id="story-gate" className={s.chapter} aria-labelledby="story-gate-title">
        <span className={s.sequence}>02 → 03</span>
        <h2 id="story-gate-title">Momentum.<br /><span>With a boundary.</span></h2>
        <p>Set autonomy and budget ceilings. Consequential steps stop at the approval gate, with the plan in front of you. You decide what happens next.</p>
        <p className={s.annotation}>A decision is not a decorative green light. It is authority to act.</p>
      </section>
      <section id="story-evidence" className={s.chapter} aria-labelledby="story-evidence-title">
        <span className={s.sequence}>03 → 04</span>
        <h2 id="story-evidence-title">The work moves on.<br /><span>The evidence stays.</span></h2>
        <p>Inspect the plan, every model and tool call, the cost and the approval that allowed each step. Cancel a run and the remaining side effects stop.</p>
        <Link href="#how" className={s.follow}>Inspect the three copies <Icon.ArrowRight size={18} /></Link>
        <a href="/pilot" className={s.pilot}>Explore the assisted pilot</a>
      </section>
    </div>
  );
}
