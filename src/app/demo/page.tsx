import Link from "next/link";
import { JobWorkspace } from "../jobs/[id]/workspace";
import { demoCv, demoDiff, demoHits } from "./demo-data";

/**
 * DEMO ONLY — renders the paid (Premium) Review Workspace with mock data
 * so the experience can be previewed without Supabase/Stripe/Anthropic
 * keys. See /demo/sample for the free-sample (watermarked) state.
 */
export default function DemoPage() {
  return (
    <div>
      <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 print:hidden">
        🎭 Demo mode — this is the <strong>paid (Full Prep)</strong> workspace with sample
        data. Inline edits won&apos;t persist.{" "}
        <Link href="/demo/sample" className="underline">
          See the free-sample view
        </Link>{" "}
        ·{" "}
        <Link href="/" className="underline">
          Back to site
        </Link>
      </div>
      <JobWorkspace
        job={{
          id: "00000000-0000-0000-0000-000000000000",
          title: "Senior Frontend Engineer",
          company: "Acme Cloud",
          dealbreakerHits: demoHits,
        }}
        purchase={{ tier: "full", revisionsUsed: 2, maxRevisions: 10 }}
        generation={{
          id: "00000000-0000-0000-0000-000000000001",
          cv: demoCv,
          diff: demoDiff,
          template: "classic",
          revisionNumber: 2,
        }}
      />
    </div>
  );
}
