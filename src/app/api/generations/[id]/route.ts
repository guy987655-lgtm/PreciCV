import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TailoredCvSchema, CV_TEMPLATES } from "@/lib/types";

/**
 * Saves manual inline edits from the Review Workspace (PRD §5.1).
 * Pure persistence — no LLM call, no credits.
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

  const { data: gen } = await supabase
    .from("generations")
    .select("is_sample")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!gen) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (gen.is_sample) {
    return NextResponse.json(
      { error: "Samples are locked. Purchase the job to unlock editing." },
      { status: 403 }
    );
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (body.cv !== undefined) {
    const parsed = TailoredCvSchema.safeParse(body.cv);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid CV payload" }, { status: 400 });
    }
    updates.cv = parsed.data;
    // Editing the CV desyncs the stored report until it is regenerated.
    updates.report_stale = true;
  }
  if (body.template !== undefined) {
    if (!CV_TEMPLATES.includes(body.template)) {
      return NextResponse.json({ error: "Unknown template" }, { status: 400 });
    }
    updates.template = body.template;
  }
  // View preferences persist with the generation, like template (Topic 3).
  if (body.cvTheme !== undefined) {
    if (!["light", "dark"].includes(body.cvTheme)) {
      return NextResponse.json({ error: "Unknown theme" }, { status: 400 });
    }
    updates.cv_theme = body.cvTheme;
  }
  if (body.splitView !== undefined) {
    if (typeof body.splitView !== "boolean") {
      return NextResponse.json({ error: "Invalid splitView" }, { status: 400 });
    }
    updates.split_view = body.splitView;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("generations")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
