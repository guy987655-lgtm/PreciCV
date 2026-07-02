import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MasterProfileSchema } from "@/lib/types";

const BodySchema = z.object({
  profile: MasterProfileSchema,
  rawText: z.string().default(""),
  answers: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .default([]),
  jdText: z.string().default(""),
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
  const { profile, rawText, answers, jdText } = parsed.data;

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

  return NextResponse.json({ ok: true, jobId });
}
