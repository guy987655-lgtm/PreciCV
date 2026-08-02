import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  scanDealbreakers,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";
import { DealbreakerSchema } from "@/lib/types";

export const maxDuration = 60;

const BodySchema = z.object({
  jdText: z.string().min(100, "Job description is too short"),
  jdUrl: z.string().optional().default(""),
});

/**
 * The signed-in user's jobs, newest first, each flagged with whether it has
 * a generation yet and whether that generation is a free sample. History
 * used to read localStorage only, so flows that made it into Supabase — i.e.
 * every real one — were invisible and could not be reopened.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  type JobRow = {
    id: string;
    title: string | null;
    company: string | null;
    display_name?: string | null;
    created_at: string;
  };

  // Soft-deleted rows stay in the database (purchases reference them) but
  // must never come back into History.
  const current = await supabase
    .from("jobs")
    .select("id, title, company, display_name, status, created_at")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  // Migration 0006 adds display_name/deleted_at. A deploy can land before the
  // SQL is applied, and History going blank for everyone is a far worse
  // failure than temporarily missing rename and soft-delete — so fall back to
  // the pre-0006 column set instead of erroring.
  let jobs: JobRow[] | null = current.data;
  let error = current.error;
  if (error) {
    console.warn("[api/jobs] falling back to pre-0006 columns:", error.message);
    const legacy = await supabase
      .from("jobs")
      .select("id, title, company, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    jobs = legacy.data;
    error = legacy.error;
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (jobs ?? []).map((j) => j.id);
  const { data: gens } = ids.length
    ? await supabase
        .from("generations")
        .select("job_id, is_sample")
        .in("job_id", ids)
    : { data: [] as { job_id: string; is_sample: boolean }[] };
  const { data: paid } = ids.length
    ? await supabase
        .from("purchases")
        .select("job_id, tier, order_id")
        .eq("status", "paid")
        .in("job_id", ids)
    : { data: [] as { job_id: string; tier: string; order_id: string | null }[] };

  const genBy = new Map((gens ?? []).map((g) => [g.job_id, g]));
  const paidBy = new Map((paid ?? []).map((p) => [p.job_id, p]));

  return NextResponse.json({
    jobs: (jobs ?? []).map((j) => ({
      id: j.id,
      title: j.title ?? "",
      company: j.company ?? "",
      /** User's rename; "" means fall back to title · company. */
      displayName: j.display_name ?? "",
      createdAt: j.created_at,
      hasResult: genBy.has(j.id),
      isSample: genBy.get(j.id)?.is_sample ?? false,
      tier: paidBy.get(j.id)?.tier ?? null,
      /** Set when this unlock was spent from a bundle — such a job upgrades
       *  with its whole bundle, never on its own. */
      orderId: paidBy.get(j.id)?.order_id ?? null,
    })),
  });
}

/**
 * Create a job from a JD and immediately run the pre-generation
 * Dealbreaker Scan (PRD §4.3) — BEFORE any credit is spent. The scan
 * result is stored on the job and returned so the UI can show the
 * warning modal.
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 }
    );
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("dealbreakers, onboarded")
    .eq("user_id", user.id)
    .single();
  if (!profileRow?.onboarded) {
    return NextResponse.json(
      { error: "Complete onboarding first" },
      { status: 400 }
    );
  }

  const dealbreakers = z
    .array(DealbreakerSchema)
    .catch([])
    .parse(profileRow.dealbreakers ?? []);

  const scan = await scanDealbreakers(parsed.data.jdText, dealbreakers);

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      user_id: user.id,
      jd_text: parsed.data.jdText,
      jd_url: parsed.data.jdUrl || null,
      dealbreaker_hits: scan.hits,
      status: "created",
    })
    .select("id")
    .single();
  if (error || !job) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create job" },
      { status: 500 }
    );
  }

  return NextResponse.json({ jobId: job.id, dealbreakerHits: scan.hits });
}
