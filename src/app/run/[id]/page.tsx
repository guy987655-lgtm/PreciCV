import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MasterProfileSchema, type DealbreakerHit } from "@/lib/types";
import { Navbar } from "@/components/navbar";
import { RunWorkspace, type RunJob } from "./run-workspace";

export const dynamic = "force-dynamic";

/**
 * The run workspace — every job in one run, its status, and the controls
 * to generate, unlock and download them.
 *
 * Server-rendered from the database rather than from anything the builder
 * handed over, so reopening this URL after closing the tab picks up exactly
 * where generation got to.
 */
export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/run/${id}`);

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title, company, dealbreaker_hits, created_at")
    .eq("user_id", user.id)
    // `batch_id` is the run grouping key; the column kept its original name.
    .eq("batch_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (!jobs || jobs.length === 0) notFound();

  const ids = jobs.map((j) => j.id);
  const [{ data: gens }, { data: paid }, { data: profileRow }] =
    await Promise.all([
      supabase
        .from("generations")
        .select("job_id, is_sample")
        .eq("user_id", user.id)
        .eq("revision_number", 0)
        .in("job_id", ids),
      supabase
        .from("purchases")
        .select("job_id, tier, order_id")
        .eq("user_id", user.id)
        .eq("status", "paid")
        .in("job_id", ids),
      supabase
        .from("profiles")
        .select("master_data")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

  const genBy = new Map((gens ?? []).map((g) => [g.job_id, g]));
  const paidBy = new Map((paid ?? []).map((p) => [p.job_id, p]));
  const profile = MasterProfileSchema.safeParse(profileRow?.master_data ?? {});

  const initialJobs: RunJob[] = jobs.map((j) => ({
    id: j.id,
    title: j.title ?? "",
    company: j.company ?? "",
    dealbreakerHits: (j.dealbreaker_hits as DealbreakerHit[]) ?? [],
    hasResult: genBy.has(j.id),
    isSample: genBy.get(j.id)?.is_sample ?? false,
    tier: (paidBy.get(j.id)?.tier as string | undefined) ?? null,
    orderId: paidBy.get(j.id)?.order_id ?? null,
  }));

  return (
    <main className="min-h-screen">
      <div className="print:hidden">
        <Navbar />
      </div>
      <RunWorkspace
        runId={id}
        initialJobs={initialJobs}
        candidateName={profile.success ? profile.data.contact.fullName : ""}
        // The whole profile, not just the name: the optional questions offered
        // during a long run are generated from it (see WaitQuestionsModal).
        profile={profile.success ? profile.data : null}
      />
    </main>
  );
}
