import { NextResponse } from "next/server";
import { z } from "zod";
import {
  refineAnswer,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";

export const maxDuration = 30;

const BodySchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1).max(4000),
});

/**
 * Anonymous funnel: professionally rewrites a user's open answer for the chat
 * confirmation loop (PRD 2.5). On approval the client makes it the canonical
 * answer. Nothing is stored server-side.
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
    const refined = await refineAnswer(parsed.data.question, parsed.data.answer);
    return NextResponse.json({ refined });
  } catch (e) {
    console.error("try/confirm-answer failed:", e);
    // Non-critical — the client skips confirmation and keeps the raw answer.
    return NextResponse.json({ refined: "" });
  }
}
