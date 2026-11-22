"use client";
import { useEffect, type RefObject } from "react";

/** Measure the actual wrapping controls, including safe-area padding, instead of guessing a pixel sum. */
export function useBarHeight(ref: RefObject<HTMLElement | null>, variable: "--quiet-nav-height" | "--quiet-action-height", active = true) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const element = ref.current;
    const root = document.documentElement;
    const update = () => root.style.setProperty(variable, `${element.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { observer.disconnect(); root.style.removeProperty(variable); };
  }, [ref, variable, active]);
}
