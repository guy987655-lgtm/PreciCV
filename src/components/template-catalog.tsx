"use client";

import { useMemo } from "react";
import { CvTemplate, CV_TEMPLATES } from "@/lib/types";
import {
  CV_TEMPLATE_INFO,
  recommendTemplates,
  sampleUnlockedTemplates,
} from "@/lib/templates";
import { CV_TEMPLATE_META } from "@/components/cv-renderer";

/**
 * The 3-row CV design catalog shared by both surfaces:
 *   1. "Recommended for you" — JD-driven (recommendTemplates heuristic);
 *   2. "Classic & traditional" — the classic style family;
 *   3. "Modern & creative" — the modern style family.
 * Token-driven so it renders identically in the funnel and the workspace.
 *
 * With `sample`, only the free-sample subset (2 per row, six designs) can be
 * selected; the rest are shown locked, so the range is visible but paid.
 */
export function TemplateCatalog({
  template,
  onSelect,
  jdText = "",
  sample = false,
}: {
  template: CvTemplate;
  onSelect: (t: CvTemplate) => void;
  jdText?: string;
  sample?: boolean;
}) {
  const recommended = useMemo(() => recommendTemplates(jdText, 4), [jdText]);
  const classic = CV_TEMPLATES.filter(
    (t) => CV_TEMPLATE_INFO[t].category === "classic"
  );
  const modern = CV_TEMPLATES.filter(
    (t) => CV_TEMPLATE_INFO[t].category === "modern"
  );
  const unlocked = useMemo(
    () => (sample ? sampleUnlockedTemplates(recommended) : null),
    [sample, recommended]
  );

  return (
    <div className="flex flex-col gap-3">
      <CatalogRow
        title="Recommended for you"
        hint="Matched to this job"
        templates={recommended}
        active={template}
        onSelect={onSelect}
        unlocked={unlocked}
      />
      <CatalogRow
        title="Classic & traditional"
        templates={classic}
        active={template}
        onSelect={onSelect}
        unlocked={unlocked}
      />
      <CatalogRow
        title="Modern & creative"
        templates={modern}
        active={template}
        onSelect={onSelect}
        unlocked={unlocked}
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
  unlocked,
}: {
  title: string;
  hint?: string;
  templates: CvTemplate[];
  active: CvTemplate;
  onSelect: (t: CvTemplate) => void;
  /** null = every design is selectable (paid); otherwise the allowed set. */
  unlocked: Set<CvTemplate> | null;
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
          // The design currently on screen is never locked, so a sample can't
          // end up highlighting a chip its viewer isn't allowed to pick.
          const locked = unlocked ? !unlocked.has(t) && !isActive : false;
          return (
            <button
              key={t}
              disabled={locked}
              title={
                locked ? "Unlock the full version to use this design" : undefined
              }
              onClick={() => onSelect(t)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                isActive
                  ? "cursor-pointer border-ink bg-ink text-bg"
                  : locked
                    ? "cursor-not-allowed border-border bg-card text-ink-faint opacity-60"
                    : "cursor-pointer border-border bg-card text-ink-soft hover:bg-chip"
              }`}
            >
              {locked && <span aria-hidden>🔒</span>}
              {CV_TEMPLATE_META[t].label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
