import { NextResponse } from "next/server";
import { z } from "zod";
import { llmFailureResponse } from "@/lib/api-errors";
import {
  analyzeJdGreeting,
  extractJobQuestions,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";
import { MasterProfileSchema } from "@/lib/types";
import { MAX_PACK_SIZE } from "@/lib/packs";
import { MIN_JD_CHARS } from "@/lib/funnel";
import { FUNNEL_DAILY_LIMIT, funnelQuota } from "@/lib/funnel-quota";

export const maxDuration = 120;

const BodySchema = z.object({
  profile: MasterProfileSchema,
  rawText: z.string().default(""),
  jdTexts: z
    .array(z.string().min(MIN_JD_CHARS, "Job description is too short"))
    .min(1)
    .max(MAX_PACK_SIZE),
});

/**
 * One question set for every job in the flow.
 *
 * Asking per job would mean five near-identical questionnaires for someone
 * applying to five similar roles; extractJobQuestions merges them into a single
 * pool that covers all of them.
 *
 * Anonymous by design — the homepage asks these questions before anyone signs
 * up, so the profile arrives in the body rather than being read from
 * profiles.master_data. Rate-limited on the funnel bucket instead of a session.
 *
 * The pools come back RAW and uncapped. The client owns the rest of the
 * pipeline (see continueToQuestions in try-now.tsx):
 *
 *   findCachedAnswers + /api/answers/match → what the user already answered
 *   capQuestionPools    → hold the total to MAX_ASKED_MCQ + MAX_ASKED_OPEN
 *   normalizeMcqPool    → collapse to a handful of topic categories
 *   ensureAiToolOptions → guarantee the AI-tool options
 *
 * That split is deliberate: matching has to happen before capping (otherwise
 * the budget is spent on questions the matcher is about to answer), and a
 * guest's matches live in localStorage where only the browser can see them.
 */
export async function POST(request: Request) {
  if (!llmConfigured()) {
    return NextResponse.json({ error: LLM_NOT_CONFIGURED_MSG }, { status: 503 });
  }

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

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 }
    );
  }
  const { profile, rawText, jdTexts } = parsed.data;

  try {
    // The greeting opens the chat and is a first-job thing by nature — it
    // names one employer. Non-fatal: the chat has a neutral opener without it.
    const [pools, greeting] = await Promise.all([
      extractJobQuestions(profile, jdTexts),
      analyzeJdGreeting(jdTexts[0], rawText).catch(() => null),
    ]);
    const res = NextResponse.json({
      mcq: pools.mcq,
      questionnaire: pools.questionnaire,
      greeting,
    });
    // Charged only on success — a failed run costs the user nothing.
    res.headers.set("Set-Cookie", quota.commit());
    return res;
  } catch (e) {
    return llmFailureResponse("api/try/questions", e);
  }
}
