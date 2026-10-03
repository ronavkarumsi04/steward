import {
  BrandMark,
  PlanScene,
  BuildScene,
  VerifyScene,
  ApprovalScene,
} from "./scenes";
import s from "./showcase.module.css";

/** One casing and three physical leaves persist through the entire scroll narrative. */
export function JourneyObject() {
  return (
    <div className={s.journeyObject} data-journey-object aria-hidden="true">
      <div className={s.folioGround} />
      <div className={s.folioAssembly} data-folio-assembly>
        <div className={`${s.folioLeaf} ${s.folioSource}`}>
          <span>OWNED SOURCE</span>
          <i />
          <i />
          <i />
        </div>
        <div className={`${s.folioLeaf} ${s.folioEvidence}`}>
          <span>RUN EVIDENCE</span>
          <i />
          <i />
          <i />
        </div>
        <div className={`${s.folioLeaf} ${s.folioDecision}`}>
          <span>YOUR DECISION</span>
          <BrandMark size={42} />
        </div>
        <div className={s.folioCase}>
          <div className={s.folioChrome}>
            <BrandMark size={18} />
            <span>Northstar / Launch website</span>
            <span>STEWARDSHIP IN MOTION</span>
          </div>
          <div className={s.folioDisplay}>
            {[PlanScene, BuildScene, VerifyScene, ApprovalScene].map(
              (Scene, index) => (
                <div
                  className={s.folioFace}
                  data-folio-face={index}
                  key={index}
                >
                  <Scene />
                </div>
              ),
            )}
          </div>
          <div className={s.folioSpine}>
            <span>Intent</span>
            <i />
            <span>Source</span>
            <i />
            <span>Evidence</span>
            <i />
            <span>Decision</span>
          </div>
        </div>
      </div>
      <p className={s.folioCaption}>One workspace. The work stays connected.</p>
    </div>
  );
}
