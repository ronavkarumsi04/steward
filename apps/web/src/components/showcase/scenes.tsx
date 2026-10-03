import { Icon } from "@/components/icons";
import s from "./showcase.module.css";

import { StewardMark as BrandMark } from "@/components/brand";
export { BrandMark };

export function CompanyCanvas() {
  return (
    <div
      className={s.workspace}
      role="img"
      aria-label="Illustrative company workspace: a founder brief, site preview and workflow paused for human approval."
      data-product-canvas
    >
      <aside className={s.workspaceSidebar} aria-hidden="true">
        <span className={s.workspaceBrand}>
          <BrandMark /> steward
        </span>
        <span className={s.companySwitch}>
          <span>N</span> Northstar Studio <small>⌄</small>
        </span>
        <p>WORKSPACE</p>
        {[
          "Overview",
          "Agents",
          "Workflows",
          "Site Studio",
          "Code IDE",
          "Memory",
        ].map((label, index) => (
          <span key={label} className={index === 0 ? s.selectedNav : undefined}>
            <span>{["◈", "✳︎", "⌘", "▧", "⌥", "◇"][index]}</span>
            {label}
          </span>
        ))}
        <div className={s.sidebarBottom}>
          Your company. Your control.
          <br />
          <span>Illustrative product preview</span>
        </div>
      </aside>
      <div className={s.workspaceMain}>
        <div className={s.workspaceTop}>
          <span>
            Workspace / <strong>Overview</strong>
          </span>
          <span className={s.previewLabel}>PRODUCT PREVIEW</span>
        </div>
        <div className={s.workspaceHeading}>
          <div>
            <span className={s.eyebrow}>NORTHSTAR STUDIO</span>
            <p className={s.workspaceDisplayTitle}>
              Make room for
              <br />
              the next big thing.
            </p>
          </div>
          <span className={s.avatar}>N</span>
        </div>
        <div className={s.intent}>
          <span className={s.intentIcon}>✳︎</span>
          <div>
            <small>FOUNDER INTENT</small>
            <p>Build a better home for our next launch.</p>
          </div>
          <Icon.ArrowRight size={20} />
        </div>
        <div className={s.canvasColumns}>
          <div className={s.miniSite}>
            <div className={s.miniSiteNav}>
              northstar <span>Studio · Work · Contact</span>
            </div>
            <div className={s.miniSiteBody}>
              <span>INDEPENDENT BY DESIGN</span>
              <p className={s.miniTitle}>
                A little bold.
                <br />A lot possible.
              </p>
              <div className={s.miniSiteArt}>
                <i />
                <i />
                <i />
              </div>
              <div className={s.miniSiteFoot}>
                Good ideas deserve a beautiful beginning.{" "}
                <span>
                  <ArrowGlyph />
                </span>
              </div>
            </div>
          </div>
          <div className={s.runCard}>
            <div className={s.cardLabel}>
              LAUNCH WORKFLOW <span>01</span>
            </div>
            <p className={s.runTitle}>
              From brief to
              <br />
              reviewable work.
            </p>
            <ol>
              {[
                "Understand the brief",
                "Propose the change",
                "Run checks",
                "Request approval",
              ].map((item, i) => (
                <li key={item}>
                  <span className={i === 3 ? s.pendingDot : s.completeDot}>
                    {i === 3 ? "◷" : "✓"}
                  </span>
                  <span>{item}</span>
                  <small>{i === 3 ? "Human gate" : "Recorded"}</small>
                </li>
              ))}
            </ol>
            <div className={s.reviewBadge}>
              <Icon.Approvals size={15} /> You decide what ships.
            </div>
          </div>
        </div>
        <div className={s.canvasFooter}>
          <span>
            <i /> Policy → execution → evidence
          </span>
          <span>
            One connected workspace <ArrowGlyph />
          </span>
        </div>
      </div>
    </div>
  );
}

