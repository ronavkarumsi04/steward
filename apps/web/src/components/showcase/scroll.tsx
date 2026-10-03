"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  clamp,
  progress,
  chapterAt,
  folioPose,
  folioFaces,
} from "./scroll-model";

/** The document is the fallback. Only a capable desktop opts into pinned scenes. */
export function ScrollShowcase({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const media = window.matchMedia(
      "(min-width: 960px) and (min-height: 760px) and (prefers-reduced-motion: no-preference)",
    );
    const zoom = element.querySelector<HTMLElement>("[data-zoom]");
    const story = element.querySelector<HTMLElement>("[data-story]");
    const rail = element.querySelector<HTMLElement>("[data-rail]");
    const track = element.querySelector<HTMLElement>("[data-track]");
    const object = element.querySelector<HTMLElement>("[data-journey-object]");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const panels = Array.from(
      element.querySelectorAll<HTMLElement>("[data-chapter-panel]"),
    );
    const links = Array.from(
      element.querySelectorAll<HTMLAnchorElement>("[data-chapter-link]"),
    );
    let frame = 0;
    let active = -1;
    const paint = () => {
      frame = 0;
      if (!media.matches) return;
      const height = window.innerHeight;
      // Read geometry together before writing styles; no React render on a scroll frame.
      const zoomRect = zoom?.getBoundingClientRect();
      const storyRect = story?.getBoundingClientRect();
      const railRect = rail?.getBoundingClientRect();
      const overflow = track
        ? Math.max(0, track.scrollWidth - track.clientWidth)
        : 0;
      if (zoomRect) {
        const p = progress(zoomRect.top, zoomRect.height, height, 76);
        element.style.setProperty("--zoom-scale", String(0.86 + p * 0.24));
        element.style.setProperty("--zoom-y", `${-90 * (1 - p)}px`);
        element.style.setProperty("--zoom-tilt", `${8 * (1 - p)}deg`);
        element.style.setProperty("--orbit-opacity", String(1 - p));
      }
      if (storyRect) {
        const p = progress(storyRect.top, storyRect.height, height, 76);
        element.style.setProperty("--story-progress", String(p));
        const pose = folioPose(p);
        Object.entries(pose).forEach(([key, value]) =>
          element.style.setProperty(`--folio-${key}`, String(value)),
        );
        folioFaces(p).forEach((value, index) =>
          element.style.setProperty(`--folio-face-${index}`, String(value)),
        );
        if (object) {
          if (storyRect.top < height && storyRect.bottom > 76)
            object.dataset.scVerifyState = Object.values(pose)
              .map((value) => value.toFixed(3))
              .join(",");
          else delete object.dataset.scVerifyState;
        }
        const next = chapterAt(p, panels.length);
        if (next !== active) {
          active = next;
          panels.forEach((panel, index) => {
            panel.dataset.active = String(index === active);
            panel.inert = index !== active;
            panel.setAttribute("aria-hidden", String(index !== active));
          });
          links.forEach((link, index) => {
            if (index === active) link.setAttribute("aria-current", "step");
            else link.removeAttribute("aria-current");
          });
        }
      }
      if (railRect) {
        const p = progress(railRect.top, railRect.height, height, 76);
        element.style.setProperty("--rail-x", `${-p * overflow}px`);
        element.style.setProperty("--rail-progress", String(p));
      }
    };
    const schedule = () => {
      if (media.matches && !frame) frame = requestAnimationFrame(paint);
    };
    const locate = (hash: string, behavior: ScrollBehavior = "instant") => {
      const link = [
        ...links,
        ...element.querySelectorAll<HTMLAnchorElement>("[data-rail-link]"),
      ].find((candidate) => candidate.hash === hash);
      if (!link) return false;
      const section = link.hasAttribute("data-chapter-link") ? story : rail;
      if (!section) return false;
      const index = Number(link.dataset.chapterLink ?? link.dataset.railLink);
      const count = link.hasAttribute("data-chapter-link") ? panels.length : 3;
      const rect = section.getBoundingClientRect();
      window.scrollTo({
        top:
          window.scrollY +
          rect.top -
          76 +
          clamp(index / Math.max(1, count - 1)) *
            Math.max(0, rect.height - window.innerHeight + 76),
        behavior,
      });
      schedule();
      return true;
    };
    const hashChanged = () => {
      if (media.matches)
        locate(location.hash, reduced.matches ? "instant" : "smooth");
    };
    const configure = () => {
      // Preserve the chapter being read when motion is switched off or the viewport becomes narrow.
      const wasEnhanced = element.dataset.motion === "true";
      const rect = story?.getBoundingClientRect();
      const reading =
        wasEnhanced &&
        rect &&
        rect.top <= 76 &&
        rect.bottom >= window.innerHeight
          ? panels[active]
          : null;
      element.dataset.motion = String(media.matches);
      active = -1;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (!media.matches) {
        panels.forEach((panel) => {
          panel.inert = false;
          panel.removeAttribute("aria-hidden");
          delete panel.dataset.active;
        });
        links.forEach((link) => link.removeAttribute("aria-current"));
        [
          "--zoom-y",
          "--zoom-scale",
          "--zoom-tilt",
          "--orbit-opacity",
          "--story-progress",
          "--rail-x",
          "--rail-progress",
          ...["x", "y", "rx", "ry", "rz", "scale", "spread"].map(
            (key) => `--folio-${key}`,
          ),
          ...[0, 1, 2, 3].map((index) => `--folio-face-${index}`),
        ].forEach((key) => element.style.removeProperty(key));
        if (object) delete object.dataset.scVerifyState;
      } else paint();
      if (!media.matches && reading)
        reading.scrollIntoView({ block: "start", behavior: "instant" });
    };
    const navigate = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element).closest<HTMLAnchorElement>(
        'a[href^="#"]',
      );
      if (
        !link ||
        !element.contains(link) ||
        link.target ||
        link.hasAttribute("download") ||
        event.defaultPrevented
      )
        return;
      const target = document.getElementById(
        decodeURIComponent(link.hash.slice(1)),
      );
      if (!target) return;
      const behavior = reduced.matches ? "instant" : "smooth";
      if (!media.matches || !locate(link.hash, behavior))
        target.scrollIntoView({ block: "start", behavior });
      event.preventDefault();
      history.pushState(null, "", link.hash);
      // Only explicit chapter links move the document; wheel/touch/keyboard remain native.
    };
    configure();
    if (media.matches) locate(location.hash);
    window.addEventListener("hashchange", hashChanged);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    media.addEventListener("change", configure);
    element.addEventListener("click", navigate);
    const observer = new ResizeObserver(schedule);
    if (track) observer.observe(track);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("hashchange", hashChanged);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      media.removeEventListener("change", configure);
      element.removeEventListener("click", navigate);
    };
  }, []);
  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}
