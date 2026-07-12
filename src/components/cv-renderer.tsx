"use client";

import {
  CSSProperties,
  Fragment,
  ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CvTemplate, TailoredCv } from "@/lib/types";
import { Editable, requestEditorFocus } from "@/components/cv-editor";

/**
 * Renders a TailoredCv in one of 10 print-ready designs. Every design shares
 * the same structured model (contact → summary → sections → skills) and lays
 * out to a single A4 page; they differ only in typeface, spacing and accent
 * color. Each design is background-agnostic: a global `theme` ("light" |
 * "dark") sets the page background and text color, so any of the 10 can be
 * previewed and exported on either a light or a dark sheet.
 *
 * `split` renders the body in two balanced columns with the header and
 * summary spanning the full width, each section kept whole so a column always
 * begins with a section heading — never mid-paragraph.
 *
 * Optional inline editing (workspace only) makes text nodes contentEditable;
 * the public Results tab renders read-only.
 */

// Inline editing is TipTap-backed (PRD v2): see cv-editor.tsx. The Editable
// API is unchanged, so every template call-site below works as before.

/**
 * View-layer metric emphasis: wraps numeric tokens (32%, $4M, 18%, 4, 3x…) in
 * accent-colored <strong> with tabular figures so numbers align and pop. It
 * NEVER mutates `cv` — call it only when rendering read-only summary/bullet
 * text. In edit mode callers pass the plain string instead (see Editable).
 */
function withMetrics(text: string, accent: string): ReactNode {
  const parts = text.split(/(\$?\d[\d.,]*(?:%|x|[KMB]|\+)?)/g);
  return parts.map((part, i) =>
    i % 2 === 1 && part ? (
      <strong
        key={i}
        style={{
          color: accent,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
        }}
      >
        {part}
      </strong>
    ) : (
      part
    )
  );
}

const FONT = {
  serif: "font-[family-name:var(--font-source-serif)]",
  playfair: "font-[family-name:var(--font-playfair)]",
  lora: "font-[family-name:var(--font-lora)]",
  space: "font-[family-name:var(--font-space)]",
  archivo: "font-[family-name:var(--font-archivo)]",
  mono: "font-[family-name:var(--font-mono-cv)]",
  inter: "font-[family-name:var(--font-inter)]",
  figtree: "font-[family-name:var(--font-figtree)]",
} as const;

export type CvTheme = "light" | "dark";

/** Background + neutral text tones, shared by every template. */
const PALETTE: Record<CvTheme, { bg: string; text: string; subtle: string; rule: string }> = {
  light: { bg: "#ffffff", text: "#1a1a1a", subtle: "#64748b", rule: "#d9d9d9" },
  dark: { bg: "#171c24", text: "#e8ecf1", subtle: "#9aa5b3", rule: "rgba(255,255,255,0.18)" },
};

type SectionVariant = "underline" | "chip" | "plain";

/**
 * Structural body layout. "linear" is the original single-flow arrangement the
 * first ten designs share; the newer designs each pick a distinct structure.
 * Only "linear" and "date-rail" are wired today — the rest are reserved names
 * for the staged rollout (see design_handoff_precicv_resumes/README.md).
 */
type CvLayout =
  | "linear" // classic single flow (existing behaviour — default)
  | "date-rail" // fixed left date column (Ledger)
  | "numbered" // 01/02/03 section headers (Index)
  | "masthead" // full-width header band + hairline rules (Masthead)
  | "marginalia" // left gutter holds section labels (Marginalia)
  | "band" // filled header banner, body below (Panel)
  | "two-col" // centered masthead + center-ruled two columns (Column Rule)
  | "rail" // tinted left sidebar + main (Rail)
  | "grid" // modular hairline grid + skills tag-grid (Grid)
  | "timeline" // vertical ruled spine on experience (Timeline)
  | "readme"; // // comment section markers + boxed skills (Spec Sheet, Mono)

type TemplateDef = {
  label: string;
  /** Signature accent (name / headings), per background. */
  accent: { light: string; dark: string };
  /** Structural layout; defaults to "linear" so the original ten are unchanged. */
  layout?: CvLayout;
  center?: boolean;
  nameUsesAccent?: boolean;
  headlineUsesAccent?: boolean;
  sectionVariant: SectionVariant;
  /** For "plain" titles that read as muted labels (Minimal). */
  sectionUsesSubtle?: boolean;
  /** Base body font size in px (default 11) — scaled up by dynamic fill. */
  baseSize?: number;
  /** Base line-height multiple (default 1.5). */
  baseLeading?: number;
  /** Page-level typography extras (font family). */
  page: string;
  /** Structural name classes — size/weight/tracking (no color, no centering). */
  name: string;
  /** Structural headline classes (no color, no centering). */
  headline: string;
  /** Extra classes on the contact row (font/size). */
  contactExtra?: string;
  /** Structural section-title classes — size/weight/tracking/border (no color). */
  sectionTitle: string;
  bullet: string;
};

