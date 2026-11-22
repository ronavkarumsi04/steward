"use client";

import { useEffect, useRef, useState } from "react";
import { storyFrame, storyProgress } from "@/lib/landing-story";
import type { PaperScene } from "./paper-scene";

type SceneState = "illustration" | "loading" | "ready" | "unavailable";

/** Coalesce events into one frame. No scroll-jacking, autoplay or per-pixel React state. */
export function useStoryController() {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [sceneState, setSceneState] = useState<SceneState>("illustration");

  useEffect(() => {
    const element = root.current;
    const surface = canvas.current;
    if (!element || !surface) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(pointer: fine)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const chapters = Array.from(element.querySelectorAll<HTMLElement>("section[id^='story-']"));
    const pointer = { x: 0, y: 0 };
    let app: PaperScene | null = null;
    let frame = 0;
    let alive = true;
    let visible = false;
    let loading = false;
    let failed = false;
    let attempt = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const fail = () => {
      if (!alive || failed) return;
      failed = true;
      attempt++;
      clearTimeout(timeout);
      app?.dispose();
      app = null;
      setSceneState("unavailable");
    };
    const paint = () => {
      frame = 0;
      if (!alive || document.hidden) return;
      const focus = window.innerHeight * (window.innerWidth > 960 ? .45 : .8);
      const progress = storyProgress(focus, chapters.map((chapter) => chapter.getBoundingClientRect().top));
      const current = storyFrame(progress);
      element.dataset.chapter = String(current.chapter);
      element.style.setProperty("--story-progress", String(progress));
      for (const link of element.querySelectorAll<HTMLAnchorElement>("[data-story-link]")) {
        if (Number(link.dataset.storyLink) === current.chapter) link.setAttribute("aria-current", "step");
        else link.removeAttribute("aria-current");
      }
      if (app && visible && !reduced.matches) {
        try {
          const { width, height } = surface.getBoundingClientRect();
          app.resize(width, height);
          app.render(progress, pointer);
        } catch { fail(); }
      }
    };
    const schedule = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(paint);
    };
    const load = async () => {
      if (loading || failed || app || !visible || reduced.matches || connection?.saveData || document.hidden) return;
      loading = true;
      const token = ++attempt;
      setSceneState("loading");
      const timer = setTimeout(fail, 15000);
      timeout = timer;
      try {
        const { createPaperScene } = await import("./paper-scene");
        await document.fonts.ready;
        if (!alive || reduced.matches || token !== attempt) return;
        app = createPaperScene(surface);
        paint();
        if (!failed) setSceneState("ready");
      } catch {
        if (alive && token === attempt && !reduced.matches) fail();
      } finally {
        clearTimeout(timer);
        loading = false;
        if (alive && token !== attempt && !failed && !reduced.matches) void load();
      }
    };
    const sync = () => {
      element.dataset.storyMotion = reduced.matches || connection?.saveData ? "false" : "true";
      if (reduced.matches) {
        attempt++;
        clearTimeout(timeout);
        app?.dispose();
        app = null;
        setSceneState("illustration");
      } else void load();
      schedule();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      sync();
    });
    observer.observe(surface);
    const contextLost = (event: Event) => { event.preventDefault(); fail(); };
    const move = (event: PointerEvent) => {
      if (!app || !finePointer.matches || reduced.matches || !visible) return;
      const rect = surface.getBoundingClientRect();
      pointer.x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
      pointer.y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
      schedule();
    };
    const leave = () => { pointer.x = pointer.y = 0; schedule(); };
    const stage = surface.parentElement!;
    stage.addEventListener("pointermove", move, { passive: true });
    stage.addEventListener("pointerleave", leave);
    surface.addEventListener("webglcontextlost", contextLost);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", sync);
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    resize.observe(stage);
    sync();

    return () => {
      alive = false;
      attempt++;
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      observer.disconnect();
      resize.disconnect();
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerleave", leave);
      surface.removeEventListener("webglcontextlost", contextLost);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", sync);
      app?.dispose();
    };
  }, []);

  return { root, canvas, sceneState };
}
