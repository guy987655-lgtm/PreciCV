import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CV_TEMPLATES } from "@/lib/types";
import { ExportPrefsSchema, asCvTheme } from "@/lib/export-prefs";

/**
 * Account-level preferences the funnel needs the moment it mounts: the export
 * configuration the user last downloaded with, and whether they have a base CV
 * on file.
 *
 * One route for both because the landing page needs both at the same instant
 * (on hydrate) — splitting them would cost a second round trip on the page
 * users see first.
 */

const BodySchema = z.object({
  /**
   * Legacy alias for `export.template`. Kept because a client loaded before
   * this deploy still sends only this field.
   */
  defaultTemplate: z.enum(CV_TEMPLATES).optional(),
  export: ExportPrefsSchema.optional(),
  /** null forgets the saved CV; an object replaces it. */
  baseCv: z
    .object({
      rawText: z.string().min(1).max(200_000),
      fileName: z.string().min(1).max(255),
    })
    .nullable()
    .optional(),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "default_template, cv_theme, split_view, hide_ai_section, cv_file_name, cv_uploaded_at, raw_cv_text"
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A saved CV is only offerable when its TEXT survived — the file name alone
  // would render a card that cannot actually be analyzed.
  const hasText = Boolean(data?.raw_cv_text?.trim());
  return NextResponse.json({
    // Additive: `defaultTemplate` stays at the top level for clients loaded
    // before `export` existed.
    defaultTemplate: data?.default_template ?? null,
    export: {
      template: data?.default_template ?? null,
      cvTheme: asCvTheme(data?.cv_theme) ?? "light",
      splitView: Boolean(data?.split_view),
      hideAiSection: Boolean(data?.hide_ai_section),
    },
    baseCv: hasText
      ? {
          fileName: data?.cv_file_name ?? "Your CV",
          uploadedAt: data?.cv_uploaded_at ?? null,
        }
      : null,
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { defaultTemplate, baseCv } = parsed.data;

  const patch: Record<string, unknown> = {};
  // The legacy top-level field is just the template; an explicit `export`
  // block wins over it.
  const exp = {
    ...(defaultTemplate ? { template: defaultTemplate } : {}),
    ...(parsed.data.export ?? {}),
  };
  // Compared against undefined rather than tested for truthiness: `if
  // (exp.splitView)` would never persist `false`, making both toggles
  // one-way — on could be saved, off could not.
  if (exp.template !== undefined) patch.default_template = exp.template;
  if (exp.cvTheme !== undefined) patch.cv_theme = exp.cvTheme;
  if (exp.splitView !== undefined) patch.split_view = exp.splitView;
  if (exp.hideAiSection !== undefined) patch.hide_ai_section = exp.hideAiSection;
  if (baseCv === null) {
    patch.raw_cv_text = null;
    patch.cv_file_name = null;
    patch.cv_uploaded_at = null;
  } else if (baseCv) {
    patch.raw_cv_text = baseCv.rawText;
    patch.cv_file_name = baseCv.fileName;
    patch.cv_uploaded_at = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true });
  }

  // Upsert, not update: a user who came through the anonymous funnel and
  // signed up may not have a profiles row until /api/try/import runs.
  const { error } = await supabase
    .from("profiles")
    .upsert(
      { user_id: user.id, email: user.email, ...patch },
      { onConflict: "user_id" }
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
