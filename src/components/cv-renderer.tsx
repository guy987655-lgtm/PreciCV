"use client";

import { CSSProperties, ReactNode, useLayoutEffect, useRef, useState } from "react";
import { CvTemplate, TailoredCv } from "@/lib/types";

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

function Editable({
  value,
  onCommit,
  editable,
  className,
  style,
  as: Tag = "span",
}: {
  value: string;
  onCommit?: (v: string) => void;
  editable: boolean;
  className?: string;
  style?: CSSProperties;
  as?: "span" | "p" | "h1" | "h2" | "h3" | "li" | "div";
}) {
  return (
    <Tag
      className={
        (className ?? "") +
        (editable
          ? " outline-none hover:bg-indigo-50/60 focus:bg-indigo-50 focus:ring-1 focus:ring-indigo-300 rounded-sm transition-colors cursor-text"
          : "")
      }
      style={style}
      contentEditable={editable}
      suppressContentEditableWarning
      onBlur={(e) => {
        const next = (e.currentTarget.textContent ?? "").trim();
        if (editable && onCommit && next !== value) onCommit(next);
      }}
    >
      {value}
    </Tag>
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

type CvTheme = "light" | "dark";

/** Background + neutral text tones, shared by every template. */
const PALETTE: Record<CvTheme, { bg: string; text: string; subtle: string; rule: string }> = {
  light: { bg: "#ffffff", text: "#1a1a1a", subtle: "#64748b", rule: "#d9d9d9" },
  dark: { bg: "#171c24", text: "#e8ecf1", subtle: "#9aa5b3", rule: "rgba(255,255,255,0.18)" },
};

type SectionVariant = "underline" | "chip" | "plain";

type TemplateDef = {
  label: string;
  /** Signature accent (name / headings), per background. */
  accent: { light: string; dark: string };
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

  const commit = (mutate: (draft: TailoredCv) => void) => {
    if (!onChange) return;
    const draft: TailoredCv = JSON.parse(JSON.stringify(cv));
    mutate(draft);
    onChange(draft);
  };

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
  // back to the right cv.sections entry.
  const sections = cv.sections
    .map((section, si) => ({ section, si }))
    .filter(({ section }) => {
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

  return (
    <div
      {...(domId ? { id: domId } : {})}
      ref={pageRef}
      className={`cv-page mx-auto flex flex-col px-12 py-10 shadow-sm ${t.page}`}
      style={pageStyle}
    >
      <div ref={contentRef} className="flex flex-col">
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
      </div>
    </div>
  );
}
