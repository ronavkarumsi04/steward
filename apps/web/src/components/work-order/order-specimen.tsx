import { StewardMark } from "@/components/brand";
import s from "./work-order.module.css";

/** Illustrative, deliberately static: a filed work order is not a live activity feed. */
export function OrderSpecimen() {
  return (
    <figure className={s.specimen} aria-labelledby="sample-caption">
      <figcaption id="sample-caption" className={s.sampleHead}><StewardMark size={20} /> Example work order <span>No. 000412</span></figcaption>
      <div className={s.sampleBody}>
        <blockquote>“Fix the checkout bug before Friday’s launch, then tell me what changed.”</blockquote>
        <ol className={s.sampleTrail}>
          <li><time>14:01:12</time><span>Plan accepted</span></li>
          <li><time>14:01:40</time><span>Engineering patch tested</span></li>
          <li><time>14:02:05</time><strong>Release approved by you</strong></li>
        </ol>
      </div>
      <div className={s.sampleReceipt}><span>Recorded cost</span><strong>$0.41 <small>/ $5.00 budget</small></strong></div>
      <p className={s.sampleNote}>Illustration, not a live run. In Steward, every step is recorded.</p>
    </figure>
  );
}
