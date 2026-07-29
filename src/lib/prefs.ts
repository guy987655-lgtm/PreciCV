/**
 * Device-level user preferences that must OUTLIVE a single flow.
 *
 * Deliberately its own localStorage key rather than a field on FunnelState:
 * the funnel is wiped by clearFunnel() and replaced wholesale on every new CV
 * upload, which is exactly why a user's chosen design used to reset to
 * "classic" on every application. Signed-in users get the same value mirrored
 * to profiles.default_template so it follows them across devices; this is the
 * guest half and the fast local read.
 */
import { CvTemplate } from "./types";
import { asTemplate } from "./templates";

export const PREFS_KEY = "precicv_prefs_v1";

type Prefs = {
  /** The design of the user's most recent download. */
  defaultTemplate?: CvTemplate;
};

export function loadPrefs(): Prefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Validated on the way OUT, not just in: a template removed from the
    // catalog between releases would otherwise render as a blank CV.
    const t = asTemplate(parsed.defaultTemplate);
    return t ? { defaultTemplate: t } : {};
  } catch {
    return {};
  }
}

function savePrefs(next: Prefs) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Storage full / private mode — preferences are a nicety, never a blocker.
  }
}

/** The design new flows should start in, or null when nothing is remembered. */
export function preferredTemplate(): CvTemplate | null {
  return loadPrefs().defaultTemplate ?? null;
}

/** Called when a CV is downloaded — that design becomes the user's default. */
export function rememberTemplate(t: CvTemplate) {
  if (!asTemplate(t)) return;
  savePrefs({ ...loadPrefs(), defaultTemplate: t });
}

/* ------------------------------------------------------------------ */
/* Account half — the same preferences, mirrored to profiles           */
/* ------------------------------------------------------------------ */

export type BaseCvMeta = { fileName: string; uploadedAt: string | null };

export type AccountPrefs = {
  defaultTemplate: CvTemplate | null;
  baseCv: BaseCvMeta | null;
};

/** Signed-in preferences, or null when unavailable (signed out, offline). */
export async function fetchAccountPrefs(): Promise<AccountPrefs | null> {
  try {
    const res = await fetch("/api/account/preferences");
    if (!res.ok) return null;
    const data = await res.json();
    return {
      defaultTemplate: asTemplate(data?.defaultTemplate),
      baseCv: data?.baseCv?.fileName
        ? {
            fileName: String(data.baseCv.fileName),
            uploadedAt: data.baseCv.uploadedAt ?? null,
          }
        : null,
    };
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget preference write. Every caller is on a path the user cares
 * about far more than the preference (printing, analyzing), so failures are
 * swallowed rather than surfaced.
 */
export async function saveAccountPrefs(patch: {
  defaultTemplate?: CvTemplate;
  baseCv?: { rawText: string; fileName: string } | null;
}): Promise<void> {
  try {
    await fetch("/api/account/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    /* preferences are best-effort */
  }
}
