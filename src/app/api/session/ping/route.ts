import { NextResponse } from "next/server";
import { touchVisit } from "@/lib/visitor-server";

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
  await touchVisit(request);
  return new NextResponse(null, { status: 204 });
}
