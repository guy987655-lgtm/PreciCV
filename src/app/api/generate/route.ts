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
import { applyAiSectionPref, asCvTheme } from "@/lib/export-prefs";
import { FreeQuota, freeLimitResponse, readFreeQuota } from "@/lib/free-quota";

export const maxDuration = 300;

const BodySchema = z.object({
  jobId: z.string().uuid(),
  /** User explicitly acknowledged dealbreaker warnings (PRD §4.3 modal). */
  acknowledgeRedFlags: z.boolean().optional().default(false),
  /** Use this job's free sample instead of a paid credit. */
  useFreeSample: z.boolean().optional().default(false),
  /** Arrived from checkout — softens the daily-cap copy while the webhook lands. */
  justPaid: z.boolean().optional().default(false),
});

/**
 * The heavy tailoring call. Requires a paid purchase for this job_id, OR
 * this job's free sample (one per job; result is watermarked + locked).
 * If a sample generation already exists and the job is now paid, the
 * sample is unlocked in place — no extra LLM call.
 *
 * Free samples are additionally capped per DAY across the whole account (see
 * src/lib/free-quota.ts): the per-job sample had no account-wide ceiling, so
 * adding jobs was an unlimited supply of free generations.
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
  const { jobId, acknowledgeRedFlags, useFreeSample, justPaid } = parsed.data;

  const { data: job } = await supabase
    .from("jobs")
    .select("id, jd_text, dealbreaker_hits, status, title, company")
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
    .select(
      "master_data, default_template, cv_theme, split_view, hide_ai_section"
    )
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
    .select("id, cv, diff, simulation, is_sample, template, cv_theme, split_view")
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
        template: existing.template ?? DEFAULT_TEMPLATE,
        // Returned so the paid unlock restores the same VIEW, not just the
        // same document — the client holds theme and split in their own state.
        cvTheme: asCvTheme(existing.cv_theme) ?? "light",
        splitView: Boolean(existing.split_view),
        jobTitle: jobMeta?.title ?? "",
        company: jobMeta?.company ?? "",
        isSample: false,
        unlocked: true,
      });
    }
    /**
     * Nothing has been written and no LLM call has been made at this point, so
     * this attempt costs the user nothing — which is exactly what they cannot
     * tell from a bare sentence. The code lets the client offer the only real
     * way forward (a fresh revision via /api/revise) instead of a Retry button
     * that can only fail the same way.
     */
    return NextResponse.json(
      {
        error: "already_generated",
        generationId: existing.id,
        isSample: Boolean(existing.is_sample),
        message:
          "This job already has a generated CV — no credit was charged for this attempt.",
      },
      { status: 409 }
    );
  }

  /**
   * Account-wide daily cap on FREE generations. `asSample` is false whenever a
   * paid purchase exists, so a match/full generation is never touched by this.
   *
   * Deliberately after the `existing` block: the paid unlock-in-place path and
   * the "already generated" 409 must stay reachable for a user who happens to
   * be at their limit — neither creates anything new. Nothing has been written
   * at this point either, so refusing here costs the user nothing.
   */
  let quota: FreeQuota | null = null;
  if (asSample) {
    quota = await readFreeQuota(supabase, user.id);
    if (!quota.allowed) return freeLimitResponse(quota, { justPaid });
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
   * Re-check right before the insert. This does not make the cap race-free, it
   * shrinks the window from the ~90s the LLM call takes down to one query —
   * which is what matters, because the workspace AUTO-RUNS generation on
   * arrival, so "open five job tabs" is ordinary user behaviour rather than an
   * attack. A ±1 overshoot is accepted deliberately: serializing this with an
   * advisory lock could hard-fail an insert after the LLM had already been paid
   * for, which is a worse outcome than one extra free CV.
   */
  if (asSample) {
    quota = await readFreeQuota(supabase, user.id);
    if (!quota.allowed) return freeLimitResponse(quota, { justPaid });
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

  /**
   * The rest of the user's saved export configuration. Unlike the design,
   * none of these is gated on the tier: sampleUnlockedTemplates restricts
   * which DESIGNS a free sample may show, while the theme, the split layout
   * and hiding the AI section are free on every tier.
   */
  const startingTheme = asCvTheme(profileRow?.cv_theme) ?? "light";
  const startingSplit = Boolean(profileRow?.split_view);
  const startingCv = applyAiSectionPref(
    result.cv,
    Boolean(profileRow?.hide_ai_section)
  );

  const { data: generation, error } = await supabase
    .from("generations")
    .insert({
      job_id: jobId,
      user_id: user.id,
      cv: startingCv,
      diff: result.diff,
      simulation: result.simulation,
      revision_number: 0,
      // Open in the design the user last downloaded — this used to be
      // hardcoded, so a returning user had to reselect their design every time.
      template: startingTemplate,
      cv_theme: startingTheme,
      split_view: startingSplit,
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

  /**
   * A name already on the job WINS over this run's extraction.
   *
   * This used to write `result.company || null` unconditionally, which meant a
   * posting the tailoring pass read as anonymous NULLed a company name that
   * was already known — and the export filenames are built from that name. The
   * homepage makes the name mandatory and user-confirmable before any credit
   * is spent, so overwriting it here would silently discard what the user
   * typed. Generation still fills either field in when it was empty.
   */
  await supabase
    .from("jobs")
    .update({
      status: "generated",
      title: job.title || result.jobTitle || null,
      company: job.company || result.company || null,
    })
    .eq("id", jobId);

  return NextResponse.json({
    generationId: generation.id,
    isSample: asSample,
    ...result,
    /**
     * The seeded view, so the client opens in it WITHOUT a reload.
     * GenerationResult carries no template/theme/split, so the client's
     * `data.template ?? …` always fell through to "classic" and the saved
     * design was invisible until the page was hard-reloaded.
     *
     * `cv` must stay after `...result` — the spread would otherwise put the
     * un-hidden CV back over the one we just stored.
     */
    cv: startingCv,
    template: startingTemplate,
    cvTheme: startingTheme,
    splitView: startingSplit,
    /** Free generations left AFTER this one; null when it wasn't a free one. */
    freeRemaining: quota ? Math.max(0, quota.remaining - 1) : null,
  });
}
