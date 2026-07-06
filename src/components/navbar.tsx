"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { goHome } from "@/lib/funnel";

/**
 * The shared top navigation: Home (logo + explicit tab), My card and
 * History. Home always shows the homepage hero — the active flow is kept
 * and resumable via the hero's "Continue progress" button (see goHome).
 */
export function Navbar() {
  const pathname = usePathname();
  const tabs = [
    { href: "/", label: "Home" },
    { href: "/card", label: "My card" },
    { href: "/history", label: "History" },
  ];
  return (
    <nav className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-5 sm:px-14">
      <Link
        href="/"
        onClick={goHome}
        className="font-display text-[23px] font-extrabold tracking-tight text-ink"
      >
        Spe<span className="text-accent">CV</span>
      </Link>
      <div className="flex items-center gap-5 text-[15px] font-semibold sm:gap-6">
        {pathname === "/" && (
          <a
            href="#how-it-works"
            className="hidden text-ink-soft transition-colors hover:text-ink sm:block"
          >
            How it works
          </a>
        )}
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            onClick={t.href === "/" ? goHome : undefined}
            className={
              pathname === t.href
                ? "text-ink underline decoration-accent decoration-2 underline-offset-8"
                : "text-ink-soft transition-colors hover:text-ink"
            }
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
