import { NextResponse } from "next/server";
import { z } from "zod";
import { MasterProfileSchema, TailoredCvSchema } from "@/lib/types";
import {
  regenerateReport,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";

export const maxDuration = 300;

const BodySchema = z.object({
  cv: TailoredCvSchema,
  jdText: z.string().min(1),
  baseCv: TailoredCvSchema.optional(),
  /** Original uploaded-resume data — the Change Report's diff base (§2.4). */
  profile: MasterProfileSchema.optional(),
});

/**
 * Anonymous funnel: rebuilds the change report + interview simulation around an
 * already-edited CV, without re-tailoring the CV. The per-flow regen quota is
 * tracked client-side. Nothing is stored server-side.
 */
export async function POST(request: Request) {
  if (!llmConfigured()) {
    return NextResponse.json({ error: LLM_NOT_CONFIGURED_MSG }, { status: 503 });
  }
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  try {
    // §2.4 trace — confirms the EDITED resume state reached the backend.
    const { cv } = parsed.data;
    console.log(
      `[report-regen] payload: sections=${cv.sections.length} ` +
        `items=${cv.sections.reduce((n, s) => n + s.items.length, 0)} ` +
        `chars=${JSON.stringify(cv).length} summary="${cv.summary.slice(0, 60)}…"`
    );
    const report = await regenerateReport(parsed.data.cv, parsed.data.jdText, {
      baseCv: parsed.data.baseCv,
      profile: parsed.data.profile,
    });
    console.log(
      `[report-regen] result: changes=${report.diff.changes.length} ` +
        `strengths=${report.diff.gapAnalysis.strengths.length} ` +
        `questions=${report.simulation.questions.length}`
    );
    return NextResponse.json(report);
  } catch (e) {
    console.error("try/report failed:", e);
    return NextResponse.json(
      { error: "Report regeneration failed. Please try again in a moment." },
      { status: 502 }
    );
  }
}
