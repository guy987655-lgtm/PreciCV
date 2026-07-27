import { NextResponse } from "next/server";

/**
 * One place for "the model call blew up" → a response the client can show.
 *
 * Generation is a 15–45s call to a third-party model. Without this, an
 * overloaded provider or a malformed JSON reply left the route handler to
 * throw, which reaches the browser as a bodyless 500 — the user sees a generic
 * "Server error (500)" and we lose the reason. `/api/try/generate` already did
 * this locally; `/api/generate` and `/api/revise` now share it.
 */
export function llmFailureResponse(where: string, e: unknown): NextResponse {
  console.error(`[${where}] generation failed:`, e);
  const raw = e instanceof Error ? e.message : "";
  // The provider's own capacity wording is more useful to the user than a
  // generic apology ("overloaded, try again"), so pass it through.
  const transient = /overload|rate.?limit|429|503|timed? ?out/i.test(raw);
  return NextResponse.json(
    {
      error: transient
        ? raw
        : "Generation failed. Please try again in a moment — you have not been charged for this attempt.",
      retryable: true,
    },
    { status: 502 }
  );
}
