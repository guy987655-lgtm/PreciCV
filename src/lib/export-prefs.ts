import { z } from "zod";
import { AI_SECTION_ID, CV_TEMPLATES, CvTemplate, TailoredCv } from "./types";
import { DEFAULT_TEMPLATE } from "./templates";

/**
 * The complete export configuration, remembered across generations.
 *
 * This used to be the design template alone, so a user whose last download was
 * Ledger + dark + split view got Ledger back and had to re-set the other two on
 * every application. The template already had a home on `profiles`; the rest
 * only ever existed per-document (generations.cv_theme / split_view) or inside
 * the CV JSON, which is why none of it survived into the next flow.
 *
 * Deliberately a pure module — no localStorage, no next/headers — so both the
 * client (prefs.ts) and the API routes can import it.
 */

export const CV_THEMES = ["light", "dark"] as const;
export type CvThemeId = (typeof CV_THEMES)[number];

export type ExportPrefs = {
  template: CvTemplate;
  cvTheme: CvThemeId;
  /**
   * The user's RAW toggle — never the value effectiveSplit() resolved.
   * Persisting the resolved one would let a download in a template whose
   * splitMode is "always" force split onto every later template, and a
   * download in a "never" template erase a genuine preference.
   */
  splitView: boolean;
  /** The "AI section: off" toggle state. See readAiSectionPref. */
  hideAiSection: boolean;
};

export const DEFAULT_EXPORT_PREFS: ExportPrefs = {
  template: DEFAULT_TEMPLATE,
  cvTheme: "light",
  splitView: false,
  hideAiSection: false,
};

/** Every field optional: callers patch whichever settings they know about. */
export const ExportPrefsSchema = z.object({
  template: z.enum(CV_TEMPLATES).optional(),
  cvTheme: z.enum(CV_THEMES).optional(),
  splitView: z.boolean().optional(),
  hideAiSection: z.boolean().optional(),
});
export type ExportPrefsPatch = z.infer<typeof ExportPrefsSchema>;

/** Narrows an unknown value to a theme, or undefined. */
export function asCvTheme(value: unknown): CvThemeId | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

/**
 * This CV's AI-section choice, or `undefined` when it has no AI section at all.
 *
 * The distinction matters: the preference is stored as one boolean, so reading
 * `false` off a CV that could never have shown the section would silently
 * overwrite a user's real "off" the next time they downloaded an unrelated CV.
 * Callers drop the key when this returns undefined.
 */
export function readAiSectionPref(cv: TailoredCv): boolean | undefined {
  if (!cv.sections.some((s) => s.id === AI_SECTION_ID)) return undefined;
  return (cv.hiddenSectionIds ?? []).includes(AI_SECTION_ID);
}

/**
 * Applies a remembered AI-section choice to a freshly generated CV. A no-op
 * when the preference is unknown or this CV has no such section — the rest of
 * `hiddenSectionIds` is left exactly as it was.
 */
export function applyAiSectionPref(
  cv: TailoredCv,
  hide: boolean | undefined
): TailoredCv {
  if (hide === undefined) return cv;
  if (!cv.sections.some((s) => s.id === AI_SECTION_ID)) return cv;
  const ids = new Set(cv.hiddenSectionIds ?? []);
  if (hide) ids.add(AI_SECTION_ID);
  else ids.delete(AI_SECTION_ID);
  return { ...cv, hiddenSectionIds: [...ids] };
}
