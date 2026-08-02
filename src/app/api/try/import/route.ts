import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { scanDealbreakers } from "@/lib/llm";
import { DealbreakerSchema, MasterProfileSchema } from "@/lib/types";
import { MAX_PACK_SIZE } from "@/lib/packs";
import { MIN_JD_CHARS } from "@/lib/funnel";

export const maxDuration = 120;

const JobSchema = z.object({
  jdText: z.string().min(MIN_JD_CHARS, "Job description is too short"),
  /**
   * Every exported file is named after the hiring company, so a run with a
   * missing name would produce files the user cannot tell apart. The homepage
   * will not continue without it, and companyFromJd is the last-resort filler.
   */
  company: z.string().trim().max(120).default(""),
  title: z.string().trim().max(200).default(""),
});

const BodySchema = z.object({
  profile: MasterProfileSchema,
  rawText: z.string().default(""),
  answers: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
        /** Structure kept for MCQ answers so they can be replayed later. */
        kind: z.enum(["mcq", "open"]).default("open"),
        selected: z.array(z.string()).optional(),
        other: z.string().optional(),
        options: z.array(z.string()).optional(),
        selectType: z.enum(["single", "ranked"]).optional(),
        /** Category — My Card groups its filter chips by this. */
        topic: z.string().max(120).optional(),
      })
    )
    .default([]),
  jobs: z.array(JobSchema).max(MAX_PACK_SIZE).default([]),
  /** Pre-multi-job stash shape. Kept so a tab opened before the change
   *  still imports rather than losing the job the user pasted. */
  jdText: z.string().default(""),
  jobTitle: z.string().default(""),
  company: z.string().default(""),
});

/**
 * Completes the anonymous try-now flow right after signup: imports the profile
 * parsed before registration into the Master Data Lake and creates one job per
 * target the user added. Never overwrites an already-onboarded user's Master
 * Data Lake.
 *
 * Everything here happens BEFORE any credit is spent, on purpose — the
 * dealbreaker scan and the answer capture are the two things the user would be
 * angry to have paid for and then discovered. Generation is fanned out from
 * the client afterwards, one /api/generate call per job.
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
  const { profile, rawText, answers } = parsed.data;

  // Legacy single-job stash → the list shape everything below works on.
  const jobs =
    parsed.data.jobs.length > 0
      ? parsed.data.jobs
      : parsed.data.jdText.trim().length >= MIN_JD_CHARS
        ? [
            {
              jdText: parsed.data.jdText,
              company: parsed.data.company.trim(),
              title: parsed.data.jobTitle.trim(),
            },
          ]
        : [];

  const { data: existing } = await supabase
    .from("profiles")
    .select("onboarded, master_data, dealbreakers")
    .eq("user_id", user.id)
    .maybeSingle();

  const facts = answers
    .filter((a) => a.answer.trim().length > 0)
    .map((a) => `${a.question} — ${a.answer.trim()}`);

  if (!existing?.onboarded) {
    profile.additionalFacts = [...profile.additionalFacts, ...facts];

    const { error } = await supabase.from("profiles").upsert(
      {
        user_id: user.id,
        email: user.email,
        master_data: profile,
        raw_cv_text: rawText || null,
        dealbreakers: [],
        onboarded: true,
      },
      { onConflict: "user_id" }
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else if (facts.length > 0) {
    /**
     * Fold the answers into the profile the tailoring prompt reads.
     *
     * /api/generate builds every CV from profiles.master_data, so an answer
     * that only reached profile_answers below would be remembered for NEXT
     * time and ignored for the very jobs it was just given for. Deduped: a
     * returning user would otherwise accumulate the same fact once per run,
     * crowding the tailoring prompt.
     */
    const saved = MasterProfileSchema.safeParse(existing.master_data ?? {});
    if (saved.success) {
      const merged = {
        ...saved.data,
        additionalFacts: [...new Set([...saved.data.additionalFacts, ...facts])],
      };
      const { error } = await supabase
        .from("profiles")
        .update({ master_data: merged })
        .eq("user_id", user.id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
  }

  /**
   * One dealbreaker scan per job, in parallel. Skipped entirely when the user
   * has no dealbreakers configured — always true for a brand-new account, and
   * it would otherwise be N LLM calls that can only ever return an empty list.
   */
  const dealbreakers = z
    .array(DealbreakerSchema)
    .catch([])
    .parse(existing?.dealbreakers ?? []);
  let hitsPerJob: unknown[][] = jobs.map(() => []);
  if (jobs.length > 0 && dealbreakers.length > 0) {
    try {
      const scans = await Promise.all(
        jobs.map((j) => scanDealbreakers(j.jdText, dealbreakers))
      );
      hitsPerJob = scans.map((s) => s.hits);
    } catch (e) {
      // A scan failure must not block the import: the hits are a warning, and
      // an empty list simply means no modal. Logged so it is not silent.
      console.error("[api/try/import] dealbreaker scan failed:", e);
    }
  }

  /**
   * Every job in one flow shares a run id, which is what /run/[id] lists.
   * The column is still called batch_id — renaming it would be a migration
   * for no functional gain.
   */
  const runId = crypto.randomUUID();
  let jobIds: string[] = [];
  if (jobs.length > 0) {
    const { data: created, error } = await supabase
      .from("jobs")
      .insert(
        jobs.map((j, i) => ({
          user_id: user.id,
          jd_text: j.jdText,
          // Named from the JD upfront so History shows the employer straight
          // away; generation will not overwrite a name that is already set.
          title: j.title || null,
          company: j.company || null,
          dealbreaker_hits: hitsPerJob[i] ?? [],
          status: "created",
          batch_id: runId,
        }))
      )
      .select("id");
    if (error || !created) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to create your jobs" },
        { status: 500 }
      );
    }
    jobIds = created.map((j) => j.id);
  }

  /**
   * Persist every answer into the cross-job memory. Folding them into
   * master_data.additionalFacts (above) makes them available to the tailoring
   * prompt but NOT matchable against a future job's questions — which is why
   * returning users used to be re-asked everything. Best-effort: a failure
   * here must not cost the user the import they just completed.
   */
  const memoryRows = answers
    .filter((a) => a.question.trim() && a.answer.trim())
    .map((a) => ({
      user_id: user.id,
      question: a.question.trim(),
      answer: a.answer.trim(),
      kind: a.kind,
      payload:
        a.kind === "mcq"
          ? {
              selected: a.selected ?? [],
              ...(a.other ? { other: a.other } : {}),
              options: a.options ?? [],
              selectType: a.selectType ?? "single",
              ...(a.topic?.trim() ? { topic: a.topic.trim() } : {}),
            }
          : a.topic?.trim()
            ? { topic: a.topic.trim() }
            : null,
      source_job_id: jobIds[0] ?? null,
    }));
  if (memoryRows.length > 0) {
    const { error: answersError } = await supabase
      .from("profile_answers")
      .upsert(memoryRows, { onConflict: "user_id,question" });
    if (answersError) {
      console.error("try/import: storing answers failed:", answersError.message);
    }
  }

  return NextResponse.json({
    ok: true,
    jobId: jobIds[0] ?? null,
    runId: jobIds.length > 0 ? runId : null,
    jobCount: jobIds.length,
  });
}
