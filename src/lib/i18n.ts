/**
 * Question-translation languages.
 *
 * The questionnaire is written in English because that is what the tailoring
 * engine consumes, but users kept leaving the flow to paste questions into an
 * external translator. These are the display languages the chat can be flipped
 * into; answers are still stored (and sent to the model) in English — see the
 * non-English answer handling in chat-flow.tsx.
 *
 * Dependency-free so it imports into both route handlers and React.
 */

export type LangDef = {
  /** ISO 639-1 code — also the cache key in FunnelState.translations. */
  code: string;
  /** The language's own name, for the UI. */
  label: string;
  /** English name, used in the translation prompt. */
  promptName: string;
  /** Call to action, written in the target language. */
  cta: string;
  /** Label for the auto-appended free-text choice ("Other…"). */
  otherLabel: string;
  rtl?: boolean;
};

export const LANGUAGES: LangDef[] = [
  {
    code: "he",
    label: "עברית",
    promptName: "Hebrew",
    cta: "תרגם לעברית",
    otherLabel: "אחר…",
    rtl: true,
  },
  {
    code: "ar",
    label: "العربية",
    promptName: "Arabic",
    cta: "ترجم إلى العربية",
    otherLabel: "أخرى…",
    rtl: true,
  },
  {
    code: "ru",
    label: "Русский",
    promptName: "Russian",
    cta: "Перевести на русский",
    otherLabel: "Другое…",
  },
  {
    code: "es",
    label: "Español",
    promptName: "Spanish",
    cta: "Traducir al español",
    otherLabel: "Otro…",
  },
  {
    code: "fr",
    label: "Français",
    promptName: "French",
    cta: "Traduire en français",
    otherLabel: "Autre…",
  },
  {
    code: "pt",
    label: "Português",
    promptName: "Portuguese",
    cta: "Traduzir para português",
    otherLabel: "Outro…",
  },
  {
    code: "de",
    label: "Deutsch",
    promptName: "German",
    cta: "Auf Deutsch übersetzen",
    otherLabel: "Andere…",
  },
  {
    code: "hi",
    label: "हिन्दी",
    promptName: "Hindi",
    cta: "हिंदी में अनुवाद करें",
    otherLabel: "अन्य…",
  },
];

export function langDef(code: string): LangDef | null {
  return LANGUAGES.find((l) => l.code === code) ?? null;
}

export function isRtl(code: string): boolean {
  return Boolean(langDef(code)?.rtl);
}

/**
 * The browser's language, when we can translate into it. English (and
 * anything unsupported) returns "" — the caller then offers the picker
 * instead of guessing a language for the user.
 */
export function detectLang(): string {
  if (typeof navigator === "undefined") return "";
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = (tag ?? "").toLowerCase().split("-")[0];
    if (base === "en") return "";
    if (langDef(base)) return base;
  }
  return "";
}
