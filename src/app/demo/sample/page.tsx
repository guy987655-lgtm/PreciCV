import Link from "next/link";
import { JobWorkspace } from "../../jobs/[id]/workspace";
import { demoCv, demoDiff } from "../demo-data";

/**
 * DEMO ONLY — the one-time FREE SAMPLE state: a real generated CV shown
 * as a watermarked, non-downloadable, non-editable preview with an
 * upgrade CTA underneath.
 */
export default function DemoSamplePage() {
  return (
    <div>
      <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 print:hidden">
        🎭 Demo mode — this is the <strong>free sample (limited preview)</strong> state.{" "}
        <Link href="/demo" className="underline">
          See the paid workspace
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
          dealbreakerHits: [],
        }}
        purchase={null}
        generation={{
          id: "00000000-0000-0000-0000-000000000002",
          cv: demoCv,
          diff: demoDiff,
          template: "classic",
          revisionNumber: 0,
          isSample: true,
        }}
        freeSampleAvailable={false}
      />
    </div>
  );
}
