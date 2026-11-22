import Link from "next/link";
import { QuietPublicFrame } from "./quiet-public";
import { StewardMark } from "./brand";
import { Icon } from "./icons";
import { EntryForm } from "./work-order/entry-form";
import { LandingStory } from "./work-order/landing-story";

function WorkflowIllustration() {
  return (
    <figure className="public-workflow" aria-labelledby="workflow-caption">
      <div className="workflow-top"><span><StewardMark size={20} />Company workspace</span><span>Illustrative preview</span></div>
      <div className="workflow-body">
        <div className="workflow-heading"><h2>Work, with a clear next step.</h2><span className="workflow-state">Needs your decision</span></div>
        <div className="workflow-decision"><span>Approval</span><h3>Review before anything goes out.</h3><p>The proposed action, its context and the evidence. Together, before you decide.</p><div className="workflow-evidence"><Icon.Check size={16} /><span>Plan and supporting evidence attached</span></div><span className="workflow-review">You keep the authority <Icon.ArrowRight size={16} /></span></div>
        <ol className="workflow-steps"><li><span className="workflow-dot" /><div><strong>Give the work a goal</strong><span>Company context stays with the job</span></div><span>Plan</span></li><li><span className="workflow-dot" /><div><strong>Agents move it forward</strong><span>Within your policies and budget</span></div><span>Work</span></li><li><span className="workflow-dot" /><div><strong>Keep the evidence</strong><span>Inspect the steps and the outcome</span></div><span>Record</span></li></ol>
      </div>
      <figcaption id="workflow-caption">An illustration of the workflow, not a live company or run.</figcaption>
    </figure>
  );
}

const CAPABILITIES = [
  ["A team with company context", "Persistent agents work across engineering, research, sales, support, marketing and finance. Not a new conversation for every job."],
  ["Boundaries before action", "Set autonomy from 0 to 4, category budgets and approval gates. The consequential steps wait for the authority your policy requires."],
  ["A record you can inspect", "Follow the plan, model calls, tool calls, approvals and costs. Keep evidence with the work, instead of piecing it together later."],
  ["Your tools. Your model keys.", "Connect the services you use and bring your own provider keys. Provider usage is separate from the assisted pilot fee."],
] as const;

export function QuietHome({ entry, label, note, story }: { entry: string; label: string; note: string; story: boolean }) {
  return (
    <QuietPublicFrame>
      {story ? <div className="quiet-story"><LandingStory entryForm={<EntryForm id="hero-email" action={entry} label={label} note={note} />} /></div> : <section className="public-hero" aria-labelledby="hero-title">
        <div><h1 id="hero-title">Your company,<br /><span>moving forward.</span><br />You, in control.</h1><p className="public-lede">Give AI agents the work. Keep the decisions that matter. Steward brings your team, tools and company context into one accountable workspace.</p><div className="public-hero-actions"><Link href="/pilot/waitlist" className="btn btn-primary">Request access <Icon.ArrowRight size={18} /></Link><Link href="#how" className="public-text-link">See how it works <Icon.ArrowRight size={16} /></Link></div><p className="public-access-note">Invitation-only assisted setup. No account is created by joining the waitlist.</p></div>
        <WorkflowIllustration />
      </section>}
      <section id="how" className="public-how" aria-labelledby="how-title"><div><h2 id="how-title">Less chasing.<br /><span>More considered progress.</span></h2><p>One place to delegate, see what is moving and make the next decision. The work → evidence → decision loop stays visible.</p></div><ol><li><span>Delegate</span><h3>Start with an outcome.</h3><p>Give the team a goal, the context and the boundaries. Agents plan the work before they act.</p></li><li><span>Inspect</span><h3>See what led here.</h3><p>Review the work and its evidence, not just a confident answer. Plans and tool calls stay on the record.</p></li><li><span>Decide</span><h3>Stay in the right loop.</h3><p>Review actions that need your approval. Your policy defines how far the work can go without you.</p></li></ol></section>
      <section className="public-capabilities" aria-labelledby="capabilities-title"><h2 id="capabilities-title">Built for the work<br />behind the company.</h2><dl>{CAPABILITIES.map(([title, detail]) => <div key={title}><dt>{title}</dt><dd>{detail}</dd></div>)}</dl></section>
      <section className="public-pilot" aria-labelledby="pilot-title"><div><h2 id="pilot-title">A thoughtful first step.</h2><p>Start with the Steward Assisted Pilot. Get hands-on help setting up your workspace and running your first workflow.</p><Link href="/pilot" className="public-text-link">Explore the assisted pilot <Icon.ArrowRight size={18} /></Link></div><div><p className="public-price">$49 <span>USD · once</span></p><p>No subscription or automatic renewal. Provider usage billed separately. Invitation-only; payment does not create an account.</p></div></section>
      <section className="public-closing" aria-labelledby="closing-title"><div><h2 id="closing-title">Already have access?</h2><p>The workspace is ready when you are.</p></div><EntryForm id="closing-email" action={entry} label={label} note={note} /></section>
    </QuietPublicFrame>
  );
}
