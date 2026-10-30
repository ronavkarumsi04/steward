"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** The work-order pad. Records whether motion is welcome so tests and styles read one attribute. */
export function Pad({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      element.dataset.motion = media.matches ? "false" : "true";
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return (
    <div ref={root} className={className} data-motion="false">
      {children}
    </div>
  );
}
