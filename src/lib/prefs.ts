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
import { ExportPrefs, asCvTheme } from "./export-prefs";

export const PREFS_KEY = "precicv_prefs_v1";

/**
 * The stored shape. `defaultTemplate` keeps its original name even though it
 * is really `export.template`: renaming it — or bumping PREFS_KEY to _v2 —
 * would silently reset the remembered design for every existing user, which is
 * the exact bug this file's header exists to prevent.
 */
type StoredPrefs = {
  /** The design of the user's most recent download. */
  defaultTemplate?: CvTemplate;
  cvTheme?: ExportPrefs["cvTheme"];
  splitView?: boolean;
  hideAiSection?: boolean;
};

export function loadPrefs(): StoredPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Validated on the way OUT, not just in: a template removed from the
    // catalog between releases would otherwise render as a blank CV.
    //
    // Per KEY, not all-or-nothing: this used to return {} whenever the
    // template failed to validate, which would now throw away three unrelated
    // settings along with it.
    const out: StoredPrefs = {};
    const t = asTemplate(parsed.defaultTemplate);
    if (t) out.defaultTemplate = t;
    const theme = asCvTheme(parsed.cvTheme);
    if (theme) out.cvTheme = theme;
    if (typeof parsed.splitView === "boolean") out.splitView = parsed.splitView;
    if (typeof parsed.hideAiSection === "boolean") {
      out.hideAiSection = parsed.hideAiSection;
    }
    return out;
  } catch {
    return {};
  }
}

function savePrefs(next: StoredPrefs) {
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

/**
 * The whole remembered export configuration, as a patch — keys the user has
 * never set are absent, so callers can fall back per setting rather than
 * having to distinguish "chose light" from "never chose".
 */
export function preferredExportPrefs(): Partial<ExportPrefs> {
  const { defaultTemplate, ...rest } = loadPrefs();
  return defaultTemplate ? { ...rest, template: defaultTemplate } : rest;
}

/** Merges a patch into the stored preferences (used on every download). */
export function rememberExportPrefs(patch: Partial<ExportPrefs>) {
  const { template, ...rest } = patch;
  const next: StoredPrefs = { ...loadPrefs(), ...rest };
  if (template && asTemplate(template)) next.defaultTemplate = template;
  savePrefs(next);
}

/** Called when a CV is downloaded — that design becomes the user's default. */
export function rememberTemplate(t: CvTemplate) {
  rememberExportPrefs({ template: t });
}

/* ------------------------------------------------------------------ */
/* Account half — the same preferences, mirrored to profiles           */
/* ------------------------------------------------------------------ */

export type BaseCvMeta = { fileName: string; uploadedAt: string | null };

export type AccountPrefs = {
  /** Kept alongside `export.template`, which holds the same value. */
  defaultTemplate: CvTemplate | null;
  export: Partial<ExportPrefs>;
  baseCv: BaseCvMeta | null;
};

/** Signed-in preferences, or null when unavailable (signed out, offline). */
export async function fetchAccountPrefs(): Promise<AccountPrefs | null> {
  try {
    const res = await fetch("/api/account/preferences");
    if (!res.ok) return null;
    const data = await res.json();
    const template = asTemplate(data?.defaultTemplate ?? data?.export?.template);
    const theme = asCvTheme(data?.export?.cvTheme);
    return {
      defaultTemplate: template,
      export: {
        ...(template ? { template } : {}),
        ...(theme ? { cvTheme: theme } : {}),
        ...(typeof data?.export?.splitView === "boolean"
          ? { splitView: data.export.splitView }
          : {}),
        ...(typeof data?.export?.hideAiSection === "boolean"
          ? { hideAiSection: data.export.hideAiSection }
          : {}),
      },
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
  export?: Partial<ExportPrefs>;
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
