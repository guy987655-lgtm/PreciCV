"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { resetAnalytics } from "@/lib/analytics";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="text-slate-500 hover:text-slate-800 cursor-pointer"
      onClick={async () => {
        await createClient().auth.signOut();
        resetAnalytics();
        router.push("/");
      }}
    >
      Sign out
    </button>
  );
}
