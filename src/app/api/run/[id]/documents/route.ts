import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  DiffReportSchema,
  InterviewSimulationSchema,
  TailoredCvSchema,
} from "@/lib/types";

/**
 * The full generated documents for every unlocked job in a run — what the
 * download queue actually prints.
 *
 * Kept out of GET /api/run/[id] on purpose: that endpoint is polled while
 * generation runs, and five CVs plus five reports of JSON on every poll is a
 * lot of bytes to move for a progress bar. This is fetched once, when the user
 * asks to download.
 *
 * Samples are excluded. They are watermarked previews that the workspace never
 * offers as files, and returning them here would let a locked CV be printed.
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

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title, company")
    .eq("user_id", user.id)
    // `batch_id` is the run grouping key; the column kept its original name.
    .eq("batch_id", id)
    .is("deleted_at", null);
  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const ids = jobs.map((j) => j.id);
  const [{ data: gens }, { data: paid }] = await Promise.all([
    supabase
      .from("generations")
      .select("id, job_id, cv, diff, simulation, template, is_sample")
      .eq("user_id", user.id)
      .eq("revision_number", 0)
      .in("job_id", ids),
    supabase
      .from("purchases")
      .select("job_id, tier")
      .eq("user_id", user.id)
      .eq("status", "paid")
      .in("job_id", ids),
  ]);

  const jobBy = new Map(jobs.map((j) => [j.id, j]));
  const tierBy = new Map((paid ?? []).map((p) => [p.job_id, p.tier as string]));

  const documents = (gens ?? [])
    .filter((g) => !g.is_sample)
    .map((g) => {
      const job = jobBy.get(g.job_id as string);
      // Job Match owns the CV alone — its interview report is not a file the
      // buyer paid for, so it must not travel to the client as a print target.
      const includeReport = tierBy.get(g.job_id as string) === "full";
      return {
        jobId: g.job_id as string,
        generationId: g.id as string,
        title: job?.title ?? "",
        company: job?.company ?? "",
        template: (g.template as string) ?? "classic",
        cv: TailoredCvSchema.parse(g.cv),
        diff: DiffReportSchema.parse(g.diff),
        simulation: includeReport
          ? InterviewSimulationSchema.parse(g.simulation ?? {})
          : null,
      };
    });

  return NextResponse.json(
    { documents },
    { headers: { "Cache-Control": "no-store" } }
  );
}
