import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractDocText, ParseDocError } from "@/lib/parse-doc";
import {
  analyzeJdGreeting,
  extractProfileFromCv,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";

export const maxDuration = 120;

/**
 * Anonymous try-before-signup parsing: extracts the profile and the
 * dynamic questionnaire and returns them to the browser WITHOUT storing
 * anything server-side. The client keeps the result in localStorage and
 * imports it via /api/try/import right after the user signs up.
 *
 * One authenticated variant: `useSaved` runs the same extraction against the
 * CV text a signed-in user already has on file (profiles.raw_cv_text), so a
 * returning user does not have to locate and re-upload the same document. It
 * still stores nothing new — it only reads what /api/account/preferences
 * saved — and the text never round-trips through the browser.
 */
export async function POST(request: Request) {
  if (!llmConfigured()) {
    return NextResponse.json({ error: LLM_NOT_CONFIGURED_MSG }, { status: 503 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const useSaved = formData.get("useSaved") === "1";
  if (!useSaved && !(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  // Optional target job — makes the questionnaire gap-bridging specific.
  const jd = formData.get("jd");
  const jdText = typeof jd === "string" ? jd : "";

  let rawText: string;
  if (useSaved) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data } = await supabase
      .from("profiles")
      .select("raw_cv_text")
      .eq("user_id", user.id)
      .maybeSingle();
    rawText = data?.raw_cv_text?.trim() ?? "";
    if (!rawText) {
      return NextResponse.json(
        { error: "No saved CV found. Please upload your CV." },
        { status: 404 }
      );
    }
  } else {
    try {
      rawText = await extractDocText(file as File);
    } catch (e) {
      if (e instanceof ParseDocError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
  }

  try {
    // Greeting facts ride along in parallel — non-fatal if they fail.
    const [{ profile, questionnaire, mcq }, greeting] = await Promise.all([
      extractProfileFromCv(rawText, jdText),
      jdText.trim()
        ? analyzeJdGreeting(jdText, rawText).catch(() => null)
        : Promise.resolve(null),
    ]);
    return NextResponse.json({ profile, questionnaire, mcq, rawText, greeting });
  } catch (e) {
    console.error("try/parse-cv extraction failed:", e);
    return NextResponse.json(
      { error: "CV analysis failed. Please try again in a moment." },
      { status: 502 }
    );
  }
}