const TEMPLATES: Record<CvTemplate, TemplateDef> = {
  classic: {
    label: "Classic",
    accent: { light: "#334155", dark: "#cbd5e1" },
    center: true,
    sectionVariant: "underline",
    page: `${FONT.serif}`,
    name: "text-[27px] font-bold tracking-[0.02em]",
    headline: "text-[12.5px] mt-1",
    sectionTitle:
      "text-[11px] font-bold uppercase tracking-[0.18em] border-b pb-1 mb-2 mt-4",
    bullet: "list-disc",
  },
  modern: {
    label: "Modern",
    accent: { light: "#2f6b4f", dark: "#86cea6" },
    nameUsesAccent: true,
    headlineUsesAccent: true,
    sectionVariant: "underline",
    page: `${FONT.figtree}`,
    name: "text-[27px] font-extrabold tracking-tight",
    headline: "text-[13px] font-semibold mt-0.5",
    sectionTitle:
      "text-[11px] font-bold uppercase tracking-widest border-b-2 pb-1 mb-2 mt-4",
    bullet: "list-disc",
  },
  compact: {
    label: "Compact",
    accent: { light: "#475569", dark: "#b4bdca" },
    sectionVariant: "underline",
    baseSize: 10.5,
    baseLeading: 1.375,
    page: `${FONT.inter}`,
    name: "text-[21px] font-bold tracking-tight",
    headline: "text-[11px] mt-0",
    sectionTitle:
      "text-[10px] font-bold uppercase tracking-wider border-b pb-0.5 mb-1.5 mt-3",
    bullet: "list-[square]",
  },
  executive: {
    label: "Executive",
    accent: { light: "#475569", dark: "#c3ccd8" },
    center: true,
    sectionVariant: "underline",
    page: `${FONT.serif}`,
    name: `text-[30px] font-bold ${FONT.playfair} tracking-[0.01em]`,
    headline: "text-[11.5px] uppercase tracking-[0.28em] mt-2",
    sectionTitle: `text-[12px] font-semibold ${FONT.playfair} uppercase tracking-[0.18em] border-b pb-1 mb-2 mt-4`,
    bullet: "list-disc",
  },
  elegant: {
    label: "Elegant",
    accent: { light: "#8a6a3c", dark: "#d8b878" },
    nameUsesAccent: true,
    sectionVariant: "underline",
    page: `${FONT.lora}`,
    name: `text-[28px] font-semibold ${FONT.playfair}`,
    headline: "text-[12.5px] italic mt-0.5",
    sectionTitle: `text-[12px] font-semibold ${FONT.playfair} uppercase tracking-[0.15em] border-b pb-1 mb-2 mt-4`,
    bullet: "list-disc",
  },
  technical: {
    label: "Technical",
    accent: { light: "#2f6b4f", dark: "#6ee7b7" },
    headlineUsesAccent: true,
    sectionVariant: "underline",
    page: `${FONT.figtree}`,
    name: `text-[24px] font-bold ${FONT.mono} tracking-tight`,
    headline: `text-[12px] ${FONT.mono} mt-1`,
    contactExtra: `${FONT.mono} text-[9.5px] tracking-tight`,
    sectionTitle: `text-[11px] font-bold uppercase tracking-widest ${FONT.mono} border-b-2 pb-1 mb-2 mt-4`,
    bullet: "list-[square]",
  },
  contemporary: {
    label: "Contemporary",
    accent: { light: "#2f6b4f", dark: "#86cea6" },
    headlineUsesAccent: true,
    sectionVariant: "chip",
    page: `${FONT.space}`,
    name: "text-[28px] font-bold tracking-tight",
    headline: "text-[13px] font-medium mt-0.5",
    sectionTitle:
      "inline-block text-[10.5px] font-bold uppercase tracking-wider px-2.5 py-1 rounded mb-2 mt-4",
    bullet: "list-disc",
  },
  minimal: {
    label: "Minimal",
    accent: { light: "#94a3b8", dark: "#9aa5b3" },
    sectionVariant: "plain",
    sectionUsesSubtle: true,
    page: `${FONT.archivo}`,
    name: "text-[25px] font-semibold tracking-tight",
    headline: "text-[12px] mt-0.5",
    sectionTitle:
      "text-[10.5px] font-semibold uppercase tracking-[0.28em] mb-1.5 mt-5",
    bullet: "list-disc",
  },
  onyx: {
    label: "Onyx",
    accent: { light: "#2f6b4f", dark: "#9dbfa6" },
    headlineUsesAccent: true,
    sectionVariant: "underline",
    page: `${FONT.space}`,
    name: "text-[27px] font-bold tracking-tight",
    headline: "text-[13px] font-medium mt-0.5",
    sectionTitle:
      "text-[11px] font-bold uppercase tracking-widest border-b pb-1 mb-2 mt-4",
    bullet: "list-disc",
  },
  midnight: {
    label: "Midnight",
    accent: { light: "#a97e30", dark: "#d4af6a" },
    center: true,
    headlineUsesAccent: true,
    sectionVariant: "underline",
    page: `${FONT.serif}`,
    name: `text-[29px] font-bold ${FONT.playfair} tracking-wide`,
    headline: "text-[12px] uppercase tracking-[0.25em] mt-2",
    sectionTitle: `text-[11px] font-semibold ${FONT.playfair} uppercase tracking-[0.2em] border-b pb-1 mb-2 mt-4`,
    bullet: "list-disc",
  },
  // ---- Data-Forward -------------------------------------------------------
  ledger: {
    label: "Ledger",
    accent: { light: "#1f6b57", dark: "#86cea6" },
    layout: "date-rail",
    // Ledger draws its own mono section labels in the body branch; the shared
    // sectionVariant/sectionTitle are unused by "date-rail".
    sectionVariant: "plain",
    baseSize: 10.5,
    page: `${FONT.inter}`,
    name: `text-[27px] font-semibold ${FONT.serif} tracking-[-0.01em]`,
    headline: "text-[12px] mt-1",
    contactExtra: `${FONT.mono} tracking-[0.02em] tabular-nums`,
    sectionTitle: `${FONT.mono} text-[9px] font-semibold uppercase tracking-[0.18em]`,
    bullet: "list-disc",
  },
  index: {
    label: "Index",
    accent: { light: "#33507a", dark: "#9fb6da" },
    layout: "numbered",
    sectionVariant: "plain",
    baseSize: 10,
    page: `${FONT.inter}`,
    name: `${FONT.archivo} text-[24px] font-bold tracking-[-0.02em]`,
    headline: `${FONT.archivo} text-[10px] font-medium uppercase tracking-[0.09em] mt-[3px]`,
    contactExtra: "tabular-nums",
    sectionTitle: `${FONT.archivo} text-[10.5px] font-bold uppercase tracking-[0.14em]`,
    bullet: "list-disc",
  },
  masthead: {
    label: "Masthead",
    accent: { light: "#8a3a30", dark: "#d99a8f" },
    layout: "masthead",
    sectionVariant: "plain",
    baseSize: 10.5,
    page: `${FONT.lora}`,
    name: `${FONT.playfair} text-[31px] font-bold tracking-[-0.01em] leading-none`,
    headline: "italic text-[12px] mt-2",
    contactExtra: "tabular-nums",
    sectionTitle: `${FONT.archivo} text-[9.5px] font-bold uppercase tracking-[0.2em]`,
    bullet: "list-disc",
  },
  marginalia: {
    label: "Marginalia",
    accent: { light: "#3a4a63", dark: "#9fb3d1" },
    layout: "marginalia",
    sectionVariant: "plain",
    baseSize: 10.5,
    page: `${FONT.serif}`,
    name: "text-[26px] font-semibold tracking-[-0.01em]",
    headline: "italic text-[12px] mt-[3px]",
    contactExtra: `${FONT.inter} tabular-nums`,
    sectionTitle: `${FONT.inter} text-[9px] font-semibold uppercase tracking-[0.13em]`,
    bullet: "list-disc",
  },
  panel: {
    label: "Panel",
    accent: { light: "#8a6a24", dark: "#d4af6a" },
    layout: "band",
    sectionVariant: "plain",
    baseSize: 10.5,
    page: `${FONT.inter}`,
    name: `${FONT.playfair} text-[27px] font-bold leading-[1.04]`,
    headline: "text-[11px] mt-1",
    contactExtra: `${FONT.mono} tabular-nums`,
    sectionTitle: "text-[9.5px] font-bold uppercase tracking-[0.16em]",
    bullet: "list-disc",
  },
  columnrule: {
    label: "Column Rule",
    accent: { light: "#3f4c5a", dark: "#c3ccd8" },
    layout: "two-col",
    sectionVariant: "plain",
    baseSize: 10,
    page: `${FONT.inter}`,
    name: `${FONT.serif} text-[26px] font-semibold tracking-[-0.01em]`,
    headline: "text-[10px] uppercase tracking-[0.18em] mt-[3px]",
    contactExtra: `${FONT.mono} tabular-nums`,
    sectionTitle: "text-[9.5px] font-bold uppercase tracking-[0.16em]",
    bullet: "list-disc",
  },
  rail: {
    label: "Rail",
    accent: { light: "#2f6b4f", dark: "#86cea6" },
    layout: "rail",
    sectionVariant: "plain",
    baseSize: 10,
    page: `${FONT.figtree}`,
    name: "text-[24px] font-extrabold tracking-[-0.02em]",
    headline: "text-[11px] font-semibold mt-0.5",
    contactExtra: "",
    sectionTitle: "text-[9px] font-bold uppercase tracking-[0.14em]",
    bullet: "list-disc",
  },
  grid: {
    label: "Grid",
    accent: { light: "#2f5c8a", dark: "#93b4e6" },
    layout: "grid",
    sectionVariant: "plain",
    baseSize: 10,
    page: `${FONT.inter}`,
    name: `${FONT.archivo} text-[28px] font-extrabold tracking-[-0.02em] leading-none`,
    headline: `${FONT.archivo} text-[10px] font-bold uppercase tracking-[0.1em] mt-1`,
    contactExtra: `${FONT.mono} tabular-nums`,
    sectionTitle: `${FONT.archivo} text-[9px] font-bold uppercase tracking-[0.16em]`,
    bullet: "list-disc",
  },
  timeline: {
    label: "Timeline",
    accent: { light: "#6d4d78", dark: "#c1a6cc" },
    layout: "timeline",
    sectionVariant: "plain",
    baseSize: 10,
    page: `${FONT.inter}`,
    name: `${FONT.space} text-[25px] font-bold tracking-[-0.02em]`,
    headline: "text-[11px] font-medium mt-0.5",
    contactExtra: `${FONT.mono} tabular-nums`,
    sectionTitle: `${FONT.space} text-[9.5px] font-bold uppercase tracking-[0.16em]`,
    bullet: "list-disc",
  },
  specsheet: {
    label: "Spec Sheet",
    accent: { light: "#2f6b4f", dark: "#6ee7b7" },
    layout: "readme",
    sectionVariant: "plain",
    baseSize: 10,
    page: `${FONT.inter}`,
    name: `${FONT.space} text-[25px] font-bold tracking-[-0.02em]`,
    headline: `${FONT.mono} text-[10.5px] mt-[3px]`,
    contactExtra: `${FONT.mono} tabular-nums`,
    sectionTitle: `${FONT.mono} text-[9.5px] font-bold tracking-[0.1em]`,
    bullet: "list-disc",
  },
  mono: {
    label: "Mono",
    accent: { light: "#9a6b12", dark: "#d9a441" },
    layout: "readme",
    sectionVariant: "plain",
    baseSize: 10,
    page: `${FONT.mono}`,
    name: `${FONT.mono} text-[20px] font-semibold tracking-[-0.02em]`,
    headline: `${FONT.mono} text-[10.5px] mt-2`,
    contactExtra: "tabular-nums",
    sectionTitle: `${FONT.mono} text-[10px]`,
    bullet: "list-disc",
  },
};

/** Template id → picker metadata (label). */
export const CV_TEMPLATE_META: Record<CvTemplate, { label: string }> =
  Object.fromEntries(
    (Object.keys(TEMPLATES) as CvTemplate[]).map((t) => [t, { label: TEMPLATES[t].label }])
  ) as Record<CvTemplate, { label: string }>;

