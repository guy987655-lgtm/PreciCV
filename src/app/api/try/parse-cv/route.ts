import { NextResponse } from "next/server";
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
 */
export async function POST(request: Request) {
  if (!llmConfigured()) {
    return NextResponse.json({ error: LLM_NOT_CONFIGURED_MSG }, { status: 503 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  // Optional target job — makes the questionnaire gap-bridging specific.
  const jd = formData.get("jd");
  const jdText = typeof jd === "string" ? jd : "";

  let rawText: string;
  try {
    rawText = await extractDocText(file);
  } catch (e) {
    if (e instanceof ParseDocError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
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
