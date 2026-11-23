"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Native fragment links; phones use an in-flow disclosure with wrapping labels. */
export function QuietSectionNav({ label, items, children }: { label: string; items: ReadonlyArray<readonly [string, string]>; children?: ReactNode }) {
  const [active, setActive] = useState(items[0]?.[0] ?? "");
  const picker = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);

  useEffect(() => {
    let frame = 0;
    const targets = items.map(([id]) => ({ id, element: document.getElementById(id) })).filter((target): target is { id: string; element: HTMLElement } => !!target.element);
    const firstTarget = targets[0]?.element;
    if (!firstTarget) return;
    const update = () => {
      frame = 0;
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      const threshold = mobile ? 16 : Number.parseFloat(getComputedStyle(firstTarget).scrollMarginTop) || 96;
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
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
    };
  }, [items]);

  return <aside className="q-depth-rail">
    <nav aria-label={label}><ul>{items.map(([id, title]) => <li key={id}><a href={`#${id}`} aria-current={active === id ? "location" : undefined} onClick={() => setActive(id)}>{title}</a></li>)}</ul></nav>
    <details ref={picker} className="q-depth-section-picker" onKeyDown={(event) => {
      if (event.key !== "Escape" || !event.currentTarget.open) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.open = false;
      summary.current?.focus();
    }}>
      <summary ref={summary}><span className="sr-only">{label}: </span>{items.find(([id]) => id === active)?.[1] ?? label}</summary>
      <nav aria-label={label}><ul>{items.map(([id, title]) => <li key={id}><a href={`#${id}`} aria-current={active === id ? "location" : undefined} onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        setActive(id);
        if (picker.current) picker.current.open = false;
        // Keep the anchor's native hash/history behavior. Move focus after its
        // default action and the closed picker's new layout have settled.
        requestAnimationFrame(() => {
          const destination = document.getElementById(id);
          if (!destination) { summary.current?.focus(); return; }
          if (!destination.hasAttribute("tabindex")) destination.tabIndex = -1;
          destination.focus({ preventScroll: true });
          destination.scrollIntoView({ block: "start" });
        });
      }}>{title}</a></li>)}</ul></nav>
    </details>
    {children}
  </aside>;
}