export function PlanScene() {
  return (
    <div className={`${s.scene} ${s.planScene}`}>
      <div className={s.sceneTop}>
        <span>01 / THE BRIEF</span>
        <span>ILLUSTRATIVE WORKFLOW</span>
      </div>
      <div className={s.promptBubble}>
        <span className={s.smallAvatar}>You</span>
        <p>
          Build a launch site for Northstar.
          <br />
          Make it feel like us.
        </p>
      </div>
      <div className={s.planConnector} aria-hidden="true" />
      <div className={s.planSheet}>
        <div className={s.sheetTitle}>
          <span>✳︎</span>
          <div>
            <small>ENGINEERING + DESIGN</small>
            <h3>A plan you can inspect.</h3>
          </div>
        </div>
        <div className={s.planRow}>
          <span>01</span>
          <div>
            <strong>Read the context</strong>
            <small>Brand, audience, existing source</small>
          </div>
          <span>◇</span>
        </div>
        <div className={s.planRow}>
          <span>02</span>
          <div>
            <strong>Build the proposal</strong>
            <small>Scoped changes. Clear acceptance criteria.</small>
          </div>
          <span>⌘</span>
        </div>
        <div className={s.planRow}>
          <span>03</span>
          <div>
            <strong>Verify before release</strong>
            <small>Checks, evidence, required approval</small>
          </div>
          <span>
            <ArrowGlyph />
          </span>
        </div>
      </div>
      <div className={s.sceneNote}>A goal becomes work with boundaries.</div>
    </div>
  );
}

export function BuildScene() {
  return (
    <div className={`${s.scene} ${s.buildScene}`}>
      <div className={s.sceneTop}>
        <span>02 / THE WORK</span>
        <span>ILLUSTRATIVE WORKFLOW</span>
      </div>
      <div className={s.editorBar}>
        <span>◈ Site Studio</span>
        <span>Desktop · 1440</span>
        <span>⌥ Code IDE</span>
      </div>
      <div className={s.editorSplit}>
        <div className={s.editorPreview}>
          <div className={s.miniSiteNav}>
            northstar{" "}
            <span>
              Menu <ArrowGlyph />
            </span>
          </div>
          <small>GOOD IDEAS START HERE</small>
          <h3>
            Build something
            <br />
            <em>worth finding.</em>
          </h3>
          <div className={s.selectionOutline}>
            <div className={s.editorSculpture}>
              <i />
              <i />
              <i />
            </div>
            <span>Hero / Visual</span>
          </div>
        </div>
        <div className={s.codePreview}>
          <span className={s.codeTab}>
            src / Hero.tsx <small>PROPOSED</small>
          </span>
          <pre>
            <code>{`export function Hero() {\n  return (\n    <section className="hero">\n      <h1>Build something\n        worth finding.</h1>\n      <LaunchVisual />\n    </section>\n  );\n}`}</code>
          </pre>
          <div className={s.codeChange}>
            + A change you can review
            <br />
            <span>Owned source. Visible differences.</span>
          </div>
        </div>
      </div>
      <div className={s.sceneNote}>
        Design and engineering, in the same workspace.
      </div>
    </div>
  );
}

export function VerifyScene() {
  return (
    <div className={`${s.scene} ${s.verifyScene}`}>
      <div className={s.sceneTop}>
        <span>03 / THE EVIDENCE</span>
        <span>ILLUSTRATIVE WORKFLOW</span>
      </div>
      <div className={s.browserBar}>
        <span>● ● ●</span>
        <span>preview / northstar</span>
        <Icon.Lock size={14} />
      </div>
      <div className={s.verifyBody}>
        <div className={s.browserPreview}>
          <span>northstar</span>
          <h3>
            Ready for
            <br />a closer look.
          </h3>
          <div className={s.browserArt} />
        </div>
        <div className={s.checkSheet}>
          <small>VERIFICATION RECORD</small>
          <h4>Show your work.</h4>
          {[
            "Browser interaction trace",
            "Accessibility checks",
            "Functional test output",
            "Source diff",
          ].map((item) => (
            <div key={item}>
              <Icon.Eye size={15} />
              <span>{item}</span>
              <span>
                <ArrowGlyph />
              </span>
            </div>
          ))}
          <p>
            Evidence belongs to the run.
            <br />A check must run to count.
          </p>
        </div>
      </div>
      <div className={s.sceneNote}>
        Inspect the evidence. Find the failure. Retry the work.
      </div>
    </div>
  );
}

