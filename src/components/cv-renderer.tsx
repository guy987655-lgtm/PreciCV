"use client";

import { CvTemplate, TailoredCv } from "@/lib/types";

/**
 * Renders a TailoredCv in one of 3 ATS-friendly templates (PRD §4.4
 * fallback templates) and supports WYSIWYG inline editing (PRD §5.1):
 * every text node is contentEditable; edits commit on blur with zero
 * API calls or credits.
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

const TEMPLATE_STYLES: Record<
  CvTemplate,
  {
    page: string;
    name: string;
    headline: string;
    contactRow: string;
    sectionTitle: string;
    bullet: string;
  }
> = {
  classic: {
    page: "font-serif text-slate-900",
    name: "text-center text-2xl font-bold tracking-wide",
    headline: "text-center text-sm text-slate-600 mt-0.5",
    contactRow: "justify-center",
    sectionTitle:
      "text-[11px] font-bold uppercase tracking-[0.15em] border-b border-slate-400 pb-0.5 mb-1.5 mt-3",
    bullet: "list-disc",
  },
  modern: {
    page: "font-sans text-slate-900",
    name: "text-2xl font-extrabold text-indigo-900",
    headline: "text-sm font-medium text-indigo-600 mt-0.5",
    contactRow: "justify-start",
    sectionTitle:
      "text-[11px] font-bold uppercase tracking-widest text-indigo-700 border-b-2 border-indigo-200 pb-0.5 mb-1.5 mt-3",
    bullet: "list-disc marker:text-indigo-400",
  },
  compact: {
    page: "font-sans text-slate-900 text-[10.5px] leading-snug",
    name: "text-xl font-bold",
    headline: "text-xs text-slate-600",
    contactRow: "justify-start",
    sectionTitle:
      "text-[10px] font-bold uppercase tracking-wider bg-slate-100 px-1.5 py-0.5 mb-1 mt-2.5",
    bullet: "list-[square]",
  },
};

export function CvRenderer({
  cv,
  template,
  editable = false,
  onChange,
}: {
  cv: TailoredCv;
  template: CvTemplate;
  editable?: boolean;
  onChange?: (next: TailoredCv) => void;
}) {
  const s = TEMPLATE_STYLES[template];

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

  return (
    <div
      id="cv-page"
      className={`cv-page mx-auto bg-white px-10 py-8 text-[11px] leading-normal shadow-sm ${s.page}`}
      style={{ width: "210mm", minHeight: "297mm" }}
    >
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
        className={`mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-600 ${s.contactRow}`}
      >
        {contactBits.map((bit, i) => (
          <span key={i}>{bit}</span>
        ))}
      </div>

      {cv.summary && (
        <>
          <h2 className={s.sectionTitle}>Summary</h2>
          <Editable
            as="p"
            value={cv.summary}
            editable={editable}
            onCommit={(v) => commit((d) => void (d.summary = v))}
          />
        </>
      )}

      {cv.sections.map((section, si) => (
        <div key={section.id}>
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
                        className="text-slate-700"
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
                    className="shrink-0 text-[10px] text-slate-500"
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
        <>
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
        </>
      )}
    </div>
  );
}
