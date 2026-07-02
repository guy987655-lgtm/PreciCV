import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { generateTailoredCv } from "@/lib/anthropic";
import { cosineSimilarity } from "@/lib/similarity";
import {
  JD_SIMILARITY_THRESHOLD,
  MasterProfileSchema,
  TailoredCvSchema,
  TIERS,
} from "@/lib/types";

export const maxDuration = 300;

const BodySchema = z.object({
  jobId: z.string().uuid(),
  instructions: z.string().min(3).max(2000),
  /** Optional JD update — must pass the cosine-similarity anti-fraud check. */
  updatedJdText: z.string().optional(),
});

/**
 * Premium-only AI revisions (PRD §6): up to 10 revisions locked to the
 * original job_id. A changed JD must be >85% cosine-similar to the
 * original to prevent tailoring for a different job on the same credit.
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
  const { jobId, instructions, updatedJdText } = parsed.data;

  const { data: job } = await supabase
    .from("jobs")
    .select("id, jd_text")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .single();
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { data: purchase } = await supabase
    .from("purchases")
    .select("id, tier, revisions_used, status")
    .eq("job_id", jobId)
    .eq("user_id", user.id)
    .eq("status", "paid")
    .maybeSingle();
  if (!purchase) {
    return NextResponse.json({ error: "payment_required" }, { status: 402 });
  }
  if (purchase.tier !== "premium") {
    return NextResponse.json(
      { error: "AI revisions require the Premium tier" },
      { status: 403 }
    );
  }
  const maxRevisions = TIERS.premium.maxRevisions;
  if ((purchase.revisions_used ?? 0) >= maxRevisions) {
    return NextResponse.json(
      { error: `All ${maxRevisions} revisions for this job have been used` },
      { status: 403 }
    );
  }

  // Anti-fraud: JD updates must stay locked to the same job.
  let jdText = job.jd_text as string;
  if (updatedJdText && updatedJdText.trim() !== jdText.trim()) {
    const similarity = cosineSimilarity(jdText, updatedJdText);
    if (similarity < JD_SIMILARITY_THRESHOLD) {
      return NextResponse.json(
        {
          error: "jd_mismatch",
          message:
            `The updated job description is only ${(similarity * 100).toFixed(0)}% ` +
            `similar to the original (minimum ${JD_SIMILARITY_THRESHOLD * 100}%). ` +
            `Revisions are locked to the original job — create a new job for a different position.`,
        },
        { status: 422 }
      );
    }
    jdText = updatedJdText;
    await supabase.from("jobs").update({ jd_text: jdText }).eq("id", jobId);
  }

  const { data: latest } = await supabase
    .from("generations")
    .select("cv, revision_number")
    .eq("job_id", jobId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .single();
  if (!latest) {
    return NextResponse.json(
      { error: "Generate the initial CV first" },
      { status: 400 }
    );
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("master_data")
    .eq("user_id", user.id)
    .single();
  const profile = MasterProfileSchema.parse(profileRow?.master_data ?? {});
  const previousCv = TailoredCvSchema.parse(latest.cv);

  const result = await generateTailoredCv(profile, jdText, {
    revisionInstructions: instructions,
    previousCv,
  });

  const revisionNumber = (latest.revision_number as number) + 1;
  const { data: generation, error } = await supabase
    .from("generations")
    .insert({
      job_id: jobId,
      user_id: user.id,
      cv: result.cv,
      diff: result.diff,
      revision_number: revisionNumber,
      template: "classic",
    })
    .select("id")
    .single();
  if (error || !generation) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to store revision" },
      { status: 500 }
    );
  }

  await supabase
    .from("purchases")
    .update({ revisions_used: (purchase.revisions_used ?? 0) + 1 })
    .eq("id", purchase.id);

  return NextResponse.json({
    generationId: generation.id,
    revisionNumber,
    revisionsRemaining: maxRevisions - revisionNumber,
    ...result,
  });
}
