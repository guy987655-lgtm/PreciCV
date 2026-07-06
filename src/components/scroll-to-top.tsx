"use client";

import { useEffect, useState } from "react";

/** Floating bottom-right "scroll to top" button, visible after scrolling. */
export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;
  return (
    <button
      aria-label="Scroll to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-4 right-4 z-[60] flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-ink text-lg font-extrabold text-bg shadow-lg transition-colors hover:bg-[#2c3d33] print:hidden"
    >
      ↑
    </button>
  );
}
