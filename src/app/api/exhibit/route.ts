import manifest from "./exhibit.json";

/**
 * GET /api/exhibit — the manifest the portfolio site reads (headline, neutral facts, highlights,
 * and the /demo routes it may screenshot). Public and static; contains no user data.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(manifest, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
