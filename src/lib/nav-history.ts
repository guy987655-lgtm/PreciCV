"use client";

/**
 * Whether going "back" would stay inside the app.
 *
 * `router.back()` on its own is not safe to offer: on a cold landing — a
 * shared link, a bookmark, the redirect back from checkout, or any hard reload
 * — the previous history entry belongs to somebody else's site, and Back walks
 * the user straight out of the product. That is the bug this exists to prevent.
 *
 * So the depth of in-app history is tracked explicitly. Two rules make the
 * count honest, and both were mistakes worth writing down:
 *
 * 1. The FIRST route seen in a tab is a landing, not a navigation. Counting it
 *    (every page mounts the navbar, including on a cold load) would claim
 *    history that does not exist — exactly the accidental exit this prevents.
 * 2. A back/forward navigation must decrement rather than increment, or every
 *    Back press would restore the depth it just consumed and the count would
 *    never reach zero. `popstate` is what tells the two apart.
 *
 * sessionStorage rather than a module variable: a hard reload wipes the module
 * but keeps the tab's history stack, and it is precisely then that the two
 * must still agree. It is per-tab, so a second tab starts honestly at zero.
 */

const DEPTH_KEY = "specv_nav_depth";
const PATH_KEY = "specv_nav_path";

/** Set by popstate, consumed by the next markNavigation. */
let sawPop = false;
let listening = false;

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    // Private mode / storage disabled — every landing reads as cold, so Back
    // falls back to an explicit parent route. Never wrong, just less clever.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* see read() */
  }
}

function depth(): number {
  return Number(read(DEPTH_KEY)) || 0;
}

/**
 * Records a route change. Safe — and expected — to call on every pathname
 * change, including the first render of a cold landing.
 */
export function markNavigation(pathname: string): void {
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.addEventListener("popstate", () => {
      sawPop = true;
    });
  }

  const prev = read(PATH_KEY);
  write(PATH_KEY, pathname);

  // The landing itself, or a reload of the same route: no new history.
  if (prev === null || prev === pathname) return;

  if (sawPop) {
    sawPop = false;
    write(DEPTH_KEY, String(Math.max(0, depth() - 1)));
    return;
  }
  write(DEPTH_KEY, String(depth() + 1));
}

/** True when there is an in-app page behind this one. */
export function canGoBack(): boolean {
  return depth() > 0;
}