export function CvRenderer({
  cv,
  template,
  theme = "light",
  editable = false,
  split = false,
  domId = "cv-page",
  onChange,
}: {
  cv: TailoredCv;
  template: CvTemplate;
  /** Global background theme — any design renders on light or dark. */
  theme?: CvTheme;
  editable?: boolean;
  /** Two-column body layout (screen comparison view). */
  split?: boolean;
  /** DOM id for the printable node; pass null for off-screen duplicates. */
  domId?: string | null;
  onChange?: (next: TailoredCv) => void;
}) {
  const t = TEMPLATES[template] ?? TEMPLATES.classic;
  const pal = PALETTE[theme];
  const accent = t.accent[theme];
  const layout: CvLayout = t.layout ?? "linear";

  const commit = (mutate: (draft: TailoredCv) => void) => {
    if (!onChange) return;
    const draft: TailoredCv = JSON.parse(JSON.stringify(cv));
    mutate(draft);
    onChange(draft);
  };

  /** Smart-bullet editing (§3.3): Enter mid-bullet splits into a new sibling
   *  bullet (which claims focus on mount); Enter on an empty bullet deletes
   *  it and exits the list. Spread onto every bullet Editable. */
  const bulletEditProps = (si: number, ii: number, bi: number) => ({
    focusKey: `b-${si}-${ii}-${bi}`,
    onSplit: (before: string, after: string) => {
      requestEditorFocus(`b-${si}-${ii}-${bi + 1}`);
      commit((d) => {
        d.sections[si].items[ii].bullets.splice(bi, 1, before, after);
      });
    },
    onExitEmpty: () => {
      commit((d) => {
        d.sections[si].items[ii].bullets.splice(bi, 1);
      });
    },
  });

  const contactBits = [
    cv.contact.email,
    cv.contact.phone,
    cv.contact.location,
    cv.contact.linkedin,
    cv.contact.website,
  ].filter(Boolean);

  // Defensive de-dupe: drop any section that merely repeats the top-level
  // summary, or one left with no content (guards older cached generations
  // too). We keep each survivor's ORIGINAL index so inline edits still write
  // back to the right cv.sections entry. User-hidden sections (§6 toggle,
  // e.g. "AI & Automation Expertise") are filtered but stay in the model.
  const hiddenIds = new Set(cv.hiddenSectionIds ?? []);
  const sections = cv.sections
    .map((section, si) => ({ section, si }))
    .filter(({ section }) => {
      if (hiddenIds.has(section.id)) return false;
      const title = section.title.trim().toLowerCase();
      if (cv.summary && (title === "summary" || title === "profile")) return false;
      return section.items.some(
        (it) => it.primary || it.secondary || it.meta || it.bullets.length > 0
      );
    });

  const sectionTitleStyle: CSSProperties =
    t.sectionVariant === "chip"
      ? { background: accent, color: pal.bg }
      : t.sectionVariant === "underline"
        ? { borderColor: pal.rule, color: accent }
        : { color: t.sectionUsesSubtle ? pal.subtle : accent };

  /* ---------------- dynamic page-fill (single column, read-only) ----------
     If the generated CV leaves more than 25% of the page blank, gently grow
     the body font and line spacing so the text fills the sheet naturally
     instead of stranding a large empty strip at the foot. Disabled in split
     view and while editing (the editor stays WYSIWYG). */
  const baseSize = t.baseSize ?? 11;
  const baseLeading = t.baseLeading ?? 1.5;
  const pageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fill, setFill] = useState(1);
  const measuredSig = useRef("");
  const sig = `${template}|${theme}|${split}|${editable}|${JSON.stringify(cv)}`;

  useLayoutEffect(() => {
    if (split || editable) {
      if (fill !== 1) setFill(1);
      return;
    }
    if (measuredSig.current === sig) return;
    if (fill !== 1) {
      setFill(1); // measure at natural size first
      return;
    }
    measuredSig.current = sig;
    const page = pageRef.current;
    const content = contentRef.current;
    if (!page || !content) return;
    const cs = getComputedStyle(page);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const pageInner = page.clientHeight - padY;
    const contentH = content.scrollHeight;
    if (contentH > 0 && pageInner > 0) {
      const ratio = contentH / pageInner;
      if (ratio < 0.75) setFill(Math.min(0.94 / ratio, 1.35));
    }
  }, [sig, fill, split, editable]);

  // Font grows up to 15%; the rest of the fill goes into line spacing.
  const fontFactor = Math.min(fill, 1.15);
  const pageStyle = {
    width: "210mm",
    minHeight: "297mm",
    background: pal.bg,
    color: pal.text,
    fontSize: `${baseSize * fontFactor}px`,
    lineHeight: baseLeading * (fill / fontFactor),
    "--cv-accent": accent,
  } as CSSProperties;

  /* ---------------- block renderers (shared by both layouts) ---------------- */
  const renderSection = ({
    section,
    si,
  }: {
    section: TailoredCv["sections"][number];
    si: number;
  }): ReactNode => (
    <div key={section.id}>
      <Editable
        as="h2"
        className={t.sectionTitle}
        style={sectionTitleStyle}
        value={section.title}
        editable={editable}
        onCommit={(v) => commit((d) => void (d.sections[si].title = v))}
      />
      {section.items.map((item, ii) => (
        <div key={item.id} className="mb-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <Editable
                className="font-semibold"
                value={item.primary}
                editable={editable}
                onCommit={(v) =>
                  commit((d) => void (d.sections[si].items[ii].primary = v))
                }
              />
              {item.secondary && (
                <>
                  {" · "}
                  <Editable
                    style={{ color: pal.subtle }}
                    value={item.secondary}
                    editable={editable}
                    onCommit={(v) =>
                      commit((d) => void (d.sections[si].items[ii].secondary = v))
                    }
                  />
                </>
              )}
            </div>
            {item.meta && (
              <Editable
                className="shrink-0 text-[10px]"
                style={{ color: pal.subtle }}
                value={item.meta}
                editable={editable}
                onCommit={(v) =>
                  commit((d) => void (d.sections[si].items[ii].meta = v))
                }
              />
            )}
          </div>
          {item.bullets.length > 0 && (
            <ul
              className={`ml-4 mt-0.5 space-y-0.5 marker:[color:var(--cv-accent)] ${t.bullet}`}
            >
              {item.bullets.map((bullet, bi) => (
                <Editable
                  key={bi}
                  as="li"
                  value={bullet}
                  editable={editable}
                  {...bulletEditProps(si, ii, bi)}
                  onCommit={(v) =>
                    commit((d) => {
                      if (v === "") {
                        d.sections[si].items[ii].bullets.splice(bi, 1);
                      } else {
                        d.sections[si].items[ii].bullets[bi] = v;
                      }
                    })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );

  const renderSkills = (): ReactNode => (
    <div key="__skills">
      <h2 className={t.sectionTitle} style={sectionTitleStyle}>
        Skills
      </h2>
      <Editable
        as="p"
        value={cv.skills.join(" · ")}
        editable={editable}
        onCommit={(v) =>
          commit(
            (d) =>
              void (d.skills = v
                .split(/[·,]/)
                .map((x) => x.trim())
                .filter(Boolean))
          )
        }
      />
    </div>
  );

  /* ---------------- split layout: two balanced, top-aligned columns --------
     Sections are distributed contiguously by estimated height so the two
     columns are roughly even, and each column's first heading has its top
     margin zeroed so the left and right top headers sit on the same line. */
  const splitBody = (() => {
    type Block = { node: ReactNode; weight: number };
    const blocks: Block[] = sections.map((s) => ({
      node: renderSection(s),
      weight:
        2.5 +
        s.section.items.reduce((a, it) => a + 1.5 + it.bullets.length, 0),
    }));
    if (cv.skills.length > 0) {
      blocks.push({
        node: renderSkills(),
        weight: 2 + Math.ceil(cv.skills.join(" · ").length / 70),
      });
    }
    const total = blocks.reduce((a, b) => a + b.weight, 0);
    const left: ReactNode[] = [];
    const right: ReactNode[] = [];
    let acc = 0;
    for (const b of blocks) {
      if (acc < total / 2) {
        left.push(b.node);
        acc += b.weight;
      } else {
        right.push(b.node);
      }
    }
    // Never leave the right column empty when there's more than one block.
    if (right.length === 0 && left.length > 1) right.unshift(left.pop());

    const colCls = "flex-1 min-w-0 [&>div:first-child>h2]:mt-0";
    return (
      <div className="mt-2 flex">
        <div className={`${colCls} pr-6`}>{left}</div>
        <div
          className={`${colCls} pl-6`}
          style={{ borderLeft: `1px solid ${pal.rule}` }}
        >
          {right}
        </div>
      </div>
    );
  })();

  /* ================= Ledger (layout: "date-rail") ==========================
     A financial-ledger read: dates ruled down a fixed left column, every
     claim on its own line, metrics set in tabular accent figures. The visual
     is CSS-only (a presentational grid); the DOM stays label → dates → title
     → company → bullets so a copy-paste yields a clean linear resume. In
     split view the rail retires, dates go inline-right, and sections balance
     across a center hairline (mirrors splitBody). Shared with both modes: */
  const ledgerLabelCls = `${FONT.mono} text-[9px] font-semibold uppercase tracking-[0.18em]`;

  const ledgerTitle = (item: TailoredCv["sections"][number]["items"][number], si: number, ii: number) => (
    <Editable
      className="text-[12px] font-semibold"
      value={item.primary}
      editable={editable}
      onCommit={(v) => commit((d) => void (d.sections[si].items[ii].primary = v))}
    />
  );

  const ledgerCompany = (item: TailoredCv["sections"][number]["items"][number], si: number, ii: number) =>
    item.secondary ? (
      <Editable
        as="div"
        className="mt-px text-[10px]"
        style={{ color: pal.subtle }}
        value={item.secondary}
        editable={editable}
        onCommit={(v) => commit((d) => void (d.sections[si].items[ii].secondary = v))}
      />
    ) : null;

  const ledgerBullets = (item: TailoredCv["sections"][number]["items"][number], si: number, ii: number) =>
    item.bullets.length > 0 ? (
      <ul className="mt-1 list-disc space-y-0.5 pl-[15px] marker:[color:var(--cv-accent)]">
        {item.bullets.map((bullet, bi) => (
          <Editable
            key={bi}
            as="li"
            value={bullet}
            editable={editable}
            {...bulletEditProps(si, ii, bi)}
            onCommit={(v) =>
              commit((d) => {
                if (v === "") d.sections[si].items[ii].bullets.splice(bi, 1);
                else d.sections[si].items[ii].bullets[bi] = v;
              })
            }
          >
            {editable ? undefined : withMetrics(bullet, accent)}
          </Editable>
        ))}
      </ul>
    ) : null;

  // Hairline-bordered skill tags. Every chip is its own editable text node.
  const ledgerChips = (chipCls: string) => (
    <div className="flex flex-wrap gap-[5px]">
      {cv.skills.map((skill, i) => (
        <Editable
          key={i}
          className={chipCls}
          style={{ border: `1px solid ${pal.rule}` }}
          value={skill}
          editable={editable}
          onCommit={(v) =>
            commit((d) => {
              if (v === "") d.skills.splice(i, 1);
              else d.skills[i] = v;
            })
          }
        />
      ))}
    </div>
  );

  const ledgerSummary = (
    <div style={{ gridColumn: "1 / -1" }} className="mt-1">
      <h2 className={ledgerLabelCls} style={{ color: accent }}>
        Summary
      </h2>
      <Editable
        as="p"
        className="mt-1"
        value={cv.summary}
        editable={editable}
        onCommit={(v) => commit((d) => void (d.summary = v))}
      >
        {editable ? undefined : withMetrics(cv.summary, accent)}
      </Editable>
    </div>
  );

  // 1-column: fixed 60px date-rail; section headers span both columns with a
  // top hairline; each role's dates sit in the left rail cell.
  const ledgerGrid = (
    <>
      <div style={{ height: 1, background: pal.rule, marginTop: 14 }} />
      <div
        className="grid"
        style={{ gridTemplateColumns: "60px 1fr", columnGap: 20, marginTop: 14 }}
      >
        {cv.summary && ledgerSummary}
        {sections.map(({ section, si }) => (
          <Fragment key={section.id}>
            <div
              style={{
                gridColumn: "1 / -1",
                borderTop: `1px solid ${pal.rule}`,
                marginTop: 14,
                paddingTop: 9,
              }}
            >
              <Editable
                as="h2"
                className={ledgerLabelCls}
                style={{ color: accent }}
                value={section.title}
                editable={editable}
                onCommit={(v) => commit((d) => void (d.sections[si].title = v))}
              />
            </div>
            {section.items.map((item, ii) => (
              <Fragment key={item.id}>
                <div
                  className={`${FONT.mono} text-right text-[8.5px] leading-tight tabular-nums`}
                  style={{ color: pal.subtle, paddingTop: 8 }}
                >
                  {item.meta ? (
                    <Editable
                      value={item.meta}
                      editable={editable}
                      onCommit={(v) =>
                        commit((d) => void (d.sections[si].items[ii].meta = v))
                      }
                    />
                  ) : null}
                </div>
                <div style={{ paddingTop: 7 }}>
                  {ledgerTitle(item, si, ii)}
                  {ledgerCompany(item, si, ii)}
                  {ledgerBullets(item, si, ii)}
                </div>
              </Fragment>
            ))}
          </Fragment>
        ))}
        {cv.skills.length > 0 && (
          <div
            style={{
              gridColumn: "1 / -1",
              borderTop: `1px solid ${pal.rule}`,
              marginTop: 14,
              paddingTop: 9,
            }}
          >
            <h2 className={`${ledgerLabelCls} mb-[7px]`} style={{ color: accent }}>
              Skills
            </h2>
            {ledgerChips("rounded-[4px] px-2 py-[2.5px] text-[9px]")}
          </div>
        )}
      </div>
    </>
  );

  // 2-column: dates inline-right on each role; sections balance across a
  // center hairline (same weighting as splitBody).
  const ledgerSplitSection = (
    section: (typeof sections)[number]["section"],
    si: number
  ): ReactNode => (
    <div key={section.id}>
      <Editable
        as="h2"
        className={ledgerLabelCls}
        style={{ color: accent, borderTop: `1px solid ${pal.rule}`, paddingTop: 8 }}
        value={section.title}
        editable={editable}
        onCommit={(v) => commit((d) => void (d.sections[si].title = v))}
      />
      <div className="mt-[7px] space-y-2">
        {section.items.map((item, ii) => (
          <div key={item.id}>
            <div className="flex items-baseline justify-between gap-2">
              {ledgerTitle(item, si, ii)}
              {item.meta && (
                <Editable
                  className={`${FONT.mono} shrink-0 whitespace-nowrap text-[8px] tabular-nums`}
                  style={{ color: pal.subtle }}
                  value={item.meta}
                  editable={editable}
                  onCommit={(v) =>
                    commit((d) => void (d.sections[si].items[ii].meta = v))
                  }
                />
              )}
            </div>
            {ledgerCompany(item, si, ii)}
            {ledgerBullets(item, si, ii)}
          </div>
        ))}
      </div>
    </div>
  );

  const ledgerSplit = (() => {
    type Block = { node: ReactNode; weight: number };
    const blocks: Block[] = sections.map(({ section, si }) => ({
      node: ledgerSplitSection(section, si),
      weight: 2.5 + section.items.reduce((a, it) => a + 1.5 + it.bullets.length, 0),
    }));
    if (cv.skills.length > 0) {
      blocks.push({
        node: (
          <div key="__skills">
            <h2
              className={ledgerLabelCls}
              style={{ color: accent, borderTop: `1px solid ${pal.rule}`, paddingTop: 8 }}
            >
              Skills
            </h2>
            <div className="mt-[7px]">
              {ledgerChips("rounded-[4px] px-[7px] py-[2px] text-[8.5px]")}
            </div>
          </div>
        ),
        weight: 2 + Math.ceil(cv.skills.join(" ").length / 60),
      });
    }
    const total = blocks.reduce((a, b) => a + b.weight, 0);
    const left: ReactNode[] = [];
    const right: ReactNode[] = [];
    let acc = 0;
    for (const b of blocks) {
      if (acc < total / 2) {
        left.push(b.node);
        acc += b.weight;
      } else {
        right.push(b.node);
      }
    }
    if (right.length === 0 && left.length > 1) right.unshift(left.pop());
    const colCls = "flex-1 min-w-0 space-y-3";
    return (
      <>
        <div style={{ height: 1, background: pal.rule, marginTop: 14 }} />
        {cv.summary && (
          <div className="mt-3">
            <h2 className={ledgerLabelCls} style={{ color: accent }}>
              Summary
            </h2>
            <Editable
              as="p"
              className="mt-1"
              value={cv.summary}
              editable={editable}
              onCommit={(v) => commit((d) => void (d.summary = v))}
            >
              {editable ? undefined : withMetrics(cv.summary, accent)}
            </Editable>
          </div>
        )}
        <div className="mt-3 flex">
          <div className={`${colCls} pr-5`}>{left}</div>
          <div
            className={`${colCls} pl-5`}
            style={{ borderLeft: `1px solid ${pal.rule}` }}
          >
            {right}
          </div>
        </div>
      </>
    );
  })();

  const ledgerBody = split ? ledgerSplit : ledgerGrid;

  /* ================= Structural layouts (1b–1k) ============================
     Shared atoms + a configurable "stacked" body, then one render function per
     design. Every text node stays wrapped in Editable; the DOM order stays
     linear (name → headline → contact → summary → experience → skills →
     education) so every design remains ATS-safe. Visual columns/rails/bands
     are CSS only. */
  type Item = TailoredCv["sections"][number]["items"][number];

  const nameNode = (cls: string, style?: CSSProperties) => (
    <Editable
      as="h1"
      className={cls}
      style={style}
      value={cv.contact.fullName}
      editable={editable}
      onCommit={(v) => commit((d) => void (d.contact.fullName = v))}
    />
  );
  const headlineNode = (cls: string, style?: CSSProperties, prefix?: string) =>
    cv.headline ? (
      <div className={cls} style={style}>
        {prefix ? <span>{prefix}</span> : null}
        <Editable
          value={cv.headline}
          editable={editable}
          onCommit={(v) => commit((d) => void (d.headline = v))}
        />
      </div>
    ) : null;
  const contactInline = (cls: string, style?: CSSProperties, sep = "·") => (
    <div className={cls} style={style}>
      {contactBits.map((bit, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span className="opacity-50">{`  ${sep}  `}</span>
          ) : null}
          {bit}
        </Fragment>
      ))}
    </div>
  );
  const contactStacked = (cls: string, style?: CSSProperties) => (
    <div className={cls} style={style}>
      {contactBits.map((bit, i) => (
        <div key={i} className="break-words">
          {bit}
        </div>
      ))}
    </div>
  );

  const mTitle = (item: Item, si: number, ii: number, cls = "text-[11.5px] font-semibold") => (
    <Editable
      className={cls}
      value={item.primary}
      editable={editable}
      onCommit={(v) => commit((d) => void (d.sections[si].items[ii].primary = v))}
    />
  );
  const mDate = (item: Item, si: number, ii: number, cls: string, style?: CSSProperties) =>
    item.meta ? (
      <Editable
        className={cls}
        style={style}
        value={item.meta}
        editable={editable}
        onCommit={(v) => commit((d) => void (d.sections[si].items[ii].meta = v))}
      />
    ) : null;
  const mCompany = (
    item: Item,
    si: number,
    ii: number,
    cls: string,
    style?: CSSProperties,
    prefix?: string
  ) =>
    item.secondary ? (
      <div className={cls} style={style}>
        {prefix ? <span>{prefix}</span> : null}
        <Editable
          value={item.secondary}
          editable={editable}
          onCommit={(v) => commit((d) => void (d.sections[si].items[ii].secondary = v))}
        />
      </div>
    ) : null;
  const mBullets = (item: Item, si: number, ii: number, ulCls: string) =>
    item.bullets.length > 0 ? (
      <ul className={ulCls}>
        {item.bullets.map((bullet, bi) => (
          <Editable
            key={bi}
            as="li"
            value={bullet}
            editable={editable}
            {...bulletEditProps(si, ii, bi)}
            onCommit={(v) =>
              commit((d) => {
                if (v === "") d.sections[si].items[ii].bullets.splice(bi, 1);
                else d.sections[si].items[ii].bullets[bi] = v;
              })
            }
          >
            {editable ? undefined : withMetrics(bullet, accent)}
          </Editable>
        ))}
      </ul>
    ) : null;
  const summaryNode = (cls: string) => (
    <Editable
      as="p"
      className={cls}
      value={cv.summary}
      editable={editable}
      onCommit={(v) => commit((d) => void (d.summary = v))}
    >
      {editable ? undefined : withMetrics(cv.summary, accent)}
    </Editable>
  );
  const skillChips = (chipCls: string, chipStyle?: CSSProperties) => (
    <div className="flex flex-wrap gap-[5px]">
      {cv.skills.map((skill, i) => (
        <Editable
          key={i}
          className={chipCls}
          style={chipStyle}
          value={skill}
          editable={editable}
          onCommit={(v) =>
            commit((d) => {
              if (v === "") d.skills.splice(i, 1);
              else d.skills[i] = v;
            })
          }
        />
      ))}
    </div>
  );
  const skillInline = (cls: string) => (
    <Editable
      as="p"
      className={cls}
      value={cv.skills.join("  ·  ")}
      editable={editable}
      onCommit={(v) =>
        commit(
          (d) =>
            void (d.skills = v
              .split(/[·,]/)
              .map((x) => x.trim())
              .filter(Boolean))
        )
      }
    />
  );

  type LabelFn = (text: string, num: number, si?: number) => ReactNode;
  type BlockCfg = {
    label: LabelFn;
    titleCls?: string;
    dateCls: string;
    dateStyle?: CSSProperties;
    companyCls: string;
    companyStyle?: CSSProperties;
    companyPrefix?: string;
    ulCls: string;
    summaryCls: string;
    skillsNode: ReactNode;
    itemGap?: string;
    /** Skip the summary block (rendered full-width elsewhere). */
    sectionsOnly?: boolean;
  };
  // Summary + each section + skills as a list of weighted blocks. Used by every
  // "stacked" design; the label style differs per design via cfg.label.
  const buildBlocks = (cfg: BlockCfg) => {
    const blocks: { node: ReactNode; weight: number }[] = [];
    let n = 0;
    if (cv.summary && !cfg.sectionsOnly) {
      n += 1;
      blocks.push({
        node: (
          <div key="__summary">
            {cfg.label("Summary", n)}
            <div className="mt-[6px]">{summaryNode(cfg.summaryCls)}</div>
          </div>
        ),
        weight: 3,
      });
    }
    sections.forEach(({ section, si }) => {
      n += 1;
      blocks.push({
        node: (
          <div key={section.id}>
            {cfg.label(section.title, n, si)}
            <div className={cfg.itemGap ?? "mt-[7px] space-y-2"}>
              {section.items.map((item, ii) => (
                <div key={item.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    {mTitle(item, si, ii, cfg.titleCls)}
                    {mDate(item, si, ii, cfg.dateCls, cfg.dateStyle)}
                  </div>
                  {mCompany(item, si, ii, cfg.companyCls, cfg.companyStyle, cfg.companyPrefix)}
                  {mBullets(item, si, ii, cfg.ulCls)}
                </div>
              ))}
            </div>
          </div>
        ),
        weight: 2.5 + section.items.reduce((a, it) => a + 1.5 + it.bullets.length, 0),
      });
    });
    if (cv.skills.length > 0) {
      n += 1;
      blocks.push({
        node: (
          <div key="__skills">
            {cfg.label("Skills", n)}
            <div className="mt-[7px]">{cfg.skillsNode}</div>
          </div>
        ),
        weight: 2 + Math.ceil(cv.skills.join(" ").length / 60),
      });
    }
    return blocks;
  };
  const renderBlocks = (
    blocks: { node: ReactNode; weight: number }[],
    twoCol: boolean,
    rule: string
  ): ReactNode => {
    if (!twoCol) return <div className="space-y-3">{blocks.map((b) => b.node)}</div>;
    const total = blocks.reduce((a, b) => a + b.weight, 0);
    const left: ReactNode[] = [];
    const right: ReactNode[] = [];
    let acc = 0;
    for (const b of blocks) {
      if (acc < total / 2) {
        left.push(b.node);
        acc += b.weight;
      } else {
        right.push(b.node);
      }
    }
    if (right.length === 0 && left.length > 1) right.unshift(left.pop());
    return (
      <div className="flex">
        <div className="min-w-0 flex-1 space-y-3 pr-5">{left}</div>
        <div
          className="min-w-0 flex-1 space-y-3 pl-5"
          style={{ borderLeft: `1px solid ${rule}` }}
        >
          {right}
        </div>
      </div>
    );
  };
  // Editable section title used by the stacked designs' labels.
  const labelTitle = (text: string, si: number | undefined, cls: string) =>
    si != null ? (
      <Editable
        className={cls}
        value={text}
        editable={editable}
        onCommit={(v) => commit((d) => void (d.sections[si].title = v))}
      />
    ) : (
      <span className={cls}>{text}</span>
    );

  /* ---- 1b · Index — numbered 01/02/03 headers over hairline rules -------- */
  const renderIndex = () => {
    const label: LabelFn = (text, num, si) => (
      <div
        className="flex items-baseline gap-[10px] border-b pb-[5px]"
        style={{ borderColor: pal.rule }}
      >
        <span
          className={`${FONT.space} text-[13px] font-bold tabular-nums`}
          style={{ color: accent }}
        >
          {String(num).padStart(2, "0")}
        </span>
        {labelTitle(text, si, t.sectionTitle)}
      </div>
    );
    const blocks = buildBlocks({
      label,
      titleCls: "text-[11.5px] font-semibold",
      dateCls: "shrink-0 text-[8.5px] tabular-nums",
      dateStyle: { color: pal.subtle },
      companyCls: "text-[10px] font-medium",
      companyStyle: { color: accent },
      ulCls: "mt-1 list-disc pl-[14px] space-y-0.5 marker:[color:var(--cv-accent)]",
      summaryCls: "text-[10px] leading-relaxed",
      skillsNode: skillChips("rounded-[3px] px-2 py-[2.5px] text-[9px]", {
        border: `1px solid ${pal.rule}`,
      }),
    });
    return (
      <>
        {nameNode(t.name)}
        {headlineNode(t.headline, { color: pal.subtle })}
        {contactInline("mt-2 text-[9px] tabular-nums", { color: pal.subtle })}
        <div className="mt-4">{renderBlocks(blocks, split, pal.rule)}</div>
      </>
    );
  };

  /* ---- 1c · Masthead — small-caps titles riding a hairline to the margin - */
  const renderMasthead = () => {
    const label: LabelFn = (text, num, si) => (
      <div className="mt-[14px] flex items-center gap-[10px]">
        {labelTitle(text, si, `${t.sectionTitle} whitespace-nowrap`)}
        <span className="h-px flex-1" style={{ background: pal.rule }} />
      </div>
    );
    const blocks = buildBlocks({
      label,
      titleCls: `${FONT.playfair} text-[13px] font-semibold`,
      dateCls: "shrink-0 text-[8.5px] tabular-nums",
      dateStyle: { color: pal.subtle },
      companyCls: "italic text-[10px]",
      companyStyle: { color: pal.subtle },
      ulCls: "mt-1 list-disc pl-[15px] space-y-0.5 marker:[color:var(--cv-accent)]",
      summaryCls: "text-[10.5px] leading-relaxed",
      itemGap: "mt-[8px] space-y-[10px]",
      skillsNode: skillInline("text-[10.5px] leading-[1.7]"),
    });
    return (
      <>
        <div className="flex items-end justify-between gap-4">
          {nameNode(t.name)}
          {contactStacked("text-right text-[8px] leading-[1.6] tabular-nums", {
            color: pal.subtle,
          })}
        </div>
        <div className="mt-[10px] h-[2px]" style={{ background: accent }} />
        {headlineNode(t.headline, { color: pal.subtle })}
        <div>{renderBlocks(blocks, split, pal.rule)}</div>
      </>
    );
  };

  /* ---- 1d · Marginalia — labels hang in an 88px left gutter -------------- */
  const renderMarginalia = () => {
    const masthead = (
      <div style={{ gridColumn: "1 / -1" }}>
        {nameNode(t.name)}
        {headlineNode(t.headline, { color: pal.subtle })}
        {contactInline(`${FONT.inter} mt-2 text-[8.5px] tabular-nums`, { color: pal.subtle })}
      </div>
    );
    const item = (it: Item, si: number, ii: number, last: boolean) => (
      <div key={it.id} className={last ? "" : "mb-[11px]"}>
        <div className="flex items-baseline justify-between gap-2">
          {mTitle(it, si, ii, "text-[12px] font-semibold")}
          {mDate(it, si, ii, `${FONT.inter} shrink-0 text-[8.5px] tabular-nums`, {
            color: pal.subtle,
          })}
        </div>
        {mCompany(it, si, ii, "italic text-[10px]", { color: pal.subtle })}
        {mBullets(it, si, ii, "mt-1 list-disc pl-[15px] space-y-0.5 marker:[color:var(--cv-accent)]")}
      </div>
    );
    if (split) {
      // Narrow: labels fold above each section.
      const blocks = buildBlocks({
        label: (text, num, si) => labelTitle(text, si, `${t.sectionTitle} block`),
        titleCls: "text-[12px] font-semibold",
        dateCls: `${FONT.inter} shrink-0 text-[8.5px] tabular-nums`,
        dateStyle: { color: pal.subtle },
        companyCls: "italic text-[10px]",
        companyStyle: { color: pal.subtle },
        ulCls: "mt-1 list-disc pl-[15px] space-y-0.5 marker:[color:var(--cv-accent)]",
        summaryCls: "text-[10.5px] leading-[1.6]",
        skillsNode: skillInline("text-[10.5px] leading-[1.7]"),
      });
      return (
        <>
          <div className="mb-3">
            {nameNode(t.name)}
            {headlineNode(t.headline, { color: pal.subtle })}
            {contactInline(`${FONT.inter} mt-2 text-[8.5px] tabular-nums`, { color: pal.subtle })}
          </div>
          {renderBlocks(blocks, true, pal.rule)}
        </>
      );
    }
    const rowLabel = (text: string, si?: number) => (
      <div
        className={`${t.sectionTitle} text-right`}
        style={{ color: pal.subtle, paddingTop: 2 }}
      >
        {labelTitle(text, si, "")}
      </div>
    );
    return (
      <div
        className="grid"
        style={{ gridTemplateColumns: "88px 1fr", columnGap: 22, rowGap: 18 }}
      >
        {masthead}
        {cv.summary && (
          <>
            {rowLabel("Summary")}
            <div>{summaryNode("text-[10.5px] leading-[1.6]")}</div>
          </>
        )}
        {sections.map(({ section, si }) => (
          <Fragment key={section.id}>
            {rowLabel(section.title, si)}
            <div>
              {section.items.map((it, ii) =>
                item(it, si, ii, ii === section.items.length - 1)
              )}
            </div>
          </Fragment>
        ))}
        {cv.skills.length > 0 && (
          <>
            {rowLabel("Skills")}
            <div>{skillInline("text-[10.5px] leading-[1.7]")}</div>
          </>
        )}
      </div>
    );
  };

  /* ---- 1e · Panel — full-bleed header banner over a quiet body ----------- */
  const renderPanel = () => {
    const bannerBg = theme === "light" ? "#232a34" : "#212a36";
    const bannerText = theme === "light" ? "#f4f5f6" : pal.text;
    const bannerSub = theme === "light" ? "#b9c0ca" : pal.subtle;
    const bannerMeta = theme === "light" ? "#aeb6c0" : "#8b95a3";
    const label: LabelFn = (text, num, si) => (
      <div
        className="mb-2 border-b pb-[5px] text-[9.5px] font-bold uppercase tracking-[0.16em]"
        style={{ borderColor: pal.rule, color: accent }}
      >
        {labelTitle(text, si, "")}
      </div>
    );
    const blocks = buildBlocks({
      label,
      titleCls: "text-[11.5px] font-semibold",
      dateCls: `${FONT.mono} shrink-0 text-[8px] tabular-nums`,
      dateStyle: { color: pal.subtle },
      companyCls: "text-[10px]",
      companyStyle: { color: pal.subtle },
      ulCls: "mt-1 list-disc pl-[14px] space-y-0.5 marker:[color:var(--cv-accent)]",
      summaryCls: "text-[10.5px] leading-relaxed",
      skillsNode: skillChips("rounded-[3px] px-2 py-[3px] text-[9px]", {
        background: theme === "light" ? "#f1f1ee" : "rgba(255,255,255,0.08)",
      }),
    });
    return (
      <>
        <div
          className="-mx-12 -mt-10 px-12 pb-6 pt-10"
          style={{
            background: bannerBg,
            color: bannerText,
            borderBottom: theme === "light" ? undefined : `2px solid ${accent}`,
          }}
        >
          {nameNode(`${FONT.playfair} text-[27px] font-bold leading-[1.04]`)}
          {headlineNode("mt-1 text-[11px]", { color: bannerSub })}
          <div className="my-3 h-px" style={{ background: "rgba(255,255,255,0.16)" }} />
          {contactInline(`${FONT.mono} text-[8.5px] tabular-nums`, { color: bannerMeta })}
        </div>
        <div className="mt-5">{renderBlocks(blocks, split, pal.rule)}</div>
      </>
    );
  };

  /* ---- 1f · Column Rule — centered masthead over a center-ruled body ----- */
  const renderColumnRule = () => {
    const label: LabelFn = (text, num, si) => (
      <div
        className="mb-[6px] border-b pb-[4px] text-[9.5px] font-bold uppercase tracking-[0.16em]"
        style={{ borderColor: pal.rule, color: accent }}
      >
        {labelTitle(text, si, "")}
      </div>
    );
    const blocks = buildBlocks({
      label,
      sectionsOnly: true,
      titleCls: "text-[11px] font-semibold",
      dateCls: `${FONT.mono} shrink-0 whitespace-nowrap text-[7.5px] tabular-nums`,
      dateStyle: { color: pal.subtle },
      companyCls: "text-[9px]",
      companyStyle: { color: pal.subtle },
      ulCls: "mt-[3px] list-disc pl-[13px] space-y-0.5 marker:[color:var(--cv-accent)]",
      summaryCls: "",
      skillsNode: skillChips("rounded-[3px] px-[7px] py-[2px] text-[8.5px]", {
        border: `1px solid ${pal.rule}`,
      }),
    });
    return (
      <>
        <div className="text-center">
          {nameNode(t.name)}
          {headlineNode(t.headline, { color: pal.subtle })}
          {contactInline(`${FONT.mono} mt-[7px] text-[8px] tabular-nums`, { color: pal.subtle })}
        </div>
        <div className="my-3 h-px" style={{ background: pal.rule }} />
        {cv.summary && (
          <div className="mb-3">
            <div
              className="mb-[6px] border-b pb-[4px] text-[9.5px] font-bold uppercase tracking-[0.16em]"
              style={{ borderColor: pal.rule, color: accent }}
            >
              Summary
            </div>
            {summaryNode("text-[10px] leading-relaxed")}
          </div>
        )}
        {renderBlocks(blocks, true, pal.rule)}
      </>
    );
  };

  /* ---- 1g · Rail — tinted left sidebar carries the facts ----------------- */
  const renderRail = () => {
    const isSupport = (title: string) =>
      /education|certificat|licens|language|award|course|training/i.test(title);
    const support = sections.filter(({ section }) => isSupport(section.title));
    const narrative = sections.filter(({ section }) => !isSupport(section.title));
    const railBg = theme === "light" ? "#f4f6f2" : "#1e242e";
    const railBorder = theme === "light" ? "#e7ebe3" : "rgba(255,255,255,0.08)";
    const sideLabel = "text-[8.5px] font-bold uppercase tracking-[0.14em]";
    const mainLabel = "text-[9px] font-bold uppercase tracking-[0.14em]";
    return (
      <>
        <div className="pb-[14px]">
          {nameNode(t.name)}
          {headlineNode(t.headline, { color: accent })}
        </div>
        <div className="flex">
          <div className="order-2 min-w-0 flex-1 pl-[22px] pt-[2px]">
            {cv.summary && (
              <>
                <div className={mainLabel} style={{ color: accent }}>
                  Summary
                </div>
                <div className="mt-[5px]">{summaryNode("text-[10px] leading-relaxed")}</div>
              </>
            )}
            {narrative.map(({ section, si }) => (
              <div key={section.id} className="mt-[14px]">
                <Editable
                  className={mainLabel}
                  style={{ color: accent }}
                  value={section.title}
                  editable={editable}
                  onCommit={(v) => commit((d) => void (d.sections[si].title = v))}
                />
                <div className="mt-[7px] space-y-[9px]">
                  {section.items.map((it, ii) => (
                    <div key={it.id}>
                      <div className="flex items-baseline justify-between gap-2">
                        {mTitle(it, si, ii, "text-[11px] font-bold")}
                        {mDate(
                          it,
                          si,
                          ii,
                          `${FONT.mono} shrink-0 whitespace-nowrap text-[7.5px] tabular-nums`,
                          { color: pal.subtle }
                        )}
                      </div>
                      {mCompany(it, si, ii, "text-[9.5px]", { color: pal.subtle })}
                      {mBullets(
                        it,
                        si,
                        ii,
                        "mt-1 list-disc pl-[14px] space-y-0.5 marker:[color:var(--cv-accent)]"
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <aside
            className="order-1 shrink-0 pb-6 pr-[18px] pt-[2px]"
            style={{
              width: 200,
              marginLeft: -48,
              paddingLeft: 48,
              background: railBg,
              borderRight: `1px solid ${railBorder}`,
            }}
          >
            <div className={sideLabel} style={{ color: accent }}>
              Contact
            </div>
            {contactStacked("mt-[5px] text-[8.5px] leading-[1.7]", { color: pal.subtle })}
            {cv.skills.length > 0 && (
              <>
                <div className={`${sideLabel} mt-4`} style={{ color: accent }}>
                  Skills
                </div>
                <div className="mt-[6px]">
                  {skillChips("rounded-[3px] px-[6px] py-[2px] text-[8.5px]", {
                    background:
                      theme === "light" ? "#e6efe4" : "rgba(134,206,166,0.14)",
                    color: theme === "light" ? "#274f3b" : "#a8dcbe",
                  })}
                </div>
              </>
            )}
            {support.map(({ section, si }) => (
              <div key={section.id}>
                <Editable
                  className={`${sideLabel} mt-4 block`}
                  style={{ color: accent }}
                  value={section.title}
                  editable={editable}
                  onCommit={(v) => commit((d) => void (d.sections[si].title = v))}
                />
                {section.items.map((it, ii) => (
                  <div key={it.id} className="mt-[5px]">
                    {mTitle(it, si, ii, "text-[9.5px] font-semibold")}
                    {mCompany(it, si, ii, "text-[8.5px]", { color: pal.subtle })}
                    {mDate(it, si, ii, `${FONT.mono} text-[8px] tabular-nums`, {
                      color: pal.subtle,
                    })}
                  </div>
                ))}
              </div>
            ))}
          </aside>
        </div>
      </>
    );
  };

  /* ---- 1h · Grid — Swiss modular grid, foot module = education | skills -- */
  const renderGrid = () => {
    const isEdu = (title: string) => /education/i.test(title);
    const edu = sections.filter(({ section }) => isEdu(section.title));
    const narrative = sections.filter(({ section }) => !isEdu(section.title));
    const gLabelCls = `${FONT.archivo} mb-[6px] block text-[9px] font-bold uppercase tracking-[0.16em]`;
    return (
      <>
        <div className="flex items-start justify-between gap-4">
          <div>
            {nameNode(t.name)}
            {headlineNode(t.headline, { color: accent })}
          </div>
          {contactStacked(`${FONT.mono} text-right text-[7.5px] leading-[1.7] tabular-nums`, {
            color: pal.subtle,
          })}
        </div>
        {cv.summary && (
          <div className="mt-[13px] border-t pt-[9px]" style={{ borderColor: pal.rule }}>
            <div className={gLabelCls} style={{ color: accent }}>
              Summary
            </div>
            {summaryNode("text-[10px] leading-relaxed")}
          </div>
        )}
        {narrative.map(({ section, si }) => (
          <div
            key={section.id}
            className="mt-3 border-t pt-[9px]"
            style={{ borderColor: pal.rule }}
          >
            <Editable
              className={gLabelCls}
              style={{ color: accent }}
              value={section.title}
              editable={editable}
              onCommit={(v) => commit((d) => void (d.sections[si].title = v))}
            />
            <div className="space-y-[9px]">
              {section.items.map((it, ii) => (
                <div key={it.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    {mTitle(it, si, ii, `${FONT.archivo} text-[11.5px] font-bold`)}
                    {mDate(it, si, ii, `${FONT.mono} shrink-0 text-[8px] tabular-nums`, {
                      color: pal.subtle,
                    })}
                  </div>
                  {mCompany(it, si, ii, "text-[9.5px]", { color: pal.subtle })}
                  {mBullets(
                    it,
                    si,
                    ii,
                    "mt-1 list-disc pl-[14px] space-y-0.5 marker:[color:var(--cv-accent)]"
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div
          className="mt-3 grid grid-cols-2 border-t pt-[9px]"
          style={{ borderColor: pal.rule }}
        >
          <div className="pr-[15px]">
            {edu.length > 0 ? (
              edu.map(({ section, si }) => (
                <div key={section.id}>
                  <Editable
                    className={gLabelCls}
                    style={{ color: accent }}
                    value={section.title}
                    editable={editable}
                    onCommit={(v) => commit((d) => void (d.sections[si].title = v))}
                  />
                  {section.items.map((it, ii) => (
                    <div key={it.id} className="mb-1">
                      {mTitle(it, si, ii, "text-[10.5px] font-semibold")}
                      {mCompany(it, si, ii, "text-[9.5px]", { color: pal.subtle })}
                      {mDate(it, si, ii, `${FONT.mono} text-[8px] tabular-nums`, {
                        color: pal.subtle,
                      })}
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <div className={gLabelCls} style={{ color: accent }}>
                &nbsp;
              </div>
            )}
          </div>
          <div className="pl-[15px]" style={{ borderLeft: `1px solid ${pal.rule}` }}>
            <div className={gLabelCls} style={{ color: accent }}>
              Skills
            </div>
            <div className="grid grid-cols-2 gap-1">
              {cv.skills.map((skill, i) => (
                <Editable
                  key={i}
                  className="rounded-[3px] border px-[6px] py-[2.5px] text-center text-[8.5px]"
                  style={{ borderColor: pal.rule }}
                  value={skill}
                  editable={editable}
                  onCommit={(v) =>
                    commit((d) => {
                      if (v === "") d.skills.splice(i, 1);
                      else d.skills[i] = v;
                    })
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </>
    );
  };

  /* ---- 1i · Timeline — a ruled vertical spine down experience ------------ */
  const renderTimeline = () => {
    const isEdu = (title: string) => /education/i.test(title);
    const spineSecs = sections.filter(({ section }) => !isEdu(section.title));
    const eduSecs = sections.filter(({ section }) => isEdu(section.title));
    const tLabel = `${FONT.space} text-[9.5px] font-bold uppercase tracking-[0.16em] block`;
    const spineColor = theme === "light" ? "#e2dde4" : "rgba(255,255,255,0.16)";
    return (
      <>
        {nameNode(t.name)}
        {headlineNode(t.headline, { color: accent })}
        {contactInline(`${FONT.mono} mt-2 text-[8.5px] tabular-nums`, { color: pal.subtle })}
        <div className="mt-[14px] h-px" style={{ background: pal.rule }} />
        {cv.summary && (
          <div className="mt-3">
            <div className={tLabel} style={{ color: accent }}>
              Summary
            </div>
            <div className="mt-[5px]">{summaryNode("text-[10px] leading-relaxed")}</div>
          </div>
        )}
        {spineSecs.map(({ section, si }) => (
          <div key={section.id} className="mt-[13px]">
            <Editable
              className={`${tLabel} mb-2`}
              style={{ color: accent }}
              value={section.title}
              editable={editable}
              onCommit={(v) => commit((d) => void (d.sections[si].title = v))}
            />
            <div className="ml-[3px] pl-[20px]" style={{ borderLeft: `1.5px solid ${spineColor}` }}>
              {section.items.map((it, ii) => (
                <div key={it.id} className="relative mb-3 last:mb-0">
                  <span
                    className="absolute"
                    style={{
                      left: -24.5,
                      top: 2,
                      width: 9,
                      height: 9,
                      borderRadius: 999,
                      background: pal.bg,
                      border: `2px solid ${accent}`,
                    }}
                  />
                  <div className="flex items-baseline justify-between gap-2">
                    {mTitle(it, si, ii, "text-[11.5px] font-semibold")}
                    {mDate(it, si, ii, `${FONT.mono} shrink-0 text-[8px] tabular-nums`, {
                      color: pal.subtle,
                    })}
                  </div>
                  {mCompany(it, si, ii, "text-[9.5px]", { color: pal.subtle })}
                  {mBullets(
                    it,
                    si,
                    ii,
                    "mt-1 list-disc pl-[14px] space-y-0.5 marker:[color:var(--cv-accent)]"
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {(eduSecs.length > 0 || cv.skills.length > 0) && (
          <div className="mt-[13px] flex gap-5">
            {eduSecs.length > 0 && (
              <div className="min-w-0 flex-1">
                {eduSecs.map(({ section, si }) => (
                  <div key={section.id}>
                    <Editable
                      className={`${tLabel} mb-[6px]`}
                      style={{ color: accent }}
                      value={section.title}
                      editable={editable}
                      onCommit={(v) => commit((d) => void (d.sections[si].title = v))}
                    />
                    {section.items.map((it, ii) => (
                      <div key={it.id} className="mb-1">
                        {mTitle(it, si, ii, "text-[10.5px] font-semibold")}
                        <div
                          className="flex flex-wrap items-baseline gap-x-1.5 text-[9px]"
                          style={{ color: pal.subtle }}
                        >
                          {it.secondary && (
                            <Editable
                              value={it.secondary}
                              editable={editable}
                              onCommit={(v) =>
                                commit((d) => void (d.sections[si].items[ii].secondary = v))
                              }
                            />
                          )}
                          {it.secondary && it.meta && <span>·</span>}
                          {it.meta && (
                            <Editable
                              className="tabular-nums"
                              value={it.meta}
                              editable={editable}
                              onCommit={(v) =>
                                commit((d) => void (d.sections[si].items[ii].meta = v))
                              }
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {cv.skills.length > 0 && (
              <div className="min-w-0 flex-1">
                <div className={`${tLabel} mb-[6px]`} style={{ color: accent }}>
                  Skills
                </div>
                {skillChips("rounded-[3px] px-[7px] py-[2px] text-[8.5px]", {
                  background: theme === "light" ? "#f0eaf1" : "rgba(193,166,204,0.18)",
                  color: theme === "light" ? "#533b5c" : "#d8c4e0",
                })}
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  /* ---- 1j · Spec Sheet — README markers + a boxed skill stack ------------ */
  const renderSpecSheet = () => {
    const label: LabelFn = (text, num, si) => (
      <div
        className={`${FONT.mono} mb-[5px] mt-3 text-[9.5px] font-bold tracking-[0.1em]`}
        style={{ color: accent }}
      >
        <span>{"// "}</span>
        {labelTitle(text, si, "uppercase")}
      </div>
    );
    const blocks = buildBlocks({
      label,
      titleCls: "text-[11.5px] font-semibold",
      dateCls: `${FONT.mono} shrink-0 text-[8px] tabular-nums`,
      dateStyle: { color: pal.subtle },
      companyCls: `${FONT.mono} text-[9px]`,
      companyStyle: { color: pal.subtle },
      companyPrefix: "@ ",
      ulCls: "mt-1 list-disc pl-[14px] space-y-0.5 marker:[color:var(--cv-accent)]",
      summaryCls: "text-[10px] leading-relaxed",
      skillsNode: (
        <div
          className="flex flex-wrap gap-[5px] rounded-[6px] border p-[10px]"
          style={{
            borderColor: pal.rule,
            background: theme === "light" ? "#f7f8f7" : "rgba(255,255,255,0.04)",
          }}
        >
          {cv.skills.map((skill, i) => (
            <Editable
              key={i}
              className={`${FONT.mono} rounded-[3px] border px-[7px] py-[2px] text-[8.5px]`}
              style={{
                borderColor: theme === "light" ? "#cfe0d6" : "rgba(110,231,183,0.35)",
                color: accent,
              }}
              value={skill}
              editable={editable}
              onCommit={(v) =>
                commit((d) => {
                  if (v === "") d.skills.splice(i, 1);
                  else d.skills[i] = v;
                })
              }
            />
          ))}
        </div>
      ),
    });
    return (
      <>
        {nameNode(t.name)}
        {headlineNode(t.headline, { color: accent }, "// ")}
        {contactInline(`${FONT.mono} mt-2 text-[8.5px] tabular-nums`, { color: pal.subtle }, " ")}
        <div className="mt-[13px] h-px" style={{ background: pal.rule }} />
        <div className="mt-1">{renderBlocks(blocks, split, pal.rule)}</div>
      </>
    );
  };

  /* ---- 1k · Mono — pure terminal, # markers, [bracketed] skills ---------- */
  const renderMono = () => {
    const label = (text: string, si?: number) => (
      <div
        className={`${FONT.mono} mt-[14px] text-[10px] lowercase`}
        style={{ color: accent, letterSpacing: "0.02em" }}
      >
        <span className="opacity-60">#</span>{" "}
        {labelTitle(text, si, "")}
      </div>
    );
    const monoBullets = (it: Item, si: number, ii: number) =>
      it.bullets.length > 0 ? (
        <ul className="mt-[3px] space-y-[2px]">
          {it.bullets.map((bullet, bi) => (
            <li key={bi} className="flex gap-1.5">
              <span style={{ color: accent }}>-</span>
              <Editable
                as="span"
                className={`${FONT.inter} text-[9.5px] leading-[1.55]`}
                value={bullet}
                editable={editable}
                {...bulletEditProps(si, ii, bi)}
                onCommit={(v) =>
                  commit((d) => {
                    if (v === "") d.sections[si].items[ii].bullets.splice(bi, 1);
                    else d.sections[si].items[ii].bullets[bi] = v;
                  })
                }
              >
                {editable ? undefined : withMetrics(bullet, accent)}
              </Editable>
            </li>
          ))}
        </ul>
      ) : null;
    return (
      <>
        <div className="inline-block pb-[2px]" style={{ borderBottom: `2px solid ${accent}` }}>
          {nameNode(t.name)}
        </div>
        {headlineNode(`${FONT.mono} mt-2 text-[10.5px]`, { color: accent })}
        {contactInline("mt-[6px] text-[8.5px] tabular-nums", { color: pal.subtle })}
        {cv.summary && (
          <div>
            {label("summary")}
            {summaryNode(`${FONT.inter} mt-[5px] text-[9.5px] leading-[1.6]`)}
          </div>
        )}
        {sections.map(({ section, si }) => (
          <div key={section.id}>
            {label(section.title, si)}
            {section.items.map((it, ii) => (
              <div key={it.id} className="mt-[7px]">
                <div className="flex items-baseline justify-between gap-2">
                  {mTitle(it, si, ii, "text-[10.5px] font-semibold")}
                  {mDate(it, si, ii, "shrink-0 text-[8px] tabular-nums", { color: pal.subtle })}
                </div>
                {mCompany(it, si, ii, "text-[9px]", { color: pal.subtle }, "@ ")}
                {monoBullets(it, si, ii)}
              </div>
            ))}
          </div>
        ))}
        {cv.skills.length > 0 && (
          <div>
            {label("skills")}
            <div className="mt-1 text-[9px] leading-[1.9]" style={{ color: pal.subtle }}>
              {cv.skills.map((skill, i) => (
                <span key={i} className="mr-2 whitespace-nowrap">
                  [
                  <Editable
                    as="span"
                    value={skill}
                    editable={editable}
                    onCommit={(v) =>
                      commit((d) => {
                        if (v === "") d.skills.splice(i, 1);
                        else d.skills[i] = v;
                      })
                    }
                  />
                  ]
                </span>
              ))}
            </div>
          </div>
        )}
      </>
    );
  };

  const customBody = (() => {
    switch (layout) {
      case "numbered":
        return renderIndex();
      case "masthead":
        return renderMasthead();
      case "marginalia":
        return renderMarginalia();
      case "band":
        return renderPanel();
      case "two-col":
        return renderColumnRule();
      case "rail":
        return renderRail();
      case "grid":
        return renderGrid();
      case "timeline":
        return renderTimeline();
      case "readme":
        return template === "mono" ? renderMono() : renderSpecSheet();
      default:
        return null;
    }
  })();

  const isShared = layout === "linear" || layout === "date-rail";

  return (
    <div
      {...(domId ? { id: domId } : {})}
      ref={pageRef}
      className={`cv-page mx-auto flex flex-col px-12 py-10 shadow-sm ${t.page}`}
      style={pageStyle}
    >
      <div ref={contentRef} className="flex flex-col">
        {isShared ? (
          <>
            {/* Full-width header — spans the page even in split view */}
            <Editable
              as="h1"
              className={`${t.name}${t.center ? " text-center" : ""}`}
              style={{ color: t.nameUsesAccent ? accent : pal.text }}
              value={cv.contact.fullName}
              editable={editable}
              onCommit={(v) => commit((d) => void (d.contact.fullName = v))}
            />
            {cv.headline && (
              <Editable
                as="p"
                className={`${t.headline}${t.center ? " text-center" : ""}`}
                style={{ color: t.headlineUsesAccent ? accent : pal.subtle }}
                value={cv.headline}
                editable={editable}
                onCommit={(v) => commit((d) => void (d.headline = v))}
              />
            )}
            <div
              className={`mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] ${t.contactExtra ?? ""} ${
                t.center ? "justify-center" : "justify-start"
              }`}
              style={{ color: pal.subtle }}
            >
              {contactBits.map((bit, i) => (
                <span key={i}>{bit}</span>
              ))}
            </div>

            {layout === "date-rail" ? (
              ledgerBody
            ) : (
              <>
                {cv.summary && (
                  <div className="mt-1">
                    <h2 className={t.sectionTitle} style={sectionTitleStyle}>
                      Summary
                    </h2>
                    <Editable
                      as="p"
                      value={cv.summary}
                      editable={editable}
                      onCommit={(v) => commit((d) => void (d.summary = v))}
                    />
                  </div>
                )}

                {split ? (
                  splitBody
                ) : (
                  <div className="mt-2 flex flex-col">
                    {sections.map((s) => renderSection(s))}
                    {cv.skills.length > 0 && renderSkills()}
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          customBody
        )}
      </div>
    </div>
  );
}
