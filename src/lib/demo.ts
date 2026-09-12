/**
 * The /demo pages are a public, fixture-only surface (the portfolio site screenshots and embeds
 * them). Nothing on them may count as a visit, identify a user, or read a real account — so the
 * proxy, the visit beacon and both analytics layers check this before doing anything.
 */
export function isDemoPath(pathname: string | null | undefined): boolean {
  return !!pathname && (pathname === "/demo" || pathname.startsWith("/demo/"));
}
