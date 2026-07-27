"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { trackButtonClick } from "@/lib/analytics";
import {
  CvTemplate,
  DealbreakerHit,
  DiffReport,
  InterviewSimulation,
  MAX_REPORT_REGENS,
  MAX_REWRITES,
  RewriteLength,
  TailoredCv,
  TIERS,
  TierId,
  UPGRADE_ANCHOR_USD,
} from "@/lib/types";
import {
  CvVersion,
  VersionKind,
  appendVersion,
  makeVersion,
} from "@/lib/cv-session";
import { effectiveSplit } from "@/lib/templates";
import { printBoth, printFile } from "@/lib/download";
import { Badge, Button, Card, Modal, Spinner, Textarea, Toast } from "@/components/ui";
import { Navbar } from "@/components/navbar";
import { CvRenderer, CvTheme } from "@/components/cv-renderer";
import { DiffChangeLines } from "@/components/diff-change";
import { Paywall } from "@/components/paywall";
import { ReportPage } from "@/components/report-page";
import { TemplateCatalog } from "@/components/template-catalog";
import {
  AiSectionToggle,
  CvToolbar,
  DisplayReviewButton,
  RefreshReportButton,
  SplitToggle,
  ThemeToggle,
  ToolbarDivider,
  EditToolbar,
} from "@/components/cv-controls";
import { FullScreenCv } from "@/components/full-screen-cv";
import {
  RESULTS_TOUR_KEY,
  RESULTS_TOUR_STEPS,
  ResultsTour,
} from "@/components/results-tour";
import { RewriteTooltip } from "@/components/rewrite-tooltip";
import { VersionStrip } from "@/components/version-strip";
import { TONE_META } from "@/components/interview-faces";

type Props = {
  job: {
    id: string;
    title: string;
    company: string;
    dealbreakerHits: DealbreakerHit[];
  };
  purchase: {
    tier: TierId;
    revisionsUsed: number;
    maxRevisions: number;
    rewritesUsed?: number;
    maxRewrites?: number;
    regensUsed?: number;
    maxRegens?: number;
  } | null;
  generation: {
    id: string;
    cv: TailoredCv;
    diff: DiffReport;
    simulation?: InterviewSimulation;
    template: string;
    revisionNumber: number;
    isSample?: boolean;
    reportStale?: boolean;
    cvTheme?: CvTheme;
    splitView?: boolean;
  } | null;
  freeSampleAvailable?: boolean;
  /** Arrived here straight from checkout (?paid=…). */
  justPaid?: boolean;
};

/**
 * The free sample shows the WHOLE tailored CV, but every section is cut in
 * half behind a watermark: the top half reads clearly, the bottom half is
 * blurred until purchase (SampleLockOverlay). Splitting per section rather
 * than once down the page keeps the teaser honest in every layout — a
 * two-column design used to leave nearly everything readable.
 */

/** One blurred band, as percentages of the CV sheet it is laid over. */
type BlurBand = { top: number; left: number; width: number; height: number };

/** Sheet has no measurable sections (custom layout): blur its lower half. */
const FALLBACK_BANDS: BlurBand[] = [
  { top: 42, left: 0, width: 100, height: 58 },
];

/** Blurs the bottom half of every measured section of the sample CV. */
function SampleLockOverlay({ bands }: { bands: BlurBand[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 print:hidden">
      {bands.map((b, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            top: `${b.top}%`,
            left: `${b.left}%`,
            width: `${b.width}%`,
            height: `${b.height}%`,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            maskImage: "linear-gradient(to bottom, transparent 0%, black 30%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, black 30%)",
            background:
              "linear-gradient(to bottom, rgba(248,250,252,0) 0%, rgba(248,250,252,0.5) 60%, rgba(248,250,252,0.72) 100%)",
          }}
        />
      ))}
      <div className="absolute inset-x-0 bottom-7 flex justify-center">
        <span className="rounded-full bg-slate-900/85 px-4 py-2 text-sm font-semibold text-white shadow-lg">
          🔒 Unlock to read every section in full
        </span>
      </div>
    </div>
  );
}

/**
 * Free-sample teaser list: the first `clear` items read normally, the rest
 * render blurred + unselectable so the value is visible but locked.
 */
