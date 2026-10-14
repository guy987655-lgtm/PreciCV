/**
 * The optional portfolio link printed on every CV as a QR code under a
 * clickable "View my portfolio" heading.
 *
 * Deliberately a pure module — no localStorage, no next/headers — so the
 * client field and /api/account/preferences validate with the same rules.
 */

/** Mirrors the check constraint on profiles.portfolio_url (0024). */
export const PORTFOLIO_URL_MAX = 300;

/**
 * Turns what a user typed into a link that is safe to print and to put in an
 * href, or null when it is not a web address.
 *
 * "yourname.com" gains https://, since nobody types the scheme; anything with
 * a scheme other than http(s) is refused, which keeps `javascript:` out of the
 * CV's <a href>. A bare origin drops its trailing slash: every character
 * saved makes the QR a little less dense.
 */
export function normalizePortfolioUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(text);
  if (hasScheme && !/^https?:\/\//i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname;
  // A dot rules out "localhost" and typos like "https://portfolio"; userinfo
  // is how a link disguises where it really goes.
  if (!host.includes(".") || host.endsWith(".")) return null;
  if (url.username || url.password) return null;
  const out =
    url.pathname === "/" && !url.search && !url.hash ? url.origin : url.href;
  return out.length <= PORTFOLIO_URL_MAX ? out : null;
}

/** The link as people read it: no scheme, no trailing slash. */
export function portfolioLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}
