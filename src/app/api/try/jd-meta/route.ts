import { NextResponse } from "next/server";
import { z } from "zod";
import {
  analyzeJdGreeting,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";
import { FUNNEL_DAILY_LIMIT, funnelQuota } from "@/lib/funnel-quota";

export const maxDuration = 30;

const BodySchema = z.object({
  jdText: z.string().min(100, "Job description is too short"),
});

/**
 * Who is hiring, and for what — read off a pasted job description.
 *
 * Runs as soon as a JD is filed away on the homepage so each job labels itself
 * with a real company name instead of "Job 3", and so the export filenames
 * have a name to use. Reuses analyzeJdGreeting, which already returns "" rather
 * than guessing when a posting is anonymous or an agency is fronting for an
 * undisclosed client — that empty string is the signal the UI turns into a
 * required field for the user to fill in.
 *
 * Anonymous: the homepage collects jobs before anyone signs up, so this cannot
 * require a session. It is rate-limited instead, on the funnel bucket rather
 * than the generation one (see rate-limit.ts).
 *
 * Best-effort by design: a failure returns empty strings with 200, because the
 * user can always type the name themselves and blocking the paste on a flaky
 * LLM call would be worse than an unprefilled field.
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
          `You've reached today's limit of ${FUNNEL_DAILY_LIMIT} job reads. ` +
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

  try {
    // No CV text: this route is anonymous, and the greeting analysis only
    // needs it for the parts of its output that this endpoint discards.
    const greeting = await analyzeJdGreeting(parsed.data.jdText, "");
    const res = NextResponse.json({
      title: greeting.targetJobTitle ?? "",
      company: greeting.company ?? "",
    });
    res.headers.set("Set-Cookie", quota.commit());
    return res;
  } catch (e) {
    console.error("[api/try/jd-meta] extraction failed:", e);
    return NextResponse.json({ title: "", company: "" });
  }
}
