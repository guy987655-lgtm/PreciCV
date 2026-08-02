import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readCreditBalance } from "@/lib/credits";

/**
 * The live state of one run: every job in it, whether it has been generated,
 * whether it is still a locked sample, and how many credits are left to unlock
 * the rest.
 *
 * The run workspace polls this rather than holding progress in memory, so
 * closing the tab mid-run loses nothing — each /api/generate call has already
 * written its result before this can report it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, title, company, dealbreaker_hits, status, created_at")
    .eq("user_id", user.id)
    // `batch_id` is the run grouping key; the column kept its original name.
    .eq("batch_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const ids = jobs.map((j) => j.id);
  const [{ data: gens }, { data: paid }] = await Promise.all([
    supabase
      .from("generations")
      .select("job_id, is_sample")
      .eq("revision_number", 0)
      .in("job_id", ids),
    supabase
      .from("purchases")
      .select("job_id, tier, order_id")
      .eq("user_id", user.id)
      .eq("status", "paid")
      .in("job_id", ids),
  ]);

  const genBy = new Map((gens ?? []).map((g) => [g.job_id, g]));
  const paidBy = new Map((paid ?? []).map((p) => [p.job_id, p]));
  const balance = await readCreditBalance(supabase, user.id);

  return NextResponse.json(
    {
      runId: id,
      credits: balance,
      jobs: jobs.map((j) => ({
        id: j.id,
        title: j.title ?? "",
        company: j.company ?? "",
        dealbreakerHits: j.dealbreaker_hits ?? [],
        hasResult: genBy.has(j.id),
        /** Generated but watermarked and locked — the free preview. */
        isSample: genBy.get(j.id)?.is_sample ?? false,
        tier: paidBy.get(j.id)?.tier ?? null,
        orderId: paidBy.get(j.id)?.order_id ?? null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
