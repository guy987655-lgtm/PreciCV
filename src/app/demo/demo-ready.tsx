"use client";

import { useEffect } from "react";

/**
 * Marks the page as fully rendered for the portfolio's screenshot pipeline, which waits for
 * `data-exhibit-ready` on <html> (set once fonts have loaded) before capturing.
 */
export function DemoReady() {
  useEffect(() => {
    let cancelled = false;
    const root = document.documentElement;
    // setTimeout rather than requestAnimationFrame: rAF never fires in a background tab.
    document.fonts.ready.then(() => {
      setTimeout(() => {
        if (!cancelled) root.setAttribute("data-exhibit-ready", "");
      }, 50);
    });
    return () => {
      cancelled = true;
      root.removeAttribute("data-exhibit-ready");
    };
  }, []);
  return null;
}
