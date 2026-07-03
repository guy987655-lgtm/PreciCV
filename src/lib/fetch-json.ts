/**
 * Reads a fetch Response as JSON, but never throws on an empty/HTML error
 * body (e.g. a platform 500 page) — returns a readable error instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {
      error: res.ok
        ? "The server returned an unexpected response. Please try again."
        : `Server error (${res.status}). Please try again in a moment.`,
    };
  }
}
