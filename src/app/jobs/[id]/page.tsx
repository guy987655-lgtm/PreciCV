import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  DealbreakerHit,
  DiffReportSchema,
  InterviewSimulationSchema,
  MAX_REWRITES,
  MAX_REPORT_REGENS,
  TailoredCvSchema,
  TIERS,
} from "@/lib/types";
import { JobWorkspace } from "./workspace";

export const dynamic = "force-dynamic";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  // Checkout redirects here with ?paid=1 (or ?paid=dev in DEV_FREE_MODE).
  // The workspace uses it to unlock without a click and to wait out the
  // webhook when the purchase row hasn't flipped to 'paid' yet.
  const justPaid = Boolean((await searchParams).paid);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: job } = await supabase
    .from("jobs")
    .select("id, title, company, jd_text, dealbreaker_hits, status")
    .eq("id", id)
    .single();
  if (!job) notFound();

  const { data: purchase } = await supabase
    .from("purchases")
    .select(
      "tier, status, revisions_used, rewrites_used, report_regens_used, order_id"
    )
    .eq("job_id", id)
    .eq("status", "paid")
    .maybeSingle();

  const { data: generation } = await supabase
    .from("generations")
    .select(
      "id, cv, diff, simulation, template, revision_number, is_sample, report_stale, cv_theme, split_view"
    )
    .eq("job_id", id)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tier = purchase?.tier as keyof typeof TIERS | undefined;

  // One free sample PER JOB (it used to be one per account): every new job
  // gets a taste. Available while this job is unpaid and not yet generated —
  // the "one generation per job" rule is what caps it at one.
  const freeSampleAvailable = !purchase && !generation;

  return (
    <JobWorkspace
      job={{
        id: job.id,
        title: job.title ?? "",
        company: job.company ?? "",
        dealbreakerHits: (job.dealbreaker_hits as DealbreakerHit[]) ?? [],
      }}
      purchase={
        purchase
          ? {
              tier: tier!,
              revisionsUsed: purchase.revisions_used ?? 0,
              maxRevisions: tier ? TIERS[tier].maxRevisions : 0,
              rewritesUsed: purchase.rewrites_used ?? 0,
              maxRewrites: MAX_REWRITES,
              regensUsed: purchase.report_regens_used ?? 0,
              maxRegens: MAX_REPORT_REGENS,
              orderId: purchase.order_id ?? null,
            }
          : null
      }
      generation={
        generation
          ? {
              id: generation.id,
              cv: TailoredCvSchema.parse(generation.cv),
              diff: DiffReportSchema.parse(generation.diff),
              simulation: InterviewSimulationSchema.parse(
                generation.simulation ?? {}
              ),
              template: generation.template ?? "classic",
              revisionNumber: generation.revision_number ?? 0,
              isSample: generation.is_sample ?? false,
              reportStale: generation.report_stale ?? false,
              cvTheme: generation.cv_theme === "dark" ? ("dark" as const) : ("light" as const),
              splitView: generation.split_view ?? false,
            }
          : null
      }
      freeSampleAvailable={freeSampleAvailable}
      justPaid={justPaid}
    />
  );
}
