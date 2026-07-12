import { NextResponse } from "next/server";
import { z } from "zod";
import { MasterProfileSchema } from "@/lib/types";
import {
  generateRoleQuestions,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";

export const maxDuration = 60;

const BodySchema = z.object({
  profile: MasterProfileSchema,
  existingTopics: z.array(z.string()).default([]),
  existingQuestions: z.array(z.string()).default([]),
});

/**
 * Anonymous funnel: generates a large bank of role-standard multiple-choice
 * questions — what the job market typically requires for the candidate's
 * role — so the quick check can go deep. Nothing is stored server-side.
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
    const mcq = await generateRoleQuestions(
      parsed.data.profile,
      parsed.data.existingTopics,
      parsed.data.existingQuestions
    );
    return NextResponse.json({ mcq });
  } catch (e) {
    console.error("role-questions generation failed:", e);
    return NextResponse.json(
      { error: "Question generation failed. Please try again in a moment." },
      { status: 502 }
    );
  }
}
