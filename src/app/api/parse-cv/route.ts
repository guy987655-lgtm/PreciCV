import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractDocText, ParseDocError } from "@/lib/parse-doc";
import { extractProfileFromCv } from "@/lib/anthropic";

export const maxDuration = 120;

/**
 * Onboarding step 1 (authenticated): upload CV (PDF/DOCX) → server-side
 * text extraction → LLM baseline extraction + dynamic questionnaire →
 * stored in the Master Data Lake (profiles.master_data).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "The AI engine isn't configured yet (missing ANTHROPIC_API_KEY on the server)." },
      { status: 503 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  let rawText: string;
  try {
    rawText = await extractDocText(file);
  } catch (e) {
    if (e instanceof ParseDocError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { profile, questionnaire } = await extractProfileFromCv(rawText);

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: user.id,
      email: user.email,
      master_data: profile,
      raw_cv_text: rawText,
      onboarded: false,
    },
    { onConflict: "user_id" }
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile, questionnaire });
}