function TeaserList({
  items,
  clear = 1,
  sample,
}: {
  items: string[];
  clear?: number;
  sample: boolean;
}) {
  const shown = sample ? items.slice(0, clear) : items;
  const blurred = sample ? items.slice(clear) : [];
  return (
    <>
      <ul className="mt-1 list-disc pl-4 text-sm text-slate-600">
        {shown.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
      {blurred.length > 0 && (
        <ul
          aria-hidden
          className="mt-0.5 list-disc select-none pl-4 text-sm text-slate-600 blur-[4px]"
        >
          {blurred.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Diagonal repeated watermark for the locked free-sample preview. */
function SampleWatermark() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <div className="flex h-full w-full -rotate-30 flex-col justify-around opacity-[0.13]">
        {Array.from({ length: 12 }).map((_, row) => (
          <div key={row} className="flex justify-around whitespace-nowrap">
            {Array.from({ length: 4 }).map((_, col) => (
              <span key={col} className="text-3xl font-black text-indigo-900">
                SpeCV · PREVIEW
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function JobWorkspace({
  job,
  purchase,
  generation: initialGen,
  freeSampleAvailable = false,
  justPaid = false,
}: Props) {
  const router = useRouter();
  const [generation, setGeneration] = useState(initialGen);
  // Start in the generating state when we'll auto-run the sample on arrival,
  // so the loading spinner shows immediately (no flash of the intro card).
  // Mirrors the auto-run below, so the spinner is up on first paint instead
  // of flashing the intro/"ready to tailor" card first.
  const [busy, setBusy] = useState<"" | "checkout" | "generate" | "revise">(
    !initialGen && (purchase || freeSampleAvailable) ? "generate" : ""
  );
  const [error, setError] = useState("");
  const [redFlagModal, setRedFlagModal] = useState(false);
  const [pendingSample, setPendingSample] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [reviseText, setReviseText] = useState("");
  const [revisionsUsed, setRevisionsUsed] = useState(purchase?.revisionsUsed ?? 0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  // The user reviews + edits first; files (PDF export) unlock on approval.
  const [approved, setApproved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared Results UX (mirrors the anonymous funnel): design catalog, split /
  // theme preview, inline edit + AI rewrite, report regen, milestone versions.
  // Theme + split hydrate from the generation row and persist on change, so
  // the view restores exactly across visits (PRD v2 Topic 3).
  const [cvTheme, setCvThemeState] = useState<CvTheme>(
    initialGen?.cvTheme ?? "light"
  );
  const [splitView, setSplitViewState] = useState(
    initialGen?.splitView ?? false
  );
  const [editing, setEditing] = useState(false);
  // Full-screen CV review: the whole sheet at once, scaled to fit.
  const [fullScreen, setFullScreen] = useState(false);
  /**
   * First-visit spotlight tour of the results controls. It shares
   * RESULTS_TOUR_KEY with the funnel so a browser only ever sees it once —
   * and this is where real users actually land, since the funnel gates them
   * into signing up before its own results view.
   */
  const [showTour, setShowTour] = useState(false);
  const endTour = useCallback(() => {
    setShowTour(false);
    try {
      localStorage.setItem(RESULTS_TOUR_KEY, "1");
    } catch {
      /* private mode */
    }
  }, []);
  const [reportBusy, setReportBusy] = useState(false);
  const [printRequest, setPrintRequest] = useState(false);
  const [reportStale, setReportStale] = useState(
    Boolean(initialGen?.reportStale)
  );
  const [rewritesUsed, setRewritesUsed] = useState(purchase?.rewritesUsed ?? 0);
  const [regensUsed, setRegensUsed] = useState(purchase?.regensUsed ?? 0);
  const cvPreviewRef = useRef<HTMLDivElement>(null);
  // The scaled CV sheet — measured to cut each section in half for the sample.
  const cvSheetRef = useRef<HTMLDivElement>(null);
  const [blurBands, setBlurBands] = useState<BlurBand[]>(FALLBACK_BANDS);
  // "Refresh report" scrolls here and fades it while rebuilding (Topic 8).
  const reportSectionsRef = useRef<HTMLDivElement>(null);
  // §2.2 — lastSavedState snapshot taken on entering Edit Mode; isDirty
  // compares against it and Reset restores it exactly.
  const [editSnapshot, setEditSnapshot] = useState<{
    json: string;
    cv: TailoredCv;
    reportStale: boolean;
  } | null>(null);
  // Undo window for the (now instant) Reset (PRD v2 Topic 6).
  const [resetUndo, setResetUndo] = useState<{
    cv: TailoredCv;
    reportStale: boolean;
  } | null>(null);
  const resetToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest inline edit not yet flushed to the server (debounced save).
  const pendingSave = useRef<{ cv: TailoredCv; template?: string } | null>(
    null
  );
  // In-session milestone versions, seeded with the CV as loaded (the reset
  // baseline). Server persists each revision as its own generations row.
  const [versions, setVersions] = useState<CvVersion[]>(() =>
    initialGen && !initialGen.isSample
      ? [
          makeVersion("original", {
            cv: initialGen.cv,
            diff: initialGen.diff,
            simulation: initialGen.simulation,
            template: (initialGen.template as CvTemplate) ?? "classic",
          }),
        ]
      : []
  );
  const maxRewrites = purchase?.maxRewrites ?? MAX_REWRITES;
  const maxRegens = purchase?.maxRegens ?? MAX_REPORT_REGENS;

  // §2.2 isDirty — true from the first change relative to lastSavedState.
  const isDirty =
    editing &&
    editSnapshot !== null &&
    generation !== null &&
    JSON.stringify(generation.cv) !== editSnapshot.json;

  const hits = job.dealbreakerHits;
  const isSample = Boolean(generation?.isSample);
  // Free sample keeps the first change readable; the rest render blurred.
  const SAMPLE_CLEAR_CHANGES = 1;
  // match → full upgrade: charge only the difference ($1), anchored to $2.
  const upgradeUsd = (TIERS.full.priceCents - TIERS.match.priceCents) / 100;
  const canUpgrade = purchase?.tier === "match" && !isSample;
  /**
   * The interview simulation is always generated and stored, whatever the
   * tier — so it can be shown as a real, mostly-blurred teaser to everyone who
   * has not bought Full Prep. That makes the section itself the driver for the
   * +$1 upgrade instead of a feature nobody knows exists.
   */
  const simLocked = isSample || purchase?.tier === "match";
  /**
   * What the export button actually produces. Job Match owns the CV only —
   * its interview report is never mounted as a print target, so promising
   * "2 PDFs" handed that tier a second, empty file.
   */
  const exportLabel = simLocked ? "Export CV (PDF)" : "Export my files (2 PDFs)";
  /** Questions left fully readable while locked; the rest blur. */
  const SIM_CLEAR_QUESTIONS = 1;
  /** Is there simulation content to render a section for? */
  const hasSimulationSection = Boolean(
    generation?.simulation &&
      (generation.simulation.pitch ||
        generation.simulation.questions.length > 0)
  );

  /* ---------------- payment ---------------- */
  // `isUpgrade` only shapes analytics — the server detects the paid `match`
  // row on this job and charges the $1 difference for a `full` checkout.
  async function checkout(tier: TierId, isUpgrade = false) {
    setBusy("checkout");
    setError("");
    trackButtonClick({
      button_name: isUpgrade ? "upgrade_to_full" : `buy_${tier}`,
      action: "checkout",
      button_text: isUpgrade ? "Upgrade to Full Prep" : `Buy ${TIERS[tier].name}`,
      click_source: "job_workspace",
      job_id: job.id,
    });
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, tier }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Checkout failed");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy("");
    }
  }

  /* ---------------- generation (paid credit or free sample) --------- */
  async function generate(
    acknowledged: boolean,
    asSample: boolean
  ): Promise<boolean> {
    if (hits.length > 0 && !acknowledged) {
      setPendingSample(asSample);
      setRedFlagModal(true);
      return false;
    }
    setRedFlagModal(false);
    setBusy("generate");
    setError("");
    trackButtonClick({
      button_name: asSample ? "generate_free_sample" : "generate_cv",
      action: "generate",
      button_text: asSample ? "Generate my free sample" : "Generate tailored CV",
      click_source: "job_workspace",
      job_id: job.id,
    });
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          acknowledgeRedFlags: acknowledged,
          useFreeSample: asSample,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        if (data.error === "payment_required") {
          throw new Error("Purchase a tier below to generate.");
        }
        throw new Error(data.message ?? data.error ?? "Generation failed");
      }
      setGeneration({
        id: data.generationId,
        cv: data.cv,
        diff: data.diff,
        // The API returns the simulation and it is persisted server-side —
        // dropping it here left the report print target out of the DOM, so
        // "download reports" produced an empty page until a page reload.
        simulation: data.simulation,
        template: data.template ?? generation?.template ?? "classic",
        revisionNumber: generation?.revisionNumber ?? 0,
        isSample: data.isSample ?? false,
        reportStale: false,
        cvTheme: generation?.cvTheme,
        splitView: generation?.splitView,
      });
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy("");
    }
  }

  // Nobody should have to press a button to see what they came for. Free
  // users get this job's sample auto-run on arrival; buyers returning from
  // checkout get the real thing auto-run the same way, so payment lands
  // straight on the CV. Runs once; a failure falls back to the button.
  const autoRunTried = useRef(false);
  useEffect(() => {
    if (generation || autoRunTried.current) return;
    if (!purchase && !freeSampleAvailable) return;
    autoRunTried.current = true;
    const asSample = !purchase;
    void (async () => {
      // One silent retry: the model occasionally returns malformed JSON, and
      // a single blip should not dump the user back onto a button after they
      // finished the questions (or paid).
      const ok = await generate(false, asSample);
      // Red flags stop generation on purpose (the modal is waiting on the
      // user) — that is not a failure to retry.
      if (!ok && hits.length === 0) await generate(false, asSample);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Paying already earned the full version — asking for one more click is
   * just a toll gate. Whenever a paid job is still showing its watermarked
   * sample, unlock it automatically: /api/generate flips is_sample in place
   * and returns the stored CV, so this costs no LLM call and no credit.
   *
   * Keyed on the purchase/sample state rather than mount, because arriving
   * from checkout usually means the purchase lands a moment later (see the
   * webhook wait below) — the unlock has to fire on that transition too.
   */
  const autoUnlockTried = useRef(false);
  useEffect(() => {
    if (!purchase || !generation?.isSample || autoUnlockTried.current) return;
    autoUnlockTried.current = true;
    // acknowledged: true — red flags were already accepted to reach a
    // generation, and this path creates no new content to warn about.
    void generate(true, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchase, generation?.isSample]);

  /**
   * Lemon Squeezy confirms payment out-of-band, so landing on ?paid=1 often
   * beats the webhook by a second or two. Re-fetch the server component
   * until the purchase row appears instead of showing the pricing page to
   * somebody who just paid.
   */
  const [awaitingPayment, setAwaitingPayment] = useState(justPaid && !purchase);
  useEffect(() => {
    if (!justPaid) return;
    if (purchase) {
      setAwaitingPayment(false);
      // Drop ?paid so a reload can't replay any of this.
      router.replace(`/jobs/${job.id}`, { scroll: false });
      return;
    }
    let tries = 0;
    const timer = setInterval(() => {
      if (++tries > 10) {
        // ~20s with no webhook: stop spinning and let the page speak for
        // itself (the sample + pricing, or the fallback unlock banner).
        clearInterval(timer);
        setAwaitingPayment(false);
        return;
      }
      router.refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [justPaid, purchase, router, job.id]);

  // Cut every section of the sample in half: its top half stays readable, its
  // bottom half is blurred. Measured per section (and per column, since each
  // band carries its own left/width) so two-column designs lock as much as
  // single-column ones. Falls back to one lower-half band when a design
  // doesn't tag its sections.
  useEffect(() => {
    if (!isSample) return;
    const measure = () => {
      const sheet = cvSheetRef.current;
      if (!sheet) return;
      const sheetRect = sheet.getBoundingClientRect();
      if (sheetRect.height === 0 || sheetRect.width === 0) return;
      const bands = Array.from(
        sheet.querySelectorAll<HTMLElement>("[data-cv-section]")
      )
        .map((n) => {
          const r = n.getBoundingClientRect();
          const half = r.height / 2;
          return {
            top: ((r.top - sheetRect.top + half) / sheetRect.height) * 100,
            left: ((r.left - sheetRect.left) / sheetRect.width) * 100,
            width: (r.width / sheetRect.width) * 100,
            height: (half / sheetRect.height) * 100,
          };
        })
        // Skip slivers — a section too short to split reads as a smudge.
        .filter((b) => b.height > 0.6 && b.width > 0);
      setBlurBands(bands.length > 0 ? bands : FALLBACK_BANDS);
    };
    // Let the renderer's dynamic page-fill settle before measuring.
    const t = setTimeout(measure, 220);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [isSample, generation?.cv, generation?.template, cvTheme, splitView]);

  /* ---------------- AI revisions (premium) ---------------- */
  async function revise() {
    setBusy("revise");
    setError("");
    trackButtonClick({
      button_name: "request_revision",
      action: "revise",
      button_text: "Apply revision",
      click_source: "job_workspace",
      job_id: job.id,
    });
    try {
      const res = await fetch("/api/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, instructions: reviseText }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Revision failed");
      setGeneration({
        id: data.generationId,
        cv: data.cv,
        diff: data.diff,
        // Same as in generate(): keep the simulation so the report print
        // target stays mounted.
        simulation: data.simulation,
        template: generation?.template ?? "classic",
        revisionNumber: data.revisionNumber,
        isSample: false,
        reportStale: false,
        cvTheme: generation?.cvTheme,
        splitView: generation?.splitView,
      });
      setRevisionsUsed((n) => n + 1);
      setReviseOpen(false);
      setReviseText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy("");
    }
  }

  /* ---------------- inline edits: debounced save, no credits ---------- */
  const saveCv = useCallback(
    (next: TailoredCv, template?: string) => {
      if (!generation || isSample) return;
      setGeneration((g) => (g ? { ...g, cv: next, template: template ?? g.template } : g));
      setReportStale(true); // inline edits desync the stored report
      setSaveState("saving");
      pendingSave.current = { cv: next, template };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        pendingSave.current = null;
        await fetch(`/api/generations/${generation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cv: next, ...(template ? { template } : {}) }),
        });
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1500);
      }, 800);
    },
    [generation, isSample]
  );

  /** §3.1 — Done must PERSIST before external actions unlock: flush any
   *  pending debounced save immediately (also the §2.4 staleness guard —
   *  a report refresh right after Done always sees the edited CV). */
  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingSave.current;
    if (!pending || !generation) return;
    pendingSave.current = null;
    await fetch(`/api/generations/${generation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cv: pending.cv,
        ...(pending.template ? { template: pending.template } : {}),
      }),
    });
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 1500);
  }, [generation]);

  /** §2.2 — Edit Mode enter/exit. Entering snapshots lastSavedState; Done
   *  flushes the pending save and exits. */
  function toggleEdit(next: boolean) {
    if (next && generation) {
      setEditSnapshot({
        json: JSON.stringify(generation.cv),
        cv: JSON.parse(JSON.stringify(generation.cv)) as TailoredCv,
        reportStale,
      });
    }
    if (!next) {
      void flushSave();
      setEditSnapshot(null);
    }
    setEditing(next);
  }

  // Open the tour once the results are on screen. The delay lets the layout
  // and design catalog settle before the spotlight measures its targets.
  useEffect(() => {
    if (!generation) return;
    const t = setTimeout(() => {
      try {
        if (!localStorage.getItem(RESULTS_TOUR_KEY)) setShowTour(true);
      } catch {
        // Private mode — no tour flag, no tour.
      }
    }, 400);
    return () => clearTimeout(t);
  }, [generation]);

  // Deferred print: fire only once any smart-download report refresh has
  // finished AND rendered, so the printed report reflects the latest CV.
  useEffect(() => {
    if (!printRequest || reportBusy) return;
    if (generation && !isSample) {
      setVersions((vs) =>
        appendVersion(
          vs,
          makeVersion("download", {
            cv: generation.cv,
            diff: generation.diff,
            simulation: generation.simulation,
            template: (generation.template as CvTemplate) ?? "classic",
          })
        )
      );
    }
    // Job Match buys the CV only — printing "both" would hand it a second,
    // empty file since the report print target is not mounted for that tier.
    const meta = {
      name: generation?.cv.contact.fullName,
      company: job.company,
    };
    if (simLocked) printFile("cv", meta);
    else printBoth(meta);
    setPrintRequest(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printRequest, reportBusy]);

  async function setTemplate(t: CvTemplate) {
    if (!generation) return;
    setGeneration({ ...generation, template: t });
    // Free samples may taste every design, but never persist the choice.
    if (isSample) return;
    await fetch(`/api/generations/${generation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: t }),
    });
  }

  /** Persist a view preference on the generation row (like template). */
  function persistViewPref(pref: { cvTheme?: CvTheme; splitView?: boolean }) {
    if (!generation || isSample) return;
    void fetch(`/api/generations/${generation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pref),
    });
  }
  function setCvTheme(t: CvTheme) {
    setCvThemeState(t);
    persistViewPref({ cvTheme: t });
  }
  function setSplitView(next: boolean) {
    setSplitViewState(next);
    persistViewPref({ splitView: next });
  }

  /* ---------------- AI snippet rewrite (job-scoped quota) ---------- */
  async function handleRewrite(
    text: string,
    length: RewriteLength
  ): Promise<string> {
    if (rewritesUsed >= maxRewrites) throw new Error("Rewrite limit reached");
    const res = await fetch("/api/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, text, length }),
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(data.error ?? "Rewrite failed");
    setRewritesUsed(
      typeof data.rewritesUsed === "number" ? data.rewritesUsed : rewritesUsed + 1
    );
    return data.text as string;
  }

  /**
   * Rebuilds the report (diff + interview simulation) around the edited CV and
   * persists it server-side; records a milestone version. Returns true on
   * success. Bounded by maxRegens per job.
   */
  async function regenerateReportNow(
    kind: VersionKind = "regenerate"
  ): Promise<boolean> {
    if (!generation || isSample) return false;
    if (regensUsed >= maxRegens) {
      setError(`You've used all ${maxRegens} report refreshes for this job.`);
      return false;
    }
    setReportBusy(true);
    setError("");
    // Guide the eye to what is being rebuilt (PRD v2 Topic 8).
    reportSectionsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    try {
      const res = await fetch(`/api/generations/${generation.id}/report`, {
        method: "POST",
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Report refresh failed");
      setGeneration((g) =>
        g ? { ...g, diff: data.diff, simulation: data.simulation } : g
      );
      setRegensUsed(
        typeof data.regensUsed === "number" ? data.regensUsed : regensUsed + 1
      );
      setReportStale(false);
      setVersions((vs) => {
        if (!generation) return vs;
        return appendVersion(
          vs,
          makeVersion(kind, {
            cv: generation.cv,
            diff: data.diff,
            simulation: data.simulation,
            template: (generation.template as CvTemplate) ?? "classic",
          })
        );
      });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report refresh failed");
      return false;
    } finally {
      setReportBusy(false);
    }
  }

  /** §2.2 — Reset rolls back to the exact lastSavedState snapshot taken on
   *  entering Edit Mode, staying IN edit mode (§3.1 flow). Instant — no
   *  confirmation; the Undo toast is the safety net (PRD v2 Topic 6). */
  function resetCv() {
    if (!editSnapshot || !generation || isSample) return;
    const undo = { cv: generation.cv, reportStale };
    saveCv(editSnapshot.cv);
    // saveCv marks the report stale; a byte-for-byte rollback restores the
    // staleness the snapshot was taken with.
    setReportStale(editSnapshot.reportStale);
    setResetUndo(undo);
    if (resetToastTimer.current) clearTimeout(resetToastTimer.current);
    resetToastTimer.current = setTimeout(() => setResetUndo(null), 5000);
  }

  /** Reapply the state discarded by the last Reset (toast "Undo"). */
  function undoReset() {
    if (!resetUndo) return;
    saveCv(resetUndo.cv);
    setReportStale(resetUndo.reportStale);
    if (resetToastTimer.current) clearTimeout(resetToastTimer.current);
    setResetUndo(null);
  }

  function restoreVersion(v: CvVersion) {
    if (!generation || isSample) return;
    saveCv(v.cv, v.template);
    setGeneration((g) =>
      g
        ? { ...g, cv: v.cv, diff: v.diff, simulation: v.simulation ?? g.simulation }
        : g
    );
    setReportStale(false);
  }

  /**
   * Smart download: if the CV was edited since the last report build, refresh
   * the report FIRST so both files match, then print (CV + report bundle). The
   * print fires from an effect once the fresh report has rendered.
   */
  async function exportPdf() {
    trackButtonClick({
      button_name: "export_pdf",
      action: "export",
      button_text: "Export PDF",
      click_source: "job_workspace",
      job_id: job.id,
    });
    if (reportStale && regensUsed < maxRegens && !isSample) {
      await regenerateReportNow();
    }
    setPrintRequest(true);
  }

  // The workspace always has a job attached, so all three tiers are open.
  const tierCards = (
    <Paywall hasJob busy={busy === "checkout"} onSelect={checkout} />
  );

  /* ================= render ================= */

  return (
    <>
      {/* The shared top bar — same logo and tabs as the rest of the site
          (it used to be a bespoke text link, which read as a different brand). */}
      <div className="print:hidden">
        <Navbar />
      </div>
      <main className="mx-auto max-w-[1400px] px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {job.title || "Tailored CV"}
            {job.company && <span className="font-normal text-slate-500"> · {job.company}</span>}
          </h1>
        </div>
        {generation && !isSample && (
          <div className="flex items-center gap-3">
            {saveState !== "idle" && (
              <span className="text-xs text-slate-400">
                {saveState === "saving" ? "Saving…" : "Saved ✓"}
              </span>
            )}
            {approved && (
              <Button
                data-tour="download"
                disabled={reportBusy || editing}
                title={editing ? "Finish editing (Done) to export" : undefined}
                onClick={exportPdf}
              >
                {reportBusy ? "Syncing report…" : exportLabel}
              </Button>
            )}
          </div>
        )}
        {generation && isSample && (
          <div className="flex items-center gap-3">
            <Badge tone="amber">Free sample — preview only</Badge>
            {!awaitingPayment && (
            <Button
              size="md"
              onClick={() => {
                trackButtonClick({
                  button_name: "sample_unlock",
                  action: "navigate",
                  button_text: "Unlock full version",
                  click_source: "job_workspace",
                  job_id: job.id,
                });
                document
                  .getElementById("unlock-pricing")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              Unlock full version →
            </Button>
            )}
          </div>
        )}
      </header>

      {/* Approval gate: review & edit first, files unlock on approval */}
      {generation && !isSample && !approved && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-4 print:hidden">
          <p className="text-sm text-emerald-900">
            <strong>Review your tailored CV.</strong> Edit anything inline,
            keep or remove sections — or approve it as-is. Your final{" "}
            {simLocked ? "CV file is" : "files (CV + simulation report) are"}{" "}
            created after approval.
          </p>
          <Button
            size="lg"
            variant="success"
            onClick={() => {
              trackButtonClick({
                button_name: "approve_cv",
                action: "approve",
                button_text: "Approve CV",
                click_source: "job_workspace",
                job_id: job.id,
              });
              setApproved(true);
            }}
          >
            ✓ Approve CV &amp; create my files
          </Button>
        </div>
      )}
      {generation && !isSample && approved && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 print:hidden">
          <p className="text-sm text-emerald-900">
            <strong>Approved ✓</strong>{" "}
            {simLocked
              ? "Your tailored CV is ready to export as a PDF."
              : "Your final files are ready — the tailored CV and your interview simulation report, as two PDFs."}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setApproved(false)}>
              Keep editing
            </Button>
            <Button onClick={exportPdf}>{exportLabel}</Button>
          </div>
        </div>
      )}

      {/* Red-flag banner */}
      {hits.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 print:hidden">
          <p className="font-semibold text-red-800">⚑ Potential red flags detected</p>
          <ul className="mt-2 space-y-1 text-sm text-red-700">
            {hits.map((h, i) => (
              <li key={i}>
                <strong>{h.dealbreakerText}</strong> — JD says: “{h.evidence}”{" "}
                <Badge tone="red">{h.confidence}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* State 1: nothing generated yet — free users auto-generate the sample
          on arrival (mount effect above); a clean spinner shows meanwhile and
          the manual card is only the post-failure fallback. */}
      {!purchase && !generation && (
        <div className="mx-auto max-w-3xl space-y-6 print:hidden">
          {busy === "generate" ? (
            <Card className="p-10 text-center">
              <Spinner label="Building your free preview… (30–90 seconds)" />
            </Card>
          ) : (
            <>
              {freeSampleAvailable && (
                <Card className="border-2 border-emerald-300 bg-emerald-50/40 p-6 text-center">
                  <Badge tone="green">Free sample for this job</Badge>
                  <h2 className="mt-2 text-lg font-semibold text-slate-900">
                    See it before you pay
                  </h2>
                  <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                    Generate a real tailored CV for this job, shown as a
                    watermarked preview (not downloadable). Every job you add
                    gets one free preview.
                  </p>
                  <Button
                    size="lg"
                    variant="success"
                    className="mt-4"
                    onClick={() => generate(false, true)}
                  >
                    Generate my free sample
                  </Button>
                </Card>
              )}
              {tierCards}
            </>
          )}
        </div>
      )}

      {/* State 2: paid, not generated. Generation auto-starts on arrival, so
          this is normally just the loading state after checkout; the button is
          the fallback if that run failed. */}
      {purchase && !generation && (
        <Card className="mx-auto max-w-xl p-8 text-center print:hidden">
          <Badge tone="indigo">{TIERS[purchase.tier].name} tier active</Badge>
          {busy === "generate" ? (
            <div className="mt-4">
              <Spinner label="Tailoring your CV… (30–90 seconds)" />
            </div>
          ) : (
            <>
              <h2 className="mt-3 text-lg font-semibold text-slate-900">
                Ready to tailor your CV
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                We&apos;ll build a one-page CV tailored to this job from your
                Master Data Lake, plus a full change report.
              </p>
              <Button
                size="lg"
                className="mt-6"
                onClick={() => generate(false, false)}
              >
                Generate tailored CV
              </Button>
            </>
          )}
        </Card>
      )}

      {/* Waiting on the payment provider's webhook right after checkout. */}
      {awaitingPayment && (
        <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 print:hidden">
          <Spinner label="Confirming your payment… this takes a few seconds." />
        </div>
      )}

      {/* Paid while a sample exists → unlocking happens automatically (see the
          auto-unlock effect). This banner is the post-failure fallback. */}
      {purchase && generation && isSample && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 print:hidden">
          <p className="text-sm text-indigo-900">
            <strong>Payment received.</strong>{" "}
            {busy === "generate"
              ? "Unlocking your full version…"
              : "Unlock your CV to enable editing, templates and PDF export."}
          </p>
          {busy === "generate" ? (
            <Spinner />
          ) : (
            <Button onClick={() => generate(true, false)}>
              Unlock full version
            </Button>
          )}
        </div>
      )}

      {/* State 3: the Side-by-Side Review Workspace (PRD §5) */}
      {generation && (
        <div className="grid gap-6 lg:grid-cols-[minmax(320px,2fr)_3fr]">
          {/* Left pane: Diff Report — faded + inert while refreshing (Topic 8) */}
          <div
            ref={reportSectionsRef}
            className={`scroll-mt-20 space-y-4 transition-opacity duration-300 print:hidden ${
              reportBusy ? "pointer-events-none select-none opacity-25" : ""
            }`}
            aria-busy={reportBusy}
          >

            <Card className="p-5">
              <h2 className="font-semibold text-slate-900">
                Change report{" "}
                {generation.revisionNumber > 0 && (
                  <Badge tone="indigo">rev {generation.revisionNumber}</Badge>
                )}
              </h2>
              <div className="mt-3 space-y-3">
                {generation.diff.changes.map((c, i) => {
                  const locked = isSample && i >= SAMPLE_CLEAR_CHANGES;
                  return (
                    <div
                      key={i}
                      aria-hidden={locked}
                      className={`rounded-lg border border-slate-100 p-3 text-sm ${
                        locked ? "pointer-events-none select-none blur-[4px]" : ""
                      }`}
                    >
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                        {c.section} · {c.type}
                      </p>
                      <DiffChangeLines change={c} />
                      {c.reason && (
                        <p className="mt-1.5 text-xs italic text-slate-500">{c.reason}</p>
                      )}
                    </div>
                  );
                })}
                {isSample &&
                  generation.diff.changes.length > SAMPLE_CLEAR_CHANGES && (
                    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      🔒 Unlock to read all {generation.diff.changes.length}{" "}
                      changes.
                    </p>
                  )}
              </div>
            </Card>


            {/* AI revisions (Full Prep tier) */}
            {purchase && purchase.maxRevisions > 0 && !isSample && (
              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-slate-900">AI revisions</h2>
                  <span className="text-xs text-slate-500">
                    {revisionsUsed}/{purchase.maxRevisions} used
                  </span>
                </div>
                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  disabled={revisionsUsed >= purchase.maxRevisions}
                  onClick={() => setReviseOpen(true)}
                >
                  Request a revision
                </Button>
              </Card>
            )}

            {/* Upgrade match → full for the $1 difference (anchored to $2).
                Only when the simulation section below the CV is absent — that
                section carries the same CTA and shows what you actually get,
                so rendering both would be two buttons for one purchase. */}
            {canUpgrade && !hasSimulationSection && (
              <Card className="border-2 border-accent p-5 print:hidden">
                <h2 className="font-semibold text-slate-900">
                  Get interview-ready
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Add the interview simulation report and up to{" "}
                  {TIERS.full.maxRevisions} AI revisions.
                </p>
                <Button
                  variant="primary"
                  className="mt-3 w-full"
                  onClick={() => setUpgradeOpen(true)}
                >
                  Upgrade to Full Prep —{" "}
                  <span className="line-through opacity-70">
                    ${UPGRADE_ANCHOR_USD}
                  </span>{" "}
                  ${upgradeUsd}
                </Button>
              </Card>
            )}
          </div>

          {/* Right pane: the CV — editable when owned, watermarked when sample */}
          <div>
            {/* Design catalog — owned CVs AND free samples, so preview users
                can taste every design before paying. */}
            <div className="mb-3 flex flex-col gap-3 print:hidden">
              <p className="text-xs font-semibold text-ink-faint">
                {isSample
                  ? "Try 6 designs free — 🔒 unlock for the rest"
                  : "Choose a design"}
              </p>
              <div data-tour="design">
                <TemplateCatalog
                  template={generation.template as CvTemplate}
                  onSelect={setTemplate}
                  sample={isSample}
                />
              </div>
              {!isSample && reportStale && !editing && (
                <p className="text-[11px] text-ink-faint">
                  You edited your CV — the report refreshes automatically on
                  export, or refresh it now.
                </p>
              )}
              {!isSample && editing && (
                <p className="text-[11px] font-semibold text-accent">
                  ✎ Edit Mode — click any text to edit; highlight a phrase for
                  an AI rewrite ({Math.max(0, maxRewrites - rewritesUsed)}{" "}
                  left). Done saves and exits.
                </p>
              )}
            </div>
            {isSample && (
              <p className="mb-2 text-xs text-amber-700 print:hidden">
                🔒 Watermarked preview — every section shows its first half;
                the rest is blurred. Purchase this job to unlock the complete
                CV, edit it and download.
              </p>
            )}
            <div
              className={`overflow-hidden rounded-xl border transition-all duration-200 ${
                editing && !isSample
                  ? "border-accent ring-2 ring-accent/30"
                  : "border-slate-200"
              } ${isSample ? "print:hidden" : "print:border-0"}`}
            >
              {/* Operational controls, anchored to the preview (PRD Topic 3) */}
              {!isSample ? (
                <CvToolbar>
                  <span data-tour="edit" className="inline-flex">
                    <EditToolbar
                      editing={editing}
                      onToggleEdit={toggleEdit}
                      onReset={resetCv}
                      canReset={isDirty}
                    />
                  </span>
                  <span data-tour="ai-section" className="inline-flex">
                    <AiSectionToggle
                      cv={generation.cv}
                      onChange={(next) => saveCv(next)}
                    />
                  </span>
                  <RefreshReportButton
                    onClick={() => regenerateReportNow()}
                    disabled={
                      editing ||
                      reportBusy ||
                      !reportStale ||
                      regensUsed >= maxRegens
                    }
                    busy={reportBusy}
                    stale={reportStale}
                    editing={editing}
                  />
                  <ToolbarDivider />
                  <DisplayReviewButton
                    onClick={() => setFullScreen(true)}
                    disabled={editing}
                  />
                  <span data-tour="split" className="inline-flex">
                    <SplitToggle
                      template={generation.template as CvTemplate}
                      split={splitView}
                      onToggle={setSplitView}
                    />
                  </span>
                  {/* View settings grouped together (PRD v2 Topic 5). */}
                  <span data-tour="theme" className="inline-flex">
                    <ThemeToggle theme={cvTheme} onChange={setCvTheme} />
                  </span>
                </CvToolbar>
              ) : (
                /* Free sample: design + light/dark tasters only — no editing,
                   AI actions or export. Deliberately NO Display review either:
                   FullScreenCv renders the bare sheet with no watermark and no
                   lock overlay, which handed the whole locked CV to a
                   non-paying user. */
                <CvToolbar>
                  <SplitToggle
                    template={generation.template as CvTemplate}
                    split={splitView}
                    onToggle={setSplitView}
                  />
                  <ThemeToggle theme={cvTheme} onChange={setCvTheme} />
                </CvToolbar>
              )}
              <div
                ref={cvPreviewRef}
                className={`overflow-auto bg-slate-100 p-4 ${
                  isSample ? "select-none" : "print:bg-white print:p-0"
                }`}
              >
                <div
                  ref={cvSheetRef}
                  /* Both classes are load-bearing for the PDF export (see
                     globals.css). `relative` — needed on screen so the
                     watermark and lock overlay position against the sheet —
                     would make this div the containing block for the
                     absolutely-positioned .cv-page, printing the A4 sheet at
                     this div's offset, outside the page: a blank CV file.
                     cv-print-reset drops it back to static for print.
                     cv-preview-scale replaces a `scale-[0.85] lg:scale-100`
                     utility pair, which had the same effect and could not be
                     reliably undone in print — it now exists only on screen.
                     The print viewport is narrower than `lg`, so the scale
                     would otherwise apply there too. */
                  className="cv-print-reset cv-preview-scale relative origin-top-left"
                >
                {isSample && <SampleWatermark />}
                {isSample && <SampleLockOverlay bands={blurBands} />}
                <div className={isSample ? "pointer-events-none select-none" : ""}>
                  <CvRenderer
                    cv={generation.cv}
                    template={generation.template as CvTemplate}
                    theme={cvTheme}
                    split={effectiveSplit(
                      generation.template as CvTemplate,
                      splitView
                    )}
                    editable={!isSample && editing}
                    onChange={(next) => saveCv(next)}
                  />
                </div>
              </div>
              </div>
            </div>
            {!isSample && (
              <RewriteTooltip
                containerRef={cvPreviewRef}
                enabled={editing}
                rewritesUsed={rewritesUsed}
                maxRewrites={maxRewrites}
                onRewrite={handleRewrite}
              />
            )}

            {/* Under the CV: match analysis first, then the interview
                simulation. Shares the report-refresh fade with the change
                report in the left column. */}
            <div
              className={`mt-4 space-y-4 transition-opacity duration-300 print:hidden ${
                reportBusy ? "pointer-events-none select-none opacity-25" : ""
              }`}
              aria-busy={reportBusy}
            >
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Match analysis</h2>
                <span className="text-2xl font-bold text-indigo-600">
                  {generation.diff.gapAnalysis.matchScore}%
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${generation.diff.gapAnalysis.matchScore}%` }}
                />
              </div>
              {generation.diff.gapAnalysis.strengths.length > 0 && (
                <>
                  <h3 className="mt-4 text-xs font-semibold uppercase text-emerald-700">
                    Strengths
                  </h3>
                  <TeaserList
                    items={generation.diff.gapAnalysis.strengths}
                    sample={isSample}
                  />
                </>
              )}
              {generation.diff.gapAnalysis.gaps.length > 0 && (
                <>
                  <h3 className="mt-3 text-xs font-semibold uppercase text-red-700">Gaps</h3>
                  <TeaserList
                    items={generation.diff.gapAnalysis.gaps}
                    sample={isSample}
                  />
                </>
              )}
              {generation.diff.gapAnalysis.recommendations.length > 0 && (
                <>
                  <h3 className="mt-3 text-xs font-semibold uppercase text-indigo-700">
                    Recommendations
                  </h3>
                  <TeaserList
                    items={generation.diff.gapAnalysis.recommendations}
                    sample={isSample}
                  />
                </>
              )}
              {isSample && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  🔒 Unlock the full report to read every strength, gap and
                  recommendation.
                </p>
              )}
            </Card>

            {/* Interview simulation report — visible to everyone, but mostly
                blurred until Full Prep is owned (see simLocked). */}
            {generation.simulation &&
              (generation.simulation.pitch ||
                generation.simulation.questions.length > 0) && (
                <Card className="p-5 print:hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold text-slate-900">
                      Interview simulation report
                    </h2>
                    {simLocked && <Badge tone="amber">🔒 Locked</Badge>}
                  </div>

                  {generation.simulation.pitch && (
                    <div className="mt-3 rounded-[14px] bg-green-50 p-3 text-sm text-accent-deep">
                      <p className="text-xs font-bold uppercase">
                        Your 30-second pitch
                      </p>
                      <p
                        aria-hidden={simLocked}
                        className={`mt-1 italic ${
                          simLocked
                            ? "pointer-events-none select-none blur-[5px]"
                            : ""
                        }`}
                      >
                        “{generation.simulation.pitch}”
                      </p>
                    </div>
                  )}

                  <div className="mt-3 space-y-3">
                    {generation.simulation.questions.map((q, i) => {
                      const tone = TONE_META[q.tone] ?? TONE_META.curious;
                      const locked = simLocked && i >= SIM_CLEAR_QUESTIONS;
                      return (
                        <div
                          key={i}
                          aria-hidden={locked}
                          className={`rounded-[14px] border border-slate-100 p-3 text-sm ${
                            locked
                              ? "pointer-events-none select-none blur-[4px]"
                              : ""
                          }`}
                        >
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white"
                            style={{ background: tone.chip }}
                          >
                            {tone.label}
                          </span>
                          <span className="ml-2 text-[11px] italic text-ink-faint">
                            {tone.hint}
                          </span>
                          <p className="mt-1 font-semibold text-slate-900">
                            {q.question}
                          </p>
                          {q.whyTheyAsk && (
                            <p className="mt-1 text-xs italic text-slate-500">
                              Why they ask: {q.whyTheyAsk}
                            </p>
                          )}
                          {q.howToAnswer && (
                            <p className="mt-1.5 text-[13px] text-slate-600">
                              {q.howToAnswer}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Unlock CTA — a paid `match` user goes straight to the $1
                      upgrade; a free sample still has to buy a tier. */}
                  {simLocked && (
                    <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5">
                      <p className="text-xs text-slate-600">
                        🔒 {generation.simulation.questions.length} likely
                        questions with guidance on how to answer each one.
                      </p>
                      {canUpgrade ? (
                        <Button
                          size="md"
                          className="mt-2 w-full"
                          onClick={() => setUpgradeOpen(true)}
                        >
                          Unlock for ${upgradeUsd}
                        </Button>
                      ) : (
                        <button
                          className="mt-2 cursor-pointer text-xs font-semibold text-accent underline"
                          onClick={() =>
                            document
                              .getElementById("unlock-pricing")
                              ?.scrollIntoView({ behavior: "smooth" })
                          }
                        >
                          See unlock options →
                        </button>
                      )}
                    </div>
                  )}
                </Card>
              )}
            </div>
            {/* Version history (milestone snapshots) */}
            {!isSample && versions.length > 1 && (
              <Card className="mt-4 p-5 print:hidden">
                <VersionStrip versions={versions} onRestore={restoreVersion} />
              </Card>
            )}

            {/* Sample → conversion CTA (pricing). Never shown to someone whose
                payment is still being confirmed — they already bought. */}
            {isSample && !purchase && !awaitingPayment && (
              <div id="unlock-pricing" className="mt-6 scroll-mt-24 print:hidden">
                <h2 className="mb-3 text-center text-lg font-semibold text-slate-900">
                  Like what you see? Unlock the full version
                </h2>
                {tierCards}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hidden interview-report print target (second download file). Full
          Prep only — the simulation is generated for every tier, so gating on
          `!isSample` alone shipped it to $3 Job Match buyers as well. */}
      {generation && !isSample && !simLocked && generation.simulation && (
        <ReportPage
          results={{
            cv: generation.cv,
            diff: generation.diff,
            simulation: generation.simulation,
            jobTitle: job.title,
            company: job.company,
          }}
          candidateName={generation.cv.contact.fullName || ""}
        />
      )}

      {showTour && generation && !fullScreen && (
        <ResultsTour steps={RESULTS_TOUR_STEPS} onClose={endTour} />
      )}

      {fullScreen && generation && (
        <FullScreenCv
          cv={generation.cv}
          template={generation.template as CvTemplate}
          theme={cvTheme}
          split={effectiveSplit(generation.template as CvTemplate, splitView)}
          onClose={() => setFullScreen(false)}
        />
      )}

      {resetUndo && (
        <Toast message="Edits discarded" actionLabel="Undo" onAction={undoReset} />
      )}

      {error && <p className="mt-4 text-center text-sm text-red-600 print:hidden">{error}</p>}

      {/* PRD §4.3 warning modal */}
      <Modal
        open={redFlagModal}
        onClose={() => setRedFlagModal(false)}
        title="⚑ We noticed a potential Red Flag"
      >
        <div className="space-y-2 text-sm text-slate-600">
          {hits.map((h, i) => (
            <p key={i}>
              This job requires <strong>“{h.evidence}”</strong>, which conflicts with your
              dealbreaker: <strong>{h.dealbreakerText}</strong>.
            </p>
          ))}
          <p className="pt-2 font-medium text-slate-800">
            {pendingSample
              ? "Are you sure you want to use this job's free sample on it?"
              : "Are you sure you want to proceed and spend a credit?"}
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setRedFlagModal(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => generate(true, pendingSample)}>
            Proceed anyway
          </Button>
        </div>
      </Modal>

      {/* Premium revision modal */}
      <Modal
        open={reviseOpen}
        onClose={() => setReviseOpen(false)}
        title="Request an AI revision"
      >
        <p className="text-sm text-slate-600">
          Tell Claude what to change. Revisions are locked to this job (
          {purchase ? purchase.maxRevisions - revisionsUsed : 0} remaining).
        </p>
        <Textarea
          rows={4}
          className="mt-3"
          placeholder="e.g. Emphasize my leadership experience more, and shorten the education section…"
          value={reviseText}
          onChange={(e) => setReviseText(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setReviseOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy === "revise" || reviseText.trim().length < 3} onClick={revise}>
            {busy === "revise" ? <Spinner label="Revising…" /> : "Apply revision"}
          </Button>
        </div>
      </Modal>

      {/* Upgrade offer — a single-option "pricing view": match → full for the
          $1 difference, shown with the $2 anchor struck through. */}
      <Modal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        title="Upgrade to Full Prep"
      >
        <Card className="border-2 border-accent p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-ink">{TIERS.full.name}</h3>
            <Badge tone="indigo">Upgrade</Badge>
          </div>
          <p className="mt-1 font-display text-3xl font-extrabold text-ink">
            <span className="mr-2 align-middle text-xl font-bold text-ink-faint line-through">
              ${UPGRADE_ANCHOR_USD}
            </span>
            ${upgradeUsd}
            <span className="font-sans text-sm font-normal text-ink-faint">
              {" "}
              one-time
            </span>
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
            <li>✓ Interview simulation report</li>
            <li>✓ Up to {TIERS.full.maxRevisions} AI revisions</li>
            <li>✓ Keeps everything you already unlocked</li>
          </ul>
        </Card>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setUpgradeOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy === "checkout"}
            onClick={() => checkout("full", true)}
          >
            {busy === "checkout" ? (
              <Spinner />
            ) : (
              `Upgrade for $${upgradeUsd}`
            )}
          </Button>
        </div>
      </Modal>
      </main>
    </>
  );
}
