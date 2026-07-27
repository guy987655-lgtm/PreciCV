"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { goHome, loadFunnel } from "@/lib/funnel";
import { useSession } from "@/lib/use-session";
import { createClient } from "@/lib/supabase/client";

/**
 * The shared top bar.
 *
 * There is no Home tab — the logo is the way home. Signed-in users get an
 * avatar menu holding History and My card; guests get a Log in link, so the
 * funnel never has to ask someone who is already signed in to register.
 * A resumable flow surfaces a Continue button here, so leaving the questions
 * or results page is recoverable from anywhere.
 */
export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { signedIn, user } = useSession();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A flow is resumable when a saved funnel already has a parsed profile.
  // The homepage has its own "Continue progress" button, so skip it there.
  const [resumable, setResumable] = useState(false);
  useEffect(() => {
    if (pathname === "/") {
      setResumable(false);
      return;
    }
    const f = loadFunnel();
    setResumable(Boolean(f?.profile));
  }, [pathname]);

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const initial = (user?.email?.trim()?.[0] ?? "?").toUpperCase();
  // Settings holds account deletion, and the privacy policy tells users to go
  // there. It used to be linked only from /dashboard, so removing that page
  // would have left the right-to-erasure control reachable by URL alone.
  const menuItems = [
    { href: "/history", label: "History" },
    { href: "/card", label: "My card" },
    { href: "/settings", label: "Settings" },
  ];

  async function signOut() {
    setMenuOpen(false);
    try {
      await createClient().auth.signOut();
    } catch {
      // Missing env or an already-dead session: fall through to the reload,
      // which lands on the homepage as a guest either way.
    }
    // Full reload rather than router.push: it drops every cached server
    // component holding the signed-in view.
    window.location.href = "/";
  }

  return (
    <nav className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-5 sm:px-14">
      <Link
        href="/"
        onClick={goHome}
        className="font-display text-[23px] font-extrabold tracking-tight text-ink"
      >
        Spe<span className="text-accent">CV</span>
      </Link>

      <div className="flex items-center gap-4 text-[15px] font-semibold sm:gap-5">
        {pathname === "/" && (
          <a
            href="#how-it-works"
            className="hidden text-ink-soft transition-colors hover:text-ink sm:block"
          >
            How it works
          </a>
        )}

        {resumable && (
          <button
            onClick={() => router.push("/")}
            className="cursor-pointer rounded-full bg-chip px-3.5 py-1.5 text-[13.5px] font-bold text-ink transition-colors hover:bg-selected-bg"
            title="Pick your flow back up where you left it"
          >
            Continue →
          </button>
        )}

        {signedIn ? (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
              title={user?.email ?? "Account"}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-accent text-[15px] font-extrabold text-white transition-opacity hover:opacity-90"
            >
              {initial}
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-2xl border border-border bg-card py-1 shadow-[0_12px_40px_rgba(30,43,36,0.18)]"
              >
                {user?.email && (
                  <p className="truncate border-b border-border px-4 pb-2 pt-1 text-[12.5px] text-ink-faint">
                    {user.email}
                  </p>
                )}
                {menuItems.map((m) => (
                  <Link
                    key={m.href}
                    href={m.href}
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className={`block px-4 py-2.5 text-[14.5px] transition-colors hover:bg-chip ${
                      pathname === m.href ? "font-bold text-ink" : "text-ink-soft"
                    }`}
                  >
                    {m.label}
                  </Link>
                ))}
                <button
                  role="menuitem"
                  onClick={signOut}
                  className="block w-full cursor-pointer border-t border-border px-4 py-2.5 text-left text-[14.5px] text-ink-soft transition-colors hover:bg-chip"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link
            href={`/login?next=${encodeURIComponent(
              pathname === "/login" ? "/" : pathname
            )}`}
            className="text-ink-soft transition-colors hover:text-ink"
          >
            Log in
          </Link>
        )}
      </div>
    </nav>
  );
}
