"use client";

import { useState } from "react";
import {
  SIM_STATUSES,
  applySimStatus,
  simEnabled,
  simMeta,
  useSimUser,
} from "@/lib/sim-user";

/**
 * DEV/TEST ONLY — floating bottom-left User Status Selector covering the 5
 * valid user states. Picking a state clears all session data, injects the
 * matching mock data, and hard-redirects to the homepage. Hidden in
 * production unless NEXT_PUBLIC_DEV_TOOLS=true.
 */
export function DevUserSimulator() {
  const status = useSimUser();
  const [open, setOpen] = useState(false);
  if (!simEnabled()) return null;

  const current = simMeta(status);

  return (
    <div className="fixed bottom-4 left-4 z-[70] print:hidden">
      {open && (
        <div className="mb-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Simulate user state (dev only) — resets session
          </p>
          {SIM_STATUSES.map((s) => (
            <button
              key={s.id}
              onClick={() => applySimStatus(s.id)}
              className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                s.id === status
                  ? "bg-indigo-50 font-medium text-indigo-700"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span>{s.icon}</span>
              {s.label}
              {s.id === status && <span className="ml-auto">✓</span>}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-2 rounded-full border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900 shadow-lg transition-colors hover:bg-amber-200"
      >
        🧪 {current.icon} {current.label} {open ? "▾" : "▴"}
      </button>
    </div>
  );
}
