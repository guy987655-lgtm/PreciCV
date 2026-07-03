import { NextResponse } from "next/server";
import { extractDocText, ParseDocError } from "@/lib/parse-doc";
import { extractProfileFromCv } from "@/lib/anthropic";

export const maxDuration = 120;

/**
 * Anonymous try-before-signup parsing: extracts the profile and the
 * dynamic questionnaire and returns them to the browser WITHOUT storing
 * anything server-side. The client keeps the result in localStorage and
 * imports it via /api/try/import right after the user signs up.
 */
export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "The AI engine isn't configured yet (missing ANTHROPIC_API_KEY on the server).",
      },
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

  try {
    const { profile, questionnaire } = await extractProfileFromCv(rawText);
    return NextResponse.json({ profile, questionnaire, rawText });
  } catch (e) {
    console.error("try/parse-cv extraction failed:", e);
    return NextResponse.json(
      { error: "CV analysis failed. Please try again in a moment." },
      { status: 502 }
    );
  }
}
