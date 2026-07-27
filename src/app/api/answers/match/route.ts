import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_MATCH, StoredAnswer, matchAnswers } from "@/lib/answer-match";
import { McqQuestionnaireSchema, QuestionnaireSchema } from "@/lib/types";

const BodySchema = z.object({
  mcq: McqQuestionnaireSchema.nullable().default(null),
  questionnaire: QuestionnaireSchema.nullable().default(null),
});

/**
 * Cross-references a new job's questions against everything this user has
 * already answered, so an active user is only asked what is genuinely new.
 * Returns the answers keyed by the NEW question ids, plus the ids that are
 * therefore already known (the client hides those and recaps them instead).
 *
 * Signed-out callers get an empty match rather than an error: the funnel runs
 * before signup, and the browser's own localStorage cache covers that case.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(EMPTY_MATCH);

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("profile_answers")
    // Newest first: matchAnswers takes the first semantic hit, so this is
    // what makes the most recent answer the one replayed.
    .select("question, answer, kind, payload, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sources: StoredAnswer[] = (data ?? []).map((r) => {
    const payload = r.payload as
      | { selected?: string[]; other?: string }
      | null;
    return {
      question: r.question as string,
      answer: r.answer as string,
      kind: r.kind === "mcq" ? "mcq" : "open",
      selected: payload?.selected,
      other: payload?.other,
      updatedAt: new Date(r.updated_at as string).getTime(),
    };
  });

  return NextResponse.json(
    matchAnswers(sources, parsed.data.mcq, parsed.data.questionnaire)
  );
}
