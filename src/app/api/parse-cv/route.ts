import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { createClient } from "@/lib/supabase/server";
import { extractProfileFromCv } from "@/lib/anthropic";

export const maxDuration = 120;

/**
 * Onboarding step 1: upload CV (PDF/DOCX) → server-side text extraction →
 * LLM baseline extraction + dynamic questionnaire → stored in the
 * Master Data Lake (profiles.master_data).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  let rawText = "";
  try {
    if (name.endsWith(".pdf")) {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      rawText = text;
    } else if (name.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value;
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a PDF or DOCX." },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Could not read the document. Try exporting it again as PDF." },
      { status: 422 }
    );
  }

  if (rawText.trim().length < 100) {
    return NextResponse.json(
      {
        error:
          "We couldn't extract enough text from this file. If it's a scanned image, please upload a text-based PDF or DOCX.",
      },
      { status: 422 }
    );
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
