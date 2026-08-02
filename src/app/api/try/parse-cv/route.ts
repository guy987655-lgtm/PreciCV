import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractDocText, ParseDocError } from "@/lib/parse-doc";
import {
  analyzeJdGreeting,
  extractProfileFromCv,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";
import { FUNNEL_DAILY_LIMIT, funnelQuota } from "@/lib/funnel-quota";

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

  /**
   * The funnel now fires this the moment a CV is dropped rather than on a
   * submit click, so an abandoned upload costs an extraction. Capped per
   * browser + IP on the funnel bucket — deliberately not the generation
   * bucket, so reading CVs never eats the free CVs the user came for.
   */
  const quota = funnelQuota(request);
  if (!quota.allowed) {
    const res = NextResponse.json(
      {
        error: "quota_exceeded",
        message:
          `You've reached today's limit of ${FUNNEL_DAILY_LIMIT} analyses. ` +
          `Come back after ${quota.resetAt.toLocaleString()}.`,
        resetAt: quota.resetAt.toISOString(),
      },
      { status: 429 }
    );
    res.headers.set("Set-Cookie", quota.cookieHeader);
    return res;
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
    const res = NextResponse.json({
      profile,
      questionnaire,
      mcq,
      rawText,
      greeting,
    });
    // Charged only on success — a failed extraction costs the user nothing.
    res.headers.set("Set-Cookie", quota.commit());
    return res;
  } catch (e) {
    console.error("try/parse-cv extraction failed:", e);
    return NextResponse.json(
      { error: "CV analysis failed. Please try again in a moment." },
      { status: 502 }
    );
  }
}
