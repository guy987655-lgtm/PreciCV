import { NextResponse } from "next/server";
import { z } from "zod";
import { MasterProfileSchema } from "@/lib/types";
import {
  generateTailoredCv,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";
import { checkDailyQuota } from "@/lib/rate-limit";

export const maxDuration = 300;

const DAILY_LIMIT = 3;

const BodySchema = z.object({
  profile: MasterProfileSchema,
  jdText: z.string().min(100),
});

/**
 * V1 public launch: anonymous, no-account, no-payment tailored CV
 * generation straight from the funnel's local profile + job text. Nothing
 * is persisted server-side. Rate-limited per browser+IP (see
 * src/lib/rate-limit.ts) since there is no account/purchase to gate on.
 */
export async function POST(request: Request) {
  if (!llmConfigured()) {
    return NextResponse.json({ error: LLM_NOT_CONFIGURED_MSG }, { status: 503 });
  }

  const quota = checkDailyQuota(request, DAILY_LIMIT);
  if (!quota.allowed) {
    const res = NextResponse.json(
      {
        error: "quota_exceeded",
        message:
          `You've used all ${quota.limit} free CVs for today. ` +
          `Try again after ${quota.resetAt.toLocaleString()}.`,
        resetAt: quota.resetAt.toISOString(),
      },
      { status: 429 }
    );
    res.headers.set("Set-Cookie", quota.cookieHeader);
    return res;
  }

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await generateTailoredCv(parsed.data.profile, parsed.data.jdText);
    // Quota is consumed only on success — a failed run costs the user nothing.
    const setCookie = quota.commit();
    const res = NextResponse.json({ ...result, remaining: quota.remaining });
    res.headers.set("Set-Cookie", setCookie);
    return res;
  } catch (e) {
    console.error("try/generate failed:", e);
    const message =
      e instanceof Error && e.message.includes("overloaded")
        ? e.message
        : "Generation failed. Please try again in a moment.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
