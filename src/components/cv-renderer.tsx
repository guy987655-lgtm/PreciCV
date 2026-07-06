"use client";

import { CvTemplate, TailoredCv } from "@/lib/types";

/**
 * Renders a TailoredCv in one of 11 print-ready templates. Every design
 * shares the same structured model (contact → summary → sections → skills)
 * and lays out to a single A4 page, modelled on a clean professional
 * one-pager (Guy_Ratzon_Resume_BASE.pdf); they differ only in typeface,
 * spacing and color. Three are dark-background designs (onyx / midnight /
 * slate). `split` renders the body in two balanced columns with the header
 * and summary spanning the full width, and each section kept whole so a
 * column always begins with a section heading — never mid-paragraph.
 *
 * Optional inline editing (workspace only) makes text nodes contentEditable;
 * the public Results tab renders read-only.
 */

function Editable({
  value,
  onCommit,
  editable,
  className,
  as: Tag = "span",
}: {
  value: string;
  onCommit?: (v: string) => void;
  editable: boolean;
  className?: string;
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

type TemplateStyle = {
  /** Human label for the template picker. */
  label: string;
  /** Dark-background design (light text) — affects the picker swatch. */
  dark: boolean;
  /** Font family + text color + page background. */
  page: string;
  name: string;
  headline: string;
  /** justify + text color for the contact row. */
  contactRow: string;
  /** color for secondary/meta text (company, dates, contact). */
  subtle: string;
  sectionTitle: string;
  bullet: string;
  /** divider color between the two columns in split view. */
  ruleColor: string;
};

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

const TEMPLATE_STYLES: Record<CvTemplate, TemplateStyle> = {
  classic: {
    label: "Classic",
    dark: false,
    page: `${FONT.serif} bg-white text-[#1a1a1a]`,
    name: "text-center text-[27px] font-bold tracking-[0.02em]",
    headline: "text-center text-[12.5px] text-slate-600 mt-1",
    contactRow: "justify-center",
    subtle: "text-slate-500",
    sectionTitle:
      "text-[11px] font-bold uppercase tracking-[0.18em] border-b border-slate-300 pb-1 mb-2 mt-4",
    bullet: "list-disc",
    ruleColor: "#d8d8d8",
  },
  modern: {
    label: "Modern",
    dark: false,
    page: `${FONT.figtree} bg-white text-slate-900`,
    name: "text-[27px] font-extrabold tracking-tight text-[#1f4a36]",
    headline: "text-[13px] font-semibold text-[#2f6b4f] mt-0.5",
    contactRow: "justify-start",
    subtle: "text-slate-500",
    sectionTitle:
      "text-[11px] font-bold uppercase tracking-widest text-[#2f6b4f] border-b-2 border-[#c9dfc4] pb-1 mb-2 mt-4",
    bullet: "list-disc marker:text-[#9dbfa6]",
    ruleColor: "#e3e9dc",
  },
  compact: {
    label: "Compact",
    dark: false,
    page: `${FONT.inter} bg-white text-slate-900 text-[10.5px] leading-snug`,
    name: "text-[21px] font-bold tracking-tight",
    headline: "text-[11px] text-slate-600",
    contactRow: "justify-start",
    subtle: "text-slate-500",
    sectionTitle:
      "text-[10px] font-bold uppercase tracking-wider bg-slate-100 px-2 py-0.5 mb-1.5 mt-3",
    bullet: "list-[square]",
    ruleColor: "#e3e9dc",
  },
  executive: {
    label: "Executive",
    dark: false,
    page: `${FONT.serif} bg-white text-[#20242b]`,
    name: `text-center text-[30px] font-bold ${FONT.playfair} tracking-[0.01em]`,
    headline:
      "text-center text-[11.5px] uppercase tracking-[0.28em] text-slate-500 mt-2",
    contactRow: "justify-center",
    subtle: "text-slate-500",
    sectionTitle: `text-[12px] font-semibold ${FONT.playfair} uppercase tracking-[0.18em] border-b border-slate-300 pb-1 mb-2 mt-4`,
    bullet: "list-disc",
    ruleColor: "#d7d7d7",
  },
  elegant: {
    label: "Elegant",
    dark: false,
    page: `${FONT.lora} bg-white text-[#2b2b2b]`,
    name: `text-[28px] font-semibold ${FONT.playfair} text-[#7a5b34]`,
    headline: "text-[12.5px] italic text-slate-600 mt-0.5",
    contactRow: "justify-start",
    subtle: "text-slate-500",
    sectionTitle: `text-[12px] font-semibold ${FONT.playfair} uppercase tracking-[0.15em] text-[#7a5b34] border-b border-[#e4dccb] pb-1 mb-2 mt-4`,
    bullet: "list-disc marker:text-[#c2a878]",
    ruleColor: "#e6ddcd",
  },
  technical: {
    label: "Technical",
    dark: false,
    page: `${FONT.figtree} bg-white text-slate-900`,
    name: `text-[24px] font-bold ${FONT.mono} tracking-tight`,
    headline: `text-[12px] ${FONT.mono} text-[#2f6b4f] mt-1`,
    contactRow: `justify-start ${FONT.mono} text-[9.5px] tracking-tight`,
    subtle: "text-slate-500",
    sectionTitle: `text-[11px] font-bold uppercase tracking-widest ${FONT.mono} border-b-2 border-slate-800 pb-1 mb-2 mt-4`,
    bullet: "list-[square] marker:text-slate-400",
    ruleColor: "#e3e9dc",
  },
  contemporary: {
    label: "Contemporary",
    dark: false,
    page: `${FONT.space} bg-white text-[#141414]`,
    name: "text-[28px] font-bold tracking-tight",
    headline: "text-[13px] font-medium text-[#2f6b4f] mt-0.5",
    contactRow: "justify-start",
    subtle: "text-slate-500",
    sectionTitle:
      "inline-block text-[10.5px] font-bold uppercase tracking-wider text-white bg-[#1e2b24] px-2.5 py-1 rounded mb-2 mt-4",
    bullet: "list-disc marker:text-[#2f6b4f]",
    ruleColor: "#e3e9dc",
  },
  minimal: {
    label: "Minimal",
    dark: false,
    page: `${FONT.archivo} bg-white text-[#1c1c1c]`,
    name: "text-[25px] font-semibold tracking-tight",
    headline: "text-[12px] text-slate-500 mt-0.5",
    contactRow: "justify-start",
    subtle: "text-slate-400",
    sectionTitle:
      "text-[10.5px] font-semibold uppercase tracking-[0.28em] text-slate-400 mb-1.5 mt-5",
    bullet: "list-disc marker:text-slate-300",
    ruleColor: "#ececec",
  },
  onyx: {
    label: "Onyx",
    dark: true,
    page: `${FONT.space} bg-[#1e2b24] text-[#e8ede6]`,
    name: "text-[27px] font-bold tracking-tight text-white",
    headline: "text-[13px] font-medium text-[#9dbfa6] mt-0.5",
    contactRow: "justify-start",
    subtle: "text-[#9aa89c]",
    sectionTitle:
      "text-[11px] font-bold uppercase tracking-widest text-[#9dbfa6] border-b border-[#3a4a40] pb-1 mb-2 mt-4",
    bullet: "list-disc marker:text-[#5f8f74]",
    ruleColor: "rgba(157,191,166,0.28)",
  },
  midnight: {
    label: "Midnight",
    dark: true,
    page: `${FONT.serif} bg-[#0f172a] text-[#dbe2ef]`,
    name: `text-center text-[29px] font-bold ${FONT.playfair} text-white tracking-wide`,
    headline:
      "text-center text-[12px] uppercase tracking-[0.25em] text-[#d4af6a] mt-2",
    contactRow: "justify-center",
    subtle: "text-[#93a3bd]",
    sectionTitle: `text-[11px] font-semibold ${FONT.playfair} uppercase tracking-[0.2em] text-[#d4af6a] border-b border-[#2a3852] pb-1 mb-2 mt-4`,
    bullet: "list-disc marker:text-[#d4af6a]",
    ruleColor: "rgba(212,175,106,0.28)",
  },
  slate: {
    label: "Slate",
    dark: true,
    page: `${FONT.inter} bg-[#1f2430] text-[#e2e6ee]`,
    name: "text-[26px] font-extrabold tracking-tight text-white",
    headline: "text-[13px] font-semibold text-[#4fd1c5] mt-0.5",
    contactRow: "justify-start",
    subtle: "text-[#98a1b3]",
    sectionTitle:
      "text-[11px] font-bold uppercase tracking-widest text-[#4fd1c5] border-b border-[#343b4a] pb-1 mb-2 mt-4",
    bullet: "list-disc marker:text-[#4fd1c5]",
    ruleColor: "rgba(79,209,197,0.24)",
  },
};

/** Template id → picker metadata (label + dark flag). */
export const CV_TEMPLATE_META: Record<CvTemplate, { label: string; dark: boolean }> =
  Object.fromEntries(
    (Object.keys(TEMPLATE_STYLES) as CvTemplate[]).map((t) => [
      t,
      { label: TEMPLATE_STYLES[t].label, dark: TEMPLATE_STYLES[t].dark },
    ])
  ) as Record<CvTemplate, { label: string; dark: boolean }>;

export function CvRenderer({
  cv,
  template,
  editable = false,
  split = false,
  onChange,
}: {
  cv: TailoredCv;
  template: CvTemplate;
  editable?: boolean;
  /** Two-column body layout (screen comparison view). */
  split?: boolean;
  onChange?: (next: TailoredCv) => void;
}) {
  const s = TEMPLATE_STYLES[template] ?? TEMPLATE_STYLES.classic;

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

  // Each section stays whole in split view so a column can only begin with a
  // section heading, never a paragraph continued from the previous column.
  const blockCls = split ? "break-inside-avoid" : "";

  return (
    <div
      id="cv-page"
      className={`cv-page mx-auto flex flex-col px-12 py-10 text-[11px] leading-normal shadow-sm ${s.page}`}
      style={{ width: "210mm", minHeight: "297mm" }}
    >
      {/* Full-width header — spans the page even in split view */}
      <Editable
        as="h1"
        className={s.name}
        value={cv.contact.fullName}
        editable={editable}
        onCommit={(v) => commit((d) => void (d.contact.fullName = v))}
      />
      {cv.headline && (
        <Editable
          as="p"
          className={s.headline}
          value={cv.headline}
          editable={editable}
          onCommit={(v) => commit((d) => void (d.headline = v))}
        />
      )}
      <div
        className={`mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] ${s.subtle} ${s.contactRow}`}
      >
        {contactBits.map((bit, i) => (
          <span key={i}>{bit}</span>
        ))}
      </div>

      {cv.summary && (
        <div className="mt-1">
          <h2 className={s.sectionTitle}>Summary</h2>
          <Editable
            as="p"
            value={cv.summary}
            editable={editable}
            onCommit={(v) => commit((d) => void (d.summary = v))}
          />
        </div>
      )}

      {/* Body — in split view two balanced columns, kept in the exported PDF
          too. Otherwise a single column that grows (flex-1) and spreads its
          sections (justify-between) so the page is filled top-to-bottom
          instead of leaving a large blank strip at the foot of the sheet. */}
      <div
        className={
          split
            ? "mt-1 gap-x-10 [column-count:2]"
            : "mt-2 flex flex-1 flex-col justify-between"
        }
        style={split ? { columnRule: `1px solid ${s.ruleColor}` } : undefined}
      >
        {cv.sections.map((section, si) => (
          <div key={section.id} className={blockCls}>
            <Editable
              as="h2"
              className={s.sectionTitle}
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
                          className={s.subtle}
                          value={item.secondary}
                          editable={editable}
                          onCommit={(v) =>
                            commit(
                              (d) => void (d.sections[si].items[ii].secondary = v)
                            )
                          }
                        />
                      </>
                    )}
                  </div>
                  {item.meta && (
                    <Editable
                      className={`shrink-0 text-[10px] ${s.subtle}`}
                      value={item.meta}
                      editable={editable}
                      onCommit={(v) =>
                        commit((d) => void (d.sections[si].items[ii].meta = v))
                      }
                    />
                  )}
                </div>
                {item.bullets.length > 0 && (
                  <ul className={`ml-4 mt-0.5 space-y-0.5 ${s.bullet}`}>
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
        ))}

        {cv.skills.length > 0 && (
          <div className={blockCls}>
            <h2 className={s.sectionTitle}>Skills</h2>
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
        )}
      </div>
    </div>
  );
}
