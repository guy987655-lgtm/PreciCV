import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ExportPrefsSchema } from "@/lib/export-prefs";

/**
 * Applies one design to every generated document in a run.
 *
 * The batch download prints each job from its own stored `generations` row
 * (template, cv_theme, split_view), so a design chosen on the run page has to
 * reach those rows or the saved PDFs keep the old look. Doing it here rather
 * than with one PATCH /api/generations/[id] per job keeps it to a single
 * request, and lets ownership be checked once against the batch.
 *
 * Samples are skipped: they are watermarked previews with no file to restyle,
 * and PATCH /api/generations/[id] refuses them for the same reason.
 *
 * `hideAiSection` is accepted by the shared schema but deliberately ignored —
 * it lives inside each CV's own `hiddenSectionIds`, not in a column, and
 * rewriting stored CV JSON is not what picking a design should do.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = ExportPrefsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { template, cvTheme, splitView } = parsed.data;

  const updates: Record<string, unknown> = {};
  if (template !== undefined) updates.template = template;
  if (cvTheme !== undefined) updates.cv_theme = cvTheme;
  if (splitView !== undefined) updates.split_view = splitView;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // `batch_id` is the run grouping key; the column kept its original name.
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id")
    .eq("user_id", user.id)
    .eq("batch_id", id)
    .is("deleted_at", null);
  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("generations")
    .update(updates)
    .eq("user_id", user.id)
    .eq("revision_number", 0)
    .eq("is_sample", false)
    .in(
      "job_id",
      jobs.map((j) => j.id)
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
