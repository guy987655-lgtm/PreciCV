"use client";

import { useEffect, useState } from "react";
import { CvRenderer } from "@/components/cv-renderer";
import type { CvTemplate, TailoredCv } from "@/lib/types";

/**
 * Full-screen CV preview: the entire one-page CV shown at once, scaled to
 * fit the viewport so nothing is cut off and no scrolling is needed. Closing
 * (backdrop click, the × button, or Esc) returns to the normal Results view.
 */
export function FullScreenCv({
  cv,
  template,
  theme,
  split,
  onClose,
}: {
  cv: TailoredCv;
  template: CvTemplate;
  theme: "light" | "dark";
  split: boolean;
  onClose: () => void;
}) {
  // A4 at 96dpi ≈ 794 × 1123px — scale so the whole sheet fits on screen.
  const A4_W = 794;
  const A4_H = 1123;
  const [scale, setScale] = useState(0.5);
  // §3.2 — user zoom on top of the fit-to-screen scale: 100% = fits the
  // viewport; range 50%–150%; adjustable via the control or trackpad pinch.
  const [zoom, setZoom] = useState(1);
  const clampZoom = (z: number) => Math.min(1.5, Math.max(0.5, z));
  useEffect(() => {
    const recalc = () => {
      const availW = window.innerWidth - 48;
      const availH = window.innerHeight - 88;
      setScale(Math.min(availW / A4_W, availH / A4_H, 1.4));
    };
    recalc();
    window.addEventListener("resize", recalc);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Trackpad pinch arrives as a ctrl+wheel gesture on desktop browsers.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z - e.deltaY * 0.01));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, [onClose]);
  const effScale = scale * zoom;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/80 p-6 backdrop-blur-sm print:hidden"
      onClick={onClose}
    >
      <button
        aria-label="Close preview"
        onClick={onClose}
        className="absolute right-5 top-5 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-white/90 text-2xl font-bold text-ink shadow-lg hover:bg-white"
      >
        ×
      </button>
      <div
        className="max-h-full max-w-full overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: A4_W * effScale, height: A4_H * effScale }}>
          <div
            style={{
              width: A4_W,
              height: A4_H,
              transform: `scale(${effScale})`,
              transformOrigin: "top left",
              transition: "transform 0.2s ease",
            }}
          >
            <CvRenderer
              cv={cv}
              template={template}
              theme={theme}
              split={split}
              domId={null}
            />
          </div>
        </div>
      </div>
      {/* §3.2 — floating zoom control, Display Review mode only */}
      <div
        className="absolute bottom-5 right-5 flex items-center gap-0.5 rounded-full bg-white/90 px-1.5 py-1 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          aria-label="Zoom out"
          onClick={() => setZoom((z) => clampZoom(z - 0.1))}
          disabled={zoom <= 0.5}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-lg font-bold text-ink transition-opacity duration-150 hover:bg-chip disabled:pointer-events-none disabled:opacity-40"
        >
          −
        </button>
        <button
          onClick={() => setZoom(1)}
          className="w-14 cursor-pointer text-center text-sm font-semibold tabular-nums text-ink"
          title="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          aria-label="Zoom in"
          onClick={() => setZoom((z) => clampZoom(z + 0.1))}
          disabled={zoom >= 1.5}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-lg font-bold text-ink transition-opacity duration-150 hover:bg-chip disabled:pointer-events-none disabled:opacity-40"
        >
          ＋
        </button>
      </div>
    </div>
  );
}
