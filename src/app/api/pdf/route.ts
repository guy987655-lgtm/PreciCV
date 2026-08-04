import { NextResponse } from "next/server";
import { PrintDocSchema, pdfFileName } from "@/lib/pdf-doc";
import { PdfRenderError, renderPdf } from "@/lib/pdf-render";
import { checkDailyQuota } from "@/lib/rate-limit";

/** Chrome's cold start plus a slow layout; well under the platform ceiling. */
export const maxDuration = 60;

/**
 * A generous ceiling — a five-job run is ten files, and a user may reasonably
 * re-download after editing. It exists to bound the cost of an open rendering
 * endpoint, not to ration normal use.
 */
const DAILY_PDF_LIMIT = 200;

/**
 * Turn a document into an ATS-parseable PDF.
 *
 * Replaces the browser print dialog, which was the product's only export path
 * and a real trap: on a Mac with no printer configured its Print button is
 * disabled outright, so the file the user had just paid for could not be
 * saved at all.
 *
 * The document travels in the request rather than being looked up by id.
 * That is what lets the anonymous funnel and History — whose CVs live only in
 * localStorage — use the same endpoint as the signed-in workspaces. It also
 * means this route hands back only what the caller already had.
 */
export async function POST(request: Request) {
  const quota = checkDailyQuota(request, DAILY_PDF_LIMIT, "pdf");
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: "daily_limit_reached",
        message:
          "You've hit today's download limit. It resets in a few hours — your files are still here.",
      },
      { status: 429, headers: { "Set-Cookie": quota.cookieHeader } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const parsed = PrintDocSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const doc = parsed.data;

  // The report is built from the change analysis; without it there is no
  // second file to hand over (the CV path does not need either field).
  if (doc.target === "report" && !doc.diff) {
    return NextResponse.json(
      { error: "This report has no change analysis to print." },
      { status: 400 }
    );
  }

  const baseUrl =
    process.env.PDF_BASE_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin;

  try {
    const pdf = await renderPdf(doc, baseUrl);
    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        // `attachment` is the whole point: the browser saves the file instead
        // of opening a viewer, and the name is the one the user expects.
        "Content-Disposition": `attachment; filename="${pdfFileName(
          doc.target,
          doc.meta
        )}"`,
        "Cache-Control": "no-store",
        "Set-Cookie": quota.commit(),
      },
    });
  } catch (e) {
    console.error("[api/pdf] render failed:", e);
    return NextResponse.json(
      {
        error:
          e instanceof PdfRenderError
            ? "We couldn't build your PDF. Please try again in a moment."
            : "Download failed. Please try again in a moment.",
        /**
         * The renderer only ever fails on the serverless path, which cannot be
         * exercised locally — the first failure was diagnosed by guesswork
         * against a generic sentence. Preview deployments say what actually
         * broke; production keeps its own counsel.
         */
        ...(process.env.VERCEL_ENV === "preview"
          ? { reason: e instanceof Error ? e.message : String(e) }
          : {}),
      },
      { status: 502 }
    );
  }
}
