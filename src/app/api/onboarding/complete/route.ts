import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DealbreakerSchema, MasterProfileSchema } from "@/lib/types";

const BodySchema = z.object({
  answers: z.array(z.object({ question: z.string(), answer: z.string() })),
  dealbreakers: z.array(DealbreakerSchema),
});

/**
 * Onboarding step 2+3: merge questionnaire answers into the Master Data
 * Lake and store the user's absolute dealbreakers.
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

  const { data: profileRow, error: fetchError } = await supabase
    .from("profiles")
    .select("master_data")
    .eq("user_id", user.id)
    .single();
  if (fetchError || !profileRow) {
    return NextResponse.json(
      { error: "Upload your CV first" },
      { status: 400 }
    );
  }

  const profile = MasterProfileSchema.parse(profileRow.master_data ?? {});
  const facts = parsed.data.answers
    .filter((a) => a.answer.trim().length > 0)
    .map((a) => `${a.question} — ${a.answer.trim()}`);
  profile.additionalFacts = [...profile.additionalFacts, ...facts];

  const { error } = await supabase
    .from("profiles")
    .update({
      master_data: profile,
      dealbreakers: parsed.data.dealbreakers,
      onboarded: true,
    })
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
