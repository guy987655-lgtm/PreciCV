import { NextResponse } from "next/server";
import { z } from "zod";
import {
  translateQuestions,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";
import { langDef } from "@/lib/i18n";

export const maxDuration = 120;

const BodySchema = z.object({
  /** ISO code from src/lib/i18n.ts — an allow-list, never free text. */
  lang: z.string().min(2).max(8),
  items: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        why: z.string().optional(),
        options: z.array(z.string()).optional(),
        example: z.string().optional(),
      })
    )
    .max(120),
});

/**
 * Translates the questionnaire for display in the user's own language.
 * Anonymous like the rest of /api/try/*: the funnel runs before signup, and
 * nothing is stored server-side — the client caches the result in its funnel
 * state so toggling back and forth costs nothing.
 */
export async function POST(request: Request) {
  if (!llmConfigured()) {
    return NextResponse.json({ error: LLM_NOT_CONFIGURED_MSG }, { status: 503 });
  }

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Only the languages we ship: the code reaches the model's prompt, so it
  // must come from our table rather than from the request body.
  const lang = langDef(parsed.data.lang);
  if (!lang) {
    return NextResponse.json(
      { error: "Unsupported language" },
      { status: 400 }
    );
  }

  try {
    const items = await translateQuestions(parsed.data.items, lang.promptName);
    return NextResponse.json({ lang: lang.code, items });
  } catch (e) {
    console.error("try/translate failed:", e);
    return NextResponse.json(
      { error: "Translation failed. Please try again in a moment." },
      { status: 502 }
    );
  }
}
