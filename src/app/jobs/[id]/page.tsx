import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  DealbreakerHit,
  DiffReportSchema,
  TailoredCvSchema,
  TIERS,
} from "@/lib/types";
import { JobWorkspace } from "./workspace";

export const dynamic = "force-dynamic";

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
    .select("tier, status, revisions_used")
    .eq("job_id", id)
    .eq("status", "paid")
    .maybeSingle();

  const { data: generation } = await supabase
    .from("generations")
    .select("id, cv, diff, template, revision_number")
    .eq("job_id", id)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tier = purchase?.tier as keyof typeof TIERS | undefined;

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
            }
          : null
      }
      generation={
        generation
          ? {
              id: generation.id,
              cv: TailoredCvSchema.parse(generation.cv),
              diff: DiffReportSchema.parse(generation.diff),
              template: generation.template ?? "classic",
              revisionNumber: generation.revision_number ?? 0,
            }
          : null
      }
    />
  );
}
