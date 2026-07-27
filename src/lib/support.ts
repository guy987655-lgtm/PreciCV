/**
 * The single support inbox shown to users — footer, legal pages and error
 * screens all read it from here so there is only one address to change.
 */
export const SUPPORT_EMAIL = "guy987655@gmail.com";

/** `mailto:` with a pre-filled subject, for "something broke" links. */
export function supportMailto(subject: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
