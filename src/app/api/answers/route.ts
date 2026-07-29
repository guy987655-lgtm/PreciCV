import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { StoredAnswer } from "@/lib/answer-match";

/** One answer as it travels to/from the client. */
const AnswerSchema = z.object({
  question: z.string().min(1).max(1000),
  answer: z.string().max(8000),
  kind: z.enum(["mcq", "open"]).default("open"),
  /** MCQ only — the structure the readable `answer` was rendered from. */
  selected: z.array(z.string()).optional(),
  other: z.string().optional(),
  options: z.array(z.string()).optional(),
  /** Kept so My Card can re-render the question with the right input. */
  selectType: z.enum(["single", "ranked"]).optional(),
  /** Category (McqQuestionSchema.topic) — powers My Card's filter chips.
   *  Without it every account-restored answer came back uncategorized. */
  topic: z.string().max(120).optional(),
  jobId: z.string().uuid().optional(),
});

const BodySchema = z.object({
  answers: z.array(AnswerSchema).min(1).max(200),
});

type StoredPayload = {
  selected?: string[];
  other?: string;
  options?: string[];
  selectType?: "single" | "ranked";
  topic?: string;
};

type PayloadRow = {
  question: string;
  answer: string;
  kind: string;
  payload: StoredPayload | null;
  updated_at: string;
};

/** The user's whole answer memory, newest first (My Card reads this). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profile_answers")
    .select("question, answer, kind, payload, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const answers: (StoredAnswer & {
    options?: string[];
    selectType?: "single" | "ranked";
    topic?: string;
  })[] = ((data ?? []) as PayloadRow[]).map((r) => ({
    question: r.question,
    answer: r.answer,
    kind: r.kind === "mcq" ? "mcq" : "open",
    selected: r.payload?.selected,
    other: r.payload?.other,
    // My Card re-renders these as real inputs, so it needs the shape of the
    // question the answer was given to, not just the answer text.
    options: r.payload?.options,
    selectType: r.payload?.selectType,
    // Empty on rows written before topics were stored — My Card infers one.
    topic: r.payload?.topic ?? "",
    updatedAt: new Date(r.updated_at).getTime(),
  }));
  return NextResponse.json({ answers });
}

/**
 * Erases the user's whole answer memory (My Card's "clear my data").
 *
 * Also empties master_data.additionalFacts: answers imported at signup were
 * flattened in there, where they are indistinguishable from facts parsed out
 * of the CV. Leaving them would mean a "cleared" account still fed old
 * answers into every future generation, which is exactly what the user asked
 * to stop. The CV-derived facts that go with them are re-extracted on the next
 * upload; nothing else in the profile is touched.
 */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("profile_answers")
    .delete()
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("master_data")
    .eq("user_id", user.id)
    .maybeSingle();
  const master = profileRow?.master_data as Record<string, unknown> | null;
  if (master && Array.isArray(master.additionalFacts) && master.additionalFacts.length) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ master_data: { ...master, additionalFacts: [] } })
      .eq("user_id", user.id);
    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * Upserts answers into the user's cross-job memory. One row per question
 * (unique on user_id + question), so re-answering updates in place and the
 * newest wording of an answer is always the one replayed onto a new job.
 *
 * Answers used to survive only as flattened strings inside
 * profiles.master_data, which cannot be matched against a new job's
 * questions — which is why every application re-asked everything.
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

  const rows = parsed.data.answers
    .filter((a) => a.question.trim() && a.answer.trim())
    .map((a) => ({
      user_id: user.id,
      question: a.question.trim(),
      answer: a.answer.trim(),
      kind: a.kind,
      // Open answers used to store no payload at all; they now carry the
      // topic so My Card can categorize them on a fresh device too.
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
      source_job_id: a.jobId ?? null,
    }));
  if (rows.length === 0) return NextResponse.json({ ok: true, saved: 0 });

  const { error } = await supabase
    .from("profile_answers")
    .upsert(rows, { onConflict: "user_id,question" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, saved: rows.length });
}
