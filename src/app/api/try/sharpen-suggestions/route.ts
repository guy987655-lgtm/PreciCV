import { NextResponse } from "next/server";
import { z } from "zod";
import { MasterProfileSchema } from "@/lib/types";
import {
  suggestOpenAnswers,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";

export const maxDuration = 60;

const BodySchema = z.object({
  profile: MasterProfileSchema,
  questions: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        why: z.string().optional(),
      })
    )
    .max(20),
});

/**
 * Anonymous funnel: generates a smart example answer for each Sharpen-step open
 * question, grounded in the candidate's CV, used as inspiration placeholders.
 * Nothing is stored server-side.
 */
export async function POST(request: Request) {
  if (!llmConfigured()) {
    return NextResponse.json({ error: LLM_NOT_CONFIGURED_MSG }, { status: 503 });
  }
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  try {
    const suggestions = await suggestOpenAnswers(
      parsed.data.profile,
      parsed.data.questions
    );
    return NextResponse.json({ suggestions });
  } catch (e) {
    console.error("try/sharpen-suggestions failed:", e);
    // Non-critical — the UI falls back to the generic placeholder.
    return NextResponse.json({ suggestions: {} });
  }
}
