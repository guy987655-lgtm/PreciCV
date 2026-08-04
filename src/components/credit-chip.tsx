"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCredits } from "@/lib/use-credits";

/**
 * The anchor every surface that sells credits carries, so "Add credits" can
 * always find the offer on the current page. Already the id used by the job
 * workspace's pricing block.
 */
export const UNLOCK_SECTION_ID = "unlock-pricing";

/**
 * The signed-in user's credit balance, always visible.
 *
 * Credits were only ever mentioned on the pages that spend them, so nobody
 * knew what they held or where to get more. Hover (desktop) or tap (touch)
 * opens the detail, and Add credits goes to the offer on this page when there
 * is one — scrolling beats a navigation that loses the user's place.
 */
export function CreditChip({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const { balance, loaded } = useCredits(enabled);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Nothing until the balance is known: a chip that says 0 and then corrects
  // itself reads as "you have none", which is the one thing it must not do.
  if (!enabled || !loaded) return null;

  const total = balance.total;

  function addCredits() {
    setOpen(false);
    const section = document.getElementById(UNLOCK_SECTION_ID);
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    // No offer on this page — History is where every job, and every unlock
    // option, is reachable from.
    router.push("/history");
  }

  return (
    <div
      ref={ref}
      className="relative print:hidden"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${total} unlock credit${total === 1 ? "" : "s"}`}
        className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[13.5px] font-bold transition-colors ${
          total > 0
            ? "bg-green-50 text-accent-deep hover:bg-green-100"
            : "bg-chip text-ink-soft hover:bg-selected-bg"
        }`}
      >
        <span aria-hidden>◈</span>
        {total}
        <span className="hidden sm:inline">
          credit{total === 1 ? "" : "s"}
        </span>
      </button>

      {open && (
        /* No margin between the button and the card: a gap would break the
           hover as the pointer crosses it. The padding does the spacing. */
        <div className="absolute right-0 z-50 w-64 pt-2">
          <div className="overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-[0_12px_40px_rgba(30,43,36,0.18)]">
            <p className="font-display text-[22px] font-extrabold text-ink">
              {total}{" "}
              <span className="font-sans text-[14px] font-semibold text-ink-soft">
                credit{total === 1 ? "" : "s"} left
              </span>
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-faint">
              {total > 0
                ? "One credit unlocks one job — its tailored CV and the interview report."
                : "A credit unlocks one job: its tailored CV and the interview report."}
            </p>
            <button
              onClick={addCredits}
              className="mt-3 w-full cursor-pointer rounded-full bg-accent px-4 py-2 text-[13.5px] font-bold text-white transition-opacity hover:opacity-90"
            >
              Add credits
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
