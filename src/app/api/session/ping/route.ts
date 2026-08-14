import { NextResponse } from "next/server";
import { z } from "zod";
import { touchVisit } from "@/lib/visitor-server";

/**
 * The page describes itself, because this request cannot: its URL is this
 * route and its Referer is the page that called it. Bounded and same-origin-
 * checked — these values reach the analytics tables, so a hostile client
 * should not be able to stuff them with arbitrary length or content.
 */
const BodySchema = z.object({
  path: z.string().max(512).optional(),
  search: z.string().max(1024).optional(),
  referrer: z.string().max(2048).optional(),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opens or extends the current visit.
 *
 * This is the ONLY thing that creates a visit row from a page view, and that is
 * the bot filter: a crawler receives a visitor cookie from the proxy like
 * everyone else, but it never runs JavaScript, so it never pings and never
 * becomes a visit. Free, and stronger than any User-Agent blocklist. API routes
 * can still open a visit (record_funnel_event passes server_created), so an
 * API-first session stays countable rather than invisible — it is just flagged.
 *
 * The path is deliberately bland. /api/track or /api/analytics is on every
 * blocklist an extension ships with, and a blocked beacon does not fail loudly,
 * it just quietly undercounts.
 *
 * 204: there is nothing for the client to do with the answer.
 */
export async function POST(request: Request) {
  // A malformed or absent body is not an error worth reporting — the visit
  // still counts, it just lands with less context than it could have.
  let page;
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (parsed.success) page = parsed.data;
  } catch {
    // no body, or not JSON
  }

  await touchVisit(request, page);
  return new NextResponse(null, { status: 204 });
}