export function ApprovalScene() {
  return (
    <div className={`${s.scene} ${s.approvalScene}`}>
      <div className={s.sceneTop}>
        <span>04 / YOUR DECISION</span>
        <span>ILLUSTRATIVE WORKFLOW</span>
      </div>
      <div className={s.approvalSheet}>
        <div className={s.approvalIcon}>
          <Icon.Approvals size={28} />
        </div>
        <span className={s.eyebrow}>HUMAN APPROVAL</span>
        <h3>
          The last word
          <br />
          is yours.
        </h3>
        <p>
          Review the proposal, its evidence and its policy before authorizing an
          external action.
        </p>
        <div className={s.approvalDetails}>
          <span>
            Proposed action<strong>Publish site changes</strong>
          </span>
          <span>
            Required decision<strong>Founder approval</strong>
          </span>
        </div>
        <div className={s.approvalGate}>
          <Icon.Lock size={16} /> Waiting for an authorized decision
        </div>
      </div>
      <div className={s.sceneNote}>
        Permission is a boundary. Every decision leaves a record.
      </div>
    </div>
  );
}

export function StudioArt({ kind }: { kind: "site" | "workflow" | "memory" }) {
  if (kind === "site")
    return (
      <div className={s.studioSite} aria-hidden="true">
        <div>
          northstar{" "}
          <span>
            <ArrowGlyph />
          </span>
        </div>
        <h4>
          Your next
          <br />
          <em>beginning.</em>
        </h4>
        <div className={s.studioShape}>
          <i />
          <i />
          <i />
        </div>
        <span className={s.selectionTag}>
          Hero / Heading{" "}
          <span>
            <ArrowGlyph direction="up-left" />
          </span>
        </span>
      </div>
    );
  if (kind === "workflow")
    return (
      <div className={s.studioFlow} aria-hidden="true">
        <span className={s.flowNode}>
          <ArrowGlyph /> <strong>Event trigger</strong>
        </span>
        <i />
        <span className={s.flowNode}>
          ✳︎ <strong>Agent step</strong>
        </span>
        <div className={s.flowFork}>
          <span>
            ◇<br />
            Policy check
          </span>
          <span>
            ✓<br />
            Approval
          </span>
        </div>
        <span className={s.flowEnd}>↓ Recorded outcome</span>
      </div>
    );
  return (
    <div className={s.studioGraph} aria-hidden="true">
      <svg viewBox="0 0 420 260">
        <path
          d="M210 130 90 50M210 130 340 50M210 130 330 220M210 130 90 210M90 50 340 50M90 210 330 220"
          stroke="currentColor"
          fill="none"
        />
        <circle cx="210" cy="130" r="46" />
        <circle cx="90" cy="50" r="23" />
        <circle cx="340" cy="50" r="23" />
        <circle cx="330" cy="220" r="23" />
        <circle cx="90" cy="210" r="23" />
        <text x="210" y="135" textAnchor="middle">
          Company
        </text>
        <text x="90" y="54" textAnchor="middle">
          Brand
        </text>
        <text x="340" y="54" textAnchor="middle">
          Goals
        </text>
        <text x="330" y="224" textAnchor="middle">
          Work
        </text>
        <text x="90" y="214" textAnchor="middle">
          Facts
        </text>
      </svg>
      <span>Context with provenance.</span>
    </div>
  );
}

/** SVG avoids platform emoji substitutions in the brand's directional marks. */
export function ArrowGlyph({
  direction = "up-right",
}: {
  direction?: "up-right" | "down-right" | "up-left";
}) {
  const angle =
    direction === "down-right" ? 90 : direction === "up-left" ? 270 : 0;
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <g transform={`rotate(${angle} 12 12)`}>
        <path
          d="M5 19 19 5M5 5h14v14"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
