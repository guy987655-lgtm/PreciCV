import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rewriteSnippet, llmConfigured, LLM_NOT_CONFIGURED_MSG } from "@/lib/llm";
import { MAX_REWRITES } from "@/lib/types";

export const maxDuration = 60;

const BodySchema = z.object({
  jobId: z.string().uuid(),
  text: z.string().min(1).max(2000),
  length: z.enum(["short", "long", "default"]).default("default"),
  context: z.string().max(200).optional(),
});

/**
 * Paid workspace: rewrites a single highlighted CV snippet. Job-scoped quota of
 * MAX_REWRITES per flow, tracked in purchases.rewrites_used (mirrors the
 * revisions quota). Browsing prior rewrites is a client-side, free operation.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!llmConfigured()) {
    return NextResponse.json({ error: LLM_NOT_CONFIGURED_MSG }, { status: 503 });
  }

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { jobId, text, length, context } = parsed.data;

  const { data: job } = await supabase
    .from("jobs")
    .select("id, jd_text")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .single();
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { data: purchase } = await supabase
    .from("purchases")
    .select("id, rewrites_used, status")
    .eq("job_id", jobId)
    .eq("user_id", user.id)
    .eq("status", "paid")
    .maybeSingle();
  if (!purchase) {
    return NextResponse.json({ error: "payment_required" }, { status: 402 });
  }
  const used = purchase.rewrites_used ?? 0;
  if (used >= MAX_REWRITES) {
    return NextResponse.json(
      { error: `All ${MAX_REWRITES} rewrites for this job have been used` },
      { status: 403 }
    );
  }

  try {
    const rewritten = await rewriteSnippet(text, {
      length,
      context,
      jdText: job.jd_text as string,
    });
    await supabase
      .from("purchases")
      .update({ rewrites_used: used + 1 })
      .eq("id", purchase.id);
    return NextResponse.json({
      text: rewritten,
      rewritesUsed: used + 1,
      rewritesRemaining: MAX_REWRITES - used - 1,
    });
  } catch (e) {
    console.error("rewrite failed:", e);
    return NextResponse.json(
      { error: "Rewrite failed. Please try again in a moment." },
      { status: 502 }
    );
  }
}
