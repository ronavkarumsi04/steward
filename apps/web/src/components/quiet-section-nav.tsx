"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Native fragment links on desktop; a persistent, compact section chooser on phones. */
export function QuietSectionNav({ label, items, children }: { label: string; items: ReadonlyArray<readonly [string, string]>; children?: ReactNode }) {
  const rail = useRef<HTMLElement>(null);
  const [active, setActive] = useState(items[0]?.[0] ?? "");

  useEffect(() => {
    const element = rail.current;
    const scope = element?.closest<HTMLElement>(".q-depth");
    if (!element || !scope) return;
    let frame = 0;
    const targets = items.map(([id]) => ({ id, element: document.getElementById(id) })).filter((target): target is { id: string; element: HTMLElement } => !!target.element);
    const update = () => {
      frame = 0;
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      const threshold = mobile ? element.getBoundingClientRect().bottom + 16 : Number.parseFloat(getComputedStyle(targets[0]?.element ?? element).scrollMarginTop) || 96;
      const atEnd = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      let current = items[0]?.[0] ?? "";
      let nearest = -Infinity;
      for (const target of targets) {
        const top = target.element.getBoundingClientRect().top;
        if ((atEnd || top <= threshold + 1) && top > nearest) { current = target.id; nearest = top; }
      }
      setActive(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(() => {
      scope.style.setProperty("--depth-nav-height", `${element.offsetHeight}px`);
      schedule();
    });
    resize.observe(element);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
      scope.style.removeProperty("--depth-nav-height");
    };
  }, [items]);

  return <aside ref={rail} className="q-depth-rail">
    <nav aria-label={label}><ul>{items.map(([id, title]) => <li key={id}><a href={`#${id}`} aria-current={active === id ? "location" : undefined} onClick={() => setActive(id)}>{title}</a></li>)}</ul></nav>
    <label className="q-depth-section-select"><span>{label}</span><select className="input" value={active} onChange={(event) => { const id = event.currentTarget.value; setActive(id); window.location.hash = id; }}>{items.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
    {children}
  </aside>;
}
