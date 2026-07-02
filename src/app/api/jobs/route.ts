import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { scanDealbreakers } from "@/lib/anthropic";
import { DealbreakerSchema } from "@/lib/types";

export const maxDuration = 60;

const BodySchema = z.object({
  jdText: z.string().min(100, "Job description is too short"),
  jdUrl: z.string().optional().default(""),
});

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
