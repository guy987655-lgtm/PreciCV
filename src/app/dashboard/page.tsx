import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card } from "@/components/ui";
import { NewJobForm } from "./new-job-form";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarded, master_data")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.onboarded) redirect("/onboarding");

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title, company, status, created_at, dealbreaker_hits")
    .order("created_at", { ascending: false });

  const fullName =
    (profile.master_data as { contact?: { fullName?: string } })?.contact
      ?.fullName ?? "";

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {fullName ? `Welcome back, ${fullName.split(" ")[0]}` : "Dashboard"}
          </h1>
          <p className="text-sm text-slate-500">
            Paste a job description to generate a tailored one-page CV.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/settings" className="text-slate-500 hover:text-slate-800">
            Settings
          </Link>
          <SignOutButton />
        </div>
      </header>

      <NewJobForm />

      <h2 className="mt-10 text-lg font-semibold text-slate-900">Your jobs</h2>
      <div className="mt-4 space-y-3">
        {(jobs ?? []).length === 0 && (
          <Card className="p-6 text-sm text-slate-500">
            No jobs yet — add your first job description above.
          </Card>
        )}
        {(jobs ?? []).map((job) => {
          const hits = (job.dealbreaker_hits as unknown[]) ?? [];
          return (
            <Link key={job.id} href={`/jobs/${job.id}`} className="block">
              <Card className="flex items-center justify-between p-4 transition-shadow hover:shadow-md">
                <div>
                  <p className="font-medium text-slate-900">
                    {job.title || "Untitled role"}
                    {job.company ? (
                      <span className="text-slate-500"> · {job.company}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-400">
                    {new Date(job.created_at).toLocaleDateString("en-US", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {hits.length > 0 && <Badge tone="red">⚑ red flag</Badge>}
                  <Badge tone={job.status === "generated" ? "green" : "slate"}>
                    {job.status === "generated" ? "CV ready" : "awaiting generation"}
                  </Badge>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
