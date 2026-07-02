import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { generateTailoredCv } from "@/lib/anthropic";
import { MasterProfileSchema } from "@/lib/types";

export const maxDuration = 300;

const BodySchema = z.object({
  jobId: z.string().uuid(),
  /** User explicitly acknowledged dealbreaker warnings (PRD §4.3 modal). */
  acknowledgeRedFlags: z.boolean().optional().default(false),
});

/**
 * The heavy tailoring call. Requires a paid purchase for this job_id.
 * If unresolved dealbreaker hits exist, the client must send
 * acknowledgeRedFlags=true ("Are you sure you want to spend a credit?").
 */
export async function POST(request: Request) {
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
  const { jobId, acknowledgeRedFlags } = parsed.data;

  const { data: job } = await supabase
    .from("jobs")
    .select("id, jd_text, dealbreaker_hits, status")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .single();
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const hits = (job.dealbreaker_hits as unknown[]) ?? [];
  if (hits.length > 0 && !acknowledgeRedFlags) {
    return NextResponse.json(
      { error: "red_flags_unacknowledged", hits },
      { status: 409 }
    );
  }

  // Credit check: one generation per paid job.
  const { data: purchase } = await supabase
    .from("purchases")
    .select("id, tier, status")
    .eq("job_id", jobId)
    .eq("user_id", user.id)
    .eq("status", "paid")
    .maybeSingle();
  if (!purchase) {
    return NextResponse.json({ error: "payment_required" }, { status: 402 });
  }

  const { data: existing } = await supabase
    .from("generations")
    .select("id")
    .eq("job_id", jobId)
    .eq("revision_number", 0)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "This job already has a generated CV" },
      { status: 409 }
    );
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("master_data")
    .eq("user_id", user.id)
    .single();
  const profile = MasterProfileSchema.parse(profileRow?.master_data ?? {});

  const result = await generateTailoredCv(profile, job.jd_text);

  const { data: generation, error } = await supabase
    .from("generations")
    .insert({
      job_id: jobId,
      user_id: user.id,
      cv: result.cv,
      diff: result.diff,
      revision_number: 0,
      template: "classic",
    })
    .select("id")
    .single();
  if (error || !generation) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to store generation" },
      { status: 500 }
    );
  }

  await supabase
    .from("jobs")
    .update({
      status: "generated",
      title: result.jobTitle || null,
      company: result.company || null,
    })
    .eq("id", jobId);

  return NextResponse.json({ generationId: generation.id, ...result });
}
