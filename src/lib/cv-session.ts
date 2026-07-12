"use client";

import { useCallback, useState } from "react";
import {
  DiffReport,
  InterviewSimulation,
  MAX_VERSIONS,
  TailoredCv,
} from "./types";
import { CvTemplate } from "./types";

/* ------------------------------------------------------------------ */
/* Milestone versions — shared shape + cap logic for both surfaces     */
/* ------------------------------------------------------------------ */

/** What triggered a version snapshot (never a keystroke — see the plan). */
export type VersionKind = "original" | "regenerate" | "download";

/**
 * One milestone snapshot of a CV flow. Stored in localStorage (funnel) or
 * derived from generation rows (workspace). `simulation` is optional so
 * storage-constrained surfaces can omit it from non-current versions.
 */
export type CvVersion = {
  id: string;
  kind: VersionKind;
  label: string;
  savedAt: number;
  cv: TailoredCv;
  diff: DiffReport;
  simulation?: InterviewSimulation;
  template: CvTemplate;
};

/** Human label for a milestone, e.g. "Original draft", "Regenerated · 14:03". */
export function versionLabel(kind: VersionKind, savedAt: number): string {
  const t = new Date(savedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (kind === "original") return "Original draft";
  if (kind === "regenerate") return `Regenerated · ${t}`;
  return `Downloaded · ${t}`;
}

/**
 * Appends a milestone version, enforcing MAX_VERSIONS. The ORIGINAL draft
 * (the first version) is never dropped — when the cap is hit, the oldest
 * *editable* version (index 1) is removed instead. Never called on keystrokes.
 */
export function appendVersion(
  versions: CvVersion[],
  next: CvVersion
): CvVersion[] {
  const out = [...versions, next];
  while (out.length > MAX_VERSIONS) {
    // Keep index 0 (the original); drop the oldest editable snapshot.
    out.splice(1, 1);
  }
  return out;
}

/** Builds a version snapshot from the current deliverables. */
export function makeVersion(
  kind: VersionKind,
  data: {
    cv: TailoredCv;
    diff: DiffReport;
    simulation?: InterviewSimulation;
    template: CvTemplate;
  }
): CvVersion {
  const savedAt = Date.now();
  return {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `v_${savedAt}`,
    kind,
    label: versionLabel(kind, savedAt),
    savedAt,
    ...data,
  };
}

/* ------------------------------------------------------------------ */
/* Rewrite history — in-memory candidate ring for the RewriteTooltip   */
/* ------------------------------------------------------------------ */

export type RewriteHistory = {
  /** The full candidate ring (index 0 = originally-selected text). */
  items: string[];
  /** The originally-selected text (ring index 0) — what each Refresh rewrites. */
  original: string;
  /** The candidate currently shown (index into the ring). */
  current: string;
  index: number;
  count: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Seed the ring with the originally-selected text. */
  start: (original: string) => void;
  /** Append a freshly-generated rewrite and jump to it (spends quota). */
  push: (candidate: string) => void;
  /** Browse to the previous candidate — free, no quota spent. */
  undo: () => void;
  /** Browse to the next candidate — free, no quota spent. */
  redo: () => void;
  /** Clear the ring (selection dismissed). */
  clear: () => void;
};

/**
 * Manages the list of rewrite candidates for the currently highlighted snippet.
 * Index 0 is always the original text; each Refresh appends a candidate.
 * Undo/Redo browse the list WITHOUT re-generating — no quota is consumed while
 * browsing, only when `push` (a new Refresh) is called by the caller.
 */
export function useRewriteHistory(): RewriteHistory {
  const [ring, setRing] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  const start = useCallback((original: string) => {
    setRing([original]);
    setIndex(0);
  }, []);

  const push = useCallback((candidate: string) => {
    setRing((r) => {
      const next = [...r, candidate];
      setIndex(next.length - 1);
      return next;
    });
  }, []);

  const undo = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const redo = useCallback(
    () => setIndex((i) => Math.min(ring.length - 1, i + 1)),
    [ring.length]
  );
  const clear = useCallback(() => {
    setRing([]);
    setIndex(0);
  }, []);

  return {
    items: ring,
    original: ring[0] ?? "",
    current: ring[index] ?? "",
    index,
    count: ring.length,
    canUndo: index > 0,
    canRedo: index < ring.length - 1,
    start,
    push,
    undo,
    redo,
    clear,
  };
}
