"use client";

import { useMemo } from "react";
import { CvTemplate, CV_TEMPLATES } from "@/lib/types";
import { CV_TEMPLATE_INFO, recommendTemplates } from "@/lib/templates";
import { CV_TEMPLATE_META } from "@/components/cv-renderer";

/**
 * The 3-row CV design catalog shared by both surfaces:
 *   1. "Recommended for you" — JD-driven (recommendTemplates heuristic);
 *   2. "Classic & traditional" — the classic style family;
 *   3. "Modern & creative" — the modern style family.
 * Token-driven so it renders identically in the funnel and the workspace.
 */
export function TemplateCatalog({
  template,
  onSelect,
  jdText = "",
}: {
  template: CvTemplate;
  onSelect: (t: CvTemplate) => void;
  jdText?: string;
}) {
  const recommended = useMemo(() => recommendTemplates(jdText, 4), [jdText]);
  const classic = CV_TEMPLATES.filter(
    (t) => CV_TEMPLATE_INFO[t].category === "classic"
  );
  const modern = CV_TEMPLATES.filter(
    (t) => CV_TEMPLATE_INFO[t].category === "modern"
  );

  return (
    <div className="flex flex-col gap-3">
      <CatalogRow
        title="Recommended for you"
        hint="Matched to this job"
        templates={recommended}
        active={template}
        onSelect={onSelect}
      />
      <CatalogRow
        title="Classic & traditional"
        templates={classic}
        active={template}
        onSelect={onSelect}
      />
      <CatalogRow
        title="Modern & creative"
        templates={modern}
        active={template}
        onSelect={onSelect}
      />
    </div>
  );
}

function CatalogRow({
  title,
  hint,
  templates,
  active,
  onSelect,
}: {
  title: string;
  hint?: string;
  templates: CvTemplate[];
  active: CvTemplate;
  onSelect: (t: CvTemplate) => void;
}) {
  if (templates.length === 0) return null;
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <p className="text-xs font-semibold text-ink-faint">{title}</p>
        {hint && <span className="text-[10px] text-ink-faint">· {hint}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {templates.map((t) => {
          const isActive = active === t;
          return (
            <button
              key={t}
              onClick={() => onSelect(t)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                isActive
                  ? "border-ink bg-ink text-bg"
                  : "border-border bg-card text-ink-soft hover:bg-chip"
              }`}
            >
              {CV_TEMPLATE_META[t].label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
