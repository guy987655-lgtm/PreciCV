import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MasterProfileSchema } from "@/lib/types";

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
  jdText: z.string().default(""),
  /** JD-derived naming captured during upload — see stashForSignup. */
  jobTitle: z.string().default(""),
  company: z.string().default(""),
});

/**
 * Completes the anonymous try-now flow right after signup: imports the
 * profile parsed before registration into the Master Data Lake and, if a
 * JD was pasted, creates the job. Never overwrites an already-onboarded
 * user's Master Data Lake.
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
  const { profile, rawText, answers, jdText, jobTitle, company } = parsed.data;

  const { data: existing } = await supabase
    .from("profiles")
    .select("onboarded")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing?.onboarded) {
    const facts = answers
      .filter((a) => a.answer.trim().length > 0)
      .map((a) => `${a.question} — ${a.answer.trim()}`);
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
  }

  // No dealbreakers exist yet for a brand-new user, so no scan is needed.
  let jobId: string | null = null;
  if (jdText.trim().length >= 100) {
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        user_id: user.id,
        jd_text: jdText,
        // Named from the JD upfront so History shows the employer straight
        // away; generation overwrites both with its own extraction later.
        title: jobTitle.trim() || null,
        company: company.trim() || null,
        dealbreaker_hits: [],
        status: "created",
      })
      .select("id")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    jobId = job.id;
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
      source_job_id: jobId,
    }));
  if (memoryRows.length > 0) {
    const { error: answersError } = await supabase
      .from("profile_answers")
      .upsert(memoryRows, { onConflict: "user_id,question" });
    if (answersError) {
      console.error("try/import: storing answers failed:", answersError.message);
    }
  }

  return NextResponse.json({ ok: true, jobId });
}
