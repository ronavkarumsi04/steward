"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { HOUSE_EASE, MOTION_MS } from "@/lib/motion";
import { usePathname, useRouter } from "next/navigation";

/** Progressive enhancement: Next still owns routing, loading, errors, history and focus. */
export function NavigationTransitions() {
  const router = useRouter();
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const arrival = useRef<Animation | null>(null);
  const pending = useRef<{ finish: () => void; skip: () => void } | null>(null);

  useLayoutEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    if (pending.current) pending.current.finish();
    else if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Browsers without snapshot transitions, and back/forward navigation, get an arrival fade.
      arrival.current?.cancel();
      arrival.current = document.body.animate(
        [{ opacity: 0.6 }, { opacity: 1 }],
        { duration: MOTION_MS.entrance, easing: HOUSE_EASE },
      );
    }
  }, [pathname]);

  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => {
      arrival.current?.cancel();
      pending.current?.skip();
      pending.current?.finish();
      pending.current = null;
      document.documentElement.dataset.pageTransition = "idle";
    };
    const preferenceChanged = () => {
      if (motion.matches) cancel();
    };
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        motion.matches ||
        !document.startViewTransition
      )
        return;
      const link = (
        event.target instanceof Element ? event.target : null
      )?.closest<HTMLAnchorElement>("a[href]");
      if (
        !link ||
        link.hasAttribute("download") ||
        link.hasAttribute("data-navigation-native") ||
        (link.target && link.target !== "_self")
      )
        return;
      const url = new URL(link.href, location.href);
      if (
        url.origin !== location.origin ||
        url.pathname === location.pathname ||
        url.pathname.startsWith("/api/") ||
        /\.[a-z0-9]+$/i.test(url.pathname)
      )
        return;
      event.preventDefault();
      cancel();
      let resolveUpdate = () => {};
      let routed = false;
      const route = () => {
        if (!routed) {
          routed = true;
          router.push(`${url.pathname}${url.search}${url.hash}`);
        }
      };
      const finish = () => {
        clearTimeout(timer);
        resolveUpdate();
      };
      const transition = (() => {
        try {
          return document.startViewTransition(
            () =>
              new Promise<void>((resolve) => {
                resolveUpdate = resolve;
                route();
              }),
          );
        } catch {
          // A browser may expose snapshot transitions but refuse to start one in this document.
          return null;
        }
      })();
      if (!transition) {
        route();
        return;
      }
      const current = { finish, skip: () => transition.skipTransition() };
      pending.current = current;
      document.documentElement.dataset.pageTransition = "pending";
      // A missing/slow route must never leave an animation holding navigation indefinitely.
      const timer = setTimeout(() => {
        route();
        transition.skipTransition();
        finish();
      }, 4000);
      const settled = () => {
        finish();
        if (pending.current === current) {
          pending.current = null;
          document.documentElement.dataset.pageTransition = "idle";
        }
      };
      // Snapshot transitions may be skipped by the browser; routing remains a real Next navigation.
      void transition.ready.catch(() => {
        if (pending.current === current)
          document.documentElement.dataset.transitionMode = "arrival";
      });
      void transition.finished.then(settled, settled);
    };
    document.addEventListener("click", navigate, true);
    motion.addEventListener("change", preferenceChanged);
    return () => {
      cancel();
      document.removeEventListener("click", navigate, true);
      motion.removeEventListener("change", preferenceChanged);
    };
  }, [router]);
  return null;
}
