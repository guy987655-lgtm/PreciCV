import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  generateTailoredCv,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";
import { MasterProfileSchema } from "@/lib/types";

export const maxDuration = 300;

const BodySchema = z.object({
  jobId: z.string().uuid(),
  /** User explicitly acknowledged dealbreaker warnings (PRD §4.3 modal). */
  acknowledgeRedFlags: z.boolean().optional().default(false),
  /** Use the one-time free sample instead of a paid credit. */
  useFreeSample: z.boolean().optional().default(false),
});

/**
 * The heavy tailoring call. Requires a paid purchase for this job_id, OR
 * the user's one-time free sample (result is watermarked + locked).
 * If a sample generation already exists and the job is now paid, the
 * sample is unlocked in place — no extra LLM call.
 */
export async function POST(request: Request) {
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

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { jobId, acknowledgeRedFlags, useFreeSample } = parsed.data;

  const { data: job } = await supabase
    .from("jobs")
    .select("id, jd_text, dealbreaker_hits, status")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .single();
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { data: purchase } = await supabase
    .from("purchases")
    .select("id, tier, status")
    .eq("job_id", jobId)
    .eq("user_id", user.id)
    .eq("status", "paid")
    .maybeSingle();

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("master_data, free_sample_used")
    .eq("user_id", user.id)
    .single();

  // Entitlement: paid purchase, or the one-time free sample.
  const asSample = !purchase;
  if (asSample) {
    if (!useFreeSample) {
      return NextResponse.json({ error: "payment_required" }, { status: 402 });
    }
    if (profileRow?.free_sample_used) {
      return NextResponse.json(
        { error: "free_sample_used", message: "Your one-time free sample was already used." },
        { status: 403 }
      );
    }
  }

  const hits = (job.dealbreaker_hits as unknown[]) ?? [];
  if (hits.length > 0 && !acknowledgeRedFlags) {
    return NextResponse.json(
      { error: "red_flags_unacknowledged", hits },
      { status: 409 }
    );
  }

  const { data: existing } = await supabase
    .from("generations")
    .select("id, cv, diff, is_sample, template")
    .eq("job_id", jobId)
    .eq("revision_number", 0)
    .maybeSingle();
  if (existing) {
    // Paid now + sample exists → unlock in place, no LLM call.
    if (existing.is_sample && purchase) {
      await supabase
        .from("generations")
        .update({ is_sample: false })
        .eq("id", existing.id);
      return NextResponse.json({
        generationId: existing.id,
        cv: existing.cv,
        diff: existing.diff,
        isSample: false,
        unlocked: true,
      });
    }
    return NextResponse.json(
      { error: "This job already has a generated CV" },
      { status: 409 }
    );
  }

  const profile = MasterProfileSchema.parse(profileRow?.master_data ?? {});
  const result = await generateTailoredCv(profile, job.jd_text);

  const { data: generation, error } = await supabase
    .from("generations")
    .insert({
      job_id: jobId,
      user_id: user.id,
      cv: result.cv,
      diff: result.diff,
      simulation: result.simulation,
      revision_number: 0,
      template: "classic",
      is_sample: asSample,
    })
    .select("id")
    .single();
  if (error || !generation) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to store generation" },
      { status: 500 }
    );
  }

  if (asSample) {
    await supabase
      .from("profiles")
      .update({ free_sample_used: true })
      .eq("user_id", user.id);
  }

  await supabase
    .from("jobs")
    .update({
      status: "generated",
      title: result.jobTitle || null,
      company: result.company || null,
    })
    .eq("id", jobId);

  return NextResponse.json({
    generationId: generation.id,
    isSample: asSample,
    ...result,
  });
}
