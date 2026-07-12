"use client";

import { CvVersion } from "@/lib/cv-session";
import { MAX_VERSIONS } from "@/lib/types";

/**
 * Milestone version list shared by both surfaces. Versions are only ever
 * created at three milestones (initial generation, Regenerate, Download) — the
 * strip just restores/downloads them. Capped at MAX_VERSIONS (1 original + 10).
 */
export function VersionStrip({
  versions,
  activeId,
  onRestore,
  onDownload,
}: {
  versions: CvVersion[];
  activeId?: string;
  onRestore: (v: CvVersion) => void;
  onDownload?: (v: CvVersion) => void;
}) {
  if (versions.length <= 1) return null;
  // Newest first for display.
  const ordered = [...versions].reverse();
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-semibold text-ink-faint">Version history</p>
        <span className="text-[10px] text-ink-faint">
          {versions.length}/{MAX_VERSIONS}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {ordered.map((v) => {
          const isActive = v.id === activeId;
          return (
            <div
              key={v.id}
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                isActive
                  ? "border-accent bg-selected-bg"
                  : "border-border bg-card"
              }`}
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{v.label}</p>
                <p className="text-[10px] text-ink-faint">
                  {v.kind === "original"
                    ? "The first AI draft"
                    : v.kind === "regenerate"
                      ? "Report regenerated"
                      : "Saved at download"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {onDownload && (
                  <button
                    onClick={() => onDownload(v)}
                    className="cursor-pointer rounded-full border border-border bg-card px-2.5 py-1 font-semibold text-ink-soft hover:bg-chip"
                  >
                    ↓
                  </button>
                )}
                <button
                  onClick={() => onRestore(v)}
                  disabled={isActive}
                  className="cursor-pointer rounded-full border border-border bg-card px-2.5 py-1 font-semibold text-ink-soft hover:bg-chip disabled:opacity-40"
                >
                  {isActive ? "Current" : "Restore"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
