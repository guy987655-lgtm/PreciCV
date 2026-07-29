import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { llmFailureResponse } from "@/lib/api-errors";
import {
  generateTailoredCv,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";
import { MasterProfileSchema } from "@/lib/types";
import {
  DEFAULT_TEMPLATE,
  asTemplate,
  recommendTemplates,
  sampleUnlockedTemplates,
} from "@/lib/templates";

export const maxDuration = 300;

const BodySchema = z.object({
  jobId: z.string().uuid(),
  /** User explicitly acknowledged dealbreaker warnings (PRD §4.3 modal). */
  acknowledgeRedFlags: z.boolean().optional().default(false),
  /** Use this job's free sample instead of a paid credit. */
  useFreeSample: z.boolean().optional().default(false),
});

/**
 * The heavy tailoring call. Requires a paid purchase for this job_id, OR
 * this job's free sample (one per job; result is watermarked + locked).
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

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("master_data, default_template")
    .eq("user_id", user.id)
    .single();

  // Entitlement: paid purchase, or this job's free sample. The sample is one
  // PER JOB, so there is no account-wide check here — the "already generated"
  // guard below (one revision-0 row per job) is what limits it to one.
  const asSample = !purchase;
  if (asSample && !useFreeSample) {
    return NextResponse.json({ error: "payment_required" }, { status: 402 });
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
    .select("id, cv, diff, simulation, is_sample, template")
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
      const { data: jobMeta } = await supabase
        .from("jobs")
        .select("title, company")
        .eq("id", jobId)
        .maybeSingle();
      return NextResponse.json({
        generationId: existing.id,
        cv: existing.cv,
        diff: existing.diff,
        // The simulation is persisted with every generation and MUST come
        // back on this path too: the client mounts the printable report only
        // when it holds one, so omitting it here exported an empty report
        // file until the user happened to reload the page.
        simulation: existing.simulation ?? { pitch: "", questions: [] },
        template: existing.template ?? "classic",
        jobTitle: jobMeta?.title ?? "",
        company: jobMeta?.company ?? "",
        isSample: false,
        unlocked: true,
      });
    }
    return NextResponse.json(
      { error: "This job already has a generated CV" },
      { status: 409 }
    );
  }

  /**
   * A profile that failed to LOAD must never fall through to an empty one:
   * every field of MasterProfileSchema has a default, so `{}` parses happily
   * and generation would spend the user's credit tailoring a blank CV. The
   * validation check below cannot catch that — it only sees valid output.
   */
  if (profileError || !profileRow) {
    console.error("[api/generate] could not load profile:", profileError);
    return NextResponse.json(
      { error: "We could not load your profile. Please try again in a moment." },
      { status: 503 }
    );
  }

  const profileParsed = MasterProfileSchema.safeParse(
    profileRow?.master_data ?? {}
  );
  if (!profileParsed.success) {
    console.error(
      "[api/generate] stored profile failed validation:",
      profileParsed.error
    );
    return NextResponse.json(
      {
        error:
          "We could not read your saved profile. Re-upload your CV and try again.",
      },
      { status: 422 }
    );
  }

  let result: Awaited<ReturnType<typeof generateTailoredCv>>;
  try {
    result = await generateTailoredCv(profileParsed.data, job.jd_text);
  } catch (e) {
    // A failed run must not consume the job's free sample, and it does not:
    // nothing is written before this point.
    return llmFailureResponse("api/generate", e);
  }

  /**
   * The user's saved design, unless this is a free sample that may not show
   * it: samples unlock only six designs (sampleUnlockedTemplates), so a saved
   * default outside that set would open the catalog on a locked, disabled chip.
   */
  const preferred = asTemplate(profileRow?.default_template) ?? DEFAULT_TEMPLATE;
  const startingTemplate =
    asSample &&
    !sampleUnlockedTemplates(recommendTemplates(job.jd_text, 4)).has(preferred)
      ? DEFAULT_TEMPLATE
      : preferred;

  const { data: generation, error } = await supabase
    .from("generations")
    .insert({
      job_id: jobId,
      user_id: user.id,
      cv: result.cv,
      diff: result.diff,
      simulation: result.simulation,
      revision_number: 0,
      // Open in the design the user last downloaded — this used to be
      // hardcoded, so a returning user had to reselect their design every time.
      template: startingTemplate,
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
    // Informational only now that samples are per-job: marks that this user
    // has tasted the sample at least once (funnel analytics). Nothing gates
    // on it — kept so a lifetime cap could be reinstated without a backfill.
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
