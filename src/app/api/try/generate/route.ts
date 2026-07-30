import { NextResponse } from "next/server";
import { z } from "zod";
import { MasterProfileSchema } from "@/lib/types";
import {
  generateTailoredCv,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";
import { checkDailyQuota } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { FREE_GENERATIONS_PER_DAY } from "@/lib/free-quota";

export const maxDuration = 300;

/**
 * Backstop cap, enforced per IP (see src/lib/rate-limit.ts) as well as per
 * browser cookie, so opening an Incognito window — which drops the cookie but
 * keeps the IP — does not grant more.
 *
 * Matched to the account-wide free limit. This route persists nothing, so the
 * derived counter in free-quota.ts cannot see its usage; the cookie/IP counter
 * is the only ceiling available here.
 */
const DAILY_LIMIT = FREE_GENERATIONS_PER_DAY;

const BodySchema = z.object({
  profile: MasterProfileSchema,
  jdText: z.string().min(100),
});

/**
 * Tailored CV generation straight from the funnel's local profile + job text.
 * Nothing is persisted server-side.
 *
 * Requires a signed-in user. Guests answer the questionnaire and then hit the
 * register wall — generation is a registered-user feature — and this route used
 * to be an open, unauthenticated LLM endpoint that made that wall bypassable
 * with a single curl. Signed-in traffic is still capped per browser+IP, since
 * nothing here lands in the database for the account-wide counter to see.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      {
        error: "registration_required",
        message: "Register to generate your tailored CV and reports.",
      },
      { status: 401 }
    );
  }

  if (!llmConfigured()) {
    return NextResponse.json({ error: LLM_NOT_CONFIGURED_MSG }, { status: 503 });
  }

  const quota = checkDailyQuota(request, DAILY_LIMIT);
  if (!quota.allowed) {
    const res = NextResponse.json(
      {
        error: "quota_exceeded",
        message:
          `You've used your ${quota.limit === 1 ? "CV" : `${quota.limit} CVs`} for today. ` +
          `Come back after ${quota.resetAt.toLocaleString()} for another.`,
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
    const res = NextResponse.json({
      ...result,
      remaining: quota.remaining,
    });
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
