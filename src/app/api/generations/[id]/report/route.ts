import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  MasterProfileSchema,
  TailoredCvSchema,
  MAX_REPORT_REGENS,
} from "@/lib/types";
import {
  regenerateReport,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";

export const maxDuration = 300;

/**
 * Paid workspace: rebuilds the change report + interview simulation around the
 * generation's (already inline-edited) CV, persisting diff + simulation and
 * clearing report_stale. Job-scoped quota of MAX_REPORT_REGENS per flow.
 */
export async function POST(
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
  if (!llmConfigured()) {
    return NextResponse.json({ error: LLM_NOT_CONFIGURED_MSG }, { status: 503 });
  }

  const { data: gen } = await supabase
    .from("generations")
    .select("id, job_id, cv, is_sample")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!gen) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (gen.is_sample) {
    return NextResponse.json(
      { error: "Samples are locked. Purchase the job to unlock." },
      { status: 403 }
    );
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("jd_text")
    .eq("id", gen.job_id)
    .eq("user_id", user.id)
    .single();
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { data: purchase } = await supabase
    .from("purchases")
    .select("id, report_regens_used, status")
    .eq("job_id", gen.job_id)
    .eq("user_id", user.id)
    .eq("status", "paid")
    .maybeSingle();
  if (!purchase) {
    return NextResponse.json({ error: "payment_required" }, { status: 402 });
  }
  const used = purchase.report_regens_used ?? 0;
  if (used >= MAX_REPORT_REGENS) {
    return NextResponse.json(
      { error: `All ${MAX_REPORT_REGENS} report regenerations have been used` },
      { status: 403 }
    );
  }

  // The original AI CV (revision 0) grounds the diff, and the user's master
  // profile is the Change Report's original-resume base (§2.4).
  const { data: base } = await supabase
    .from("generations")
    .select("cv")
    .eq("job_id", gen.job_id)
    .order("revision_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("master_data")
    .eq("user_id", user.id)
    .maybeSingle();

  try {
    const finalCv = TailoredCvSchema.parse(gen.cv);
    const baseCv = base ? TailoredCvSchema.parse(base.cv) : undefined;
    const profile = profileRow?.master_data
      ? MasterProfileSchema.parse(profileRow.master_data)
      : undefined;
    // §2.4 trace — confirms the EDITED (persisted) CV is what we regenerate on.
    console.log(
      `[report-regen] gen=${id} payload: sections=${finalCv.sections.length} ` +
        `chars=${JSON.stringify(finalCv).length}`
    );
    const report = await regenerateReport(finalCv, job.jd_text as string, {
      baseCv,
      profile,
    });

    await supabase
      .from("generations")
      .update({
        diff: report.diff,
        simulation: report.simulation,
        report_stale: false,
      })
      .eq("id", id)
      .eq("user_id", user.id);
    await supabase
      .from("purchases")
      .update({ report_regens_used: used + 1 })
      .eq("id", purchase.id);

    return NextResponse.json({
      ...report,
      regensUsed: used + 1,
      regensRemaining: MAX_REPORT_REGENS - used - 1,
    });
  } catch (e) {
    console.error("report regeneration failed:", e);
    return NextResponse.json(
      { error: "Report regeneration failed. Please try again in a moment." },
      { status: 502 }
    );
  }
}
