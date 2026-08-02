# HANDOFF — live in production, waiting on Lemon Squeezy approval (2026-07-27)

Point this file at a fresh session to continue exactly where we stopped.
Pricing strategy lives in **`PRICING_MODEL.md`** — that is the source of truth
for tiers and the payment provider.

## One product + design preview — 2026-08-02 (supersedes the two-tier model)

**There is one thing to buy.** The `match` tier ($3, tailored CV without the
interview report) and the hidden `base` tier are gone. Every purchase is
**Full Prep, $4**, and includes the CV, the comparison report and the interview
simulation report. Pack prices are unchanged from the old Full row:
**$4 / $6 / $8 / $9 / $10** for 1–5 jobs.

That single distinction was the source of everything below it, so all of this
was deleted rather than adapted:

- `UPGRADE_ANCHOR_USD`, `VISIBLE_TIERS`, `PackTier`, `PACK_UPGRADE_CENTS`,
  `upgradeSku*`, `parsePackSku` (unused), `isPackTier`.
- The `order_upgrade` checkout shape, `orderUpgradeCheckout`,
  `applyOrderUpgrade`, `startOrderUpgradeCheckout`, and the webhook's upgrade
  branch. `packs.ts` is now a one-dimensional table keyed by quantity.
- `CreditBalance.byTier` / `.nextTier` / `CreditOrder.upgradeCents` — a credit
  is a credit.
- `simLocked` in the job workspace narrowed from
  `isSample || tier === "match"` to just `isSample`; the blur path survives for
  free samples only. `printFile("cv")` gave way to `printBoth` everywhere, and
  History's split `CV (PDF)` / `Report (PDF)` buttons are one button again.
- Both paywalls (`paywall.tsx`, `bundle-paywall.tsx`) are single-card. The
  quantity pills are the only choice left in the bundle one.

**Grandfathering.** `supabase/migrations/0011_single_tier.sql` moves every
`purchases`/`orders` row off `match`/`base` onto `full`. It costs nothing: the
interview simulation was always generated and stored for every tier and merely
rendered blurred, so old Job Match buyers gain their reports with zero LLM
calls — the same effect the retired `applyOrderUpgrade` had. **You have to run
this by hand in the Supabase SQL Editor.** The `tier` CHECK constraints and the
dead `orders.upgrade_*` columns are deliberately left alone.

**No Lemon Squeezy work needed.** `full_x1` resolves to the existing
`LEMONSQUEEZY_VARIANT_FULL` at its own $4 price; 2–5 ride it with
`custom_price`. `.env.example` is down to that one variant — `MATCH`,
`UPGRADE` and `UPGRADE_2` are no longer read.

**Design preview on `/run/[id]`.** "Your applications" listed jobs and sold
credits but never showed a CV, so the 21 designs were only discoverable by
opening a single job. `src/components/design-preview-modal.tsx` renders
`src/lib/sample-cv.ts` (moved out of `src/app/demo/demo-data.ts`, which now
re-exports it) through the existing `CvRenderer`, with `TemplateCatalog`,
`ThemeToggle` and `SplitToggle` reused as-is. Everything is a local draft until
**Use this design**, which writes three places: `rememberExportPrefs`
(device), `saveAccountPrefs` (account) and the new
`PATCH /api/run/[id]/design` (every non-sample generation in the batch).

**Bug fixed on the way.** `GET /api/run/[id]/documents` never selected
`cv_theme` / `split_view`, and the run's print mount passed neither — so every
batch download came out light-mode and non-split whatever the user had chosen.
Both now travel with the document and reach `CvRenderer`. Without this, "Use
this design" would have changed a setting without changing the file. The same
route's `InterviewSimulationSchema.parse(g.simulation ?? {})` would have thrown
on a row with no stored simulation once the tier gate was removed; it is a
`safeParse` returning `null` now.

## Sequential homepage + credit allocation — 2026-08-01 (supersedes batch mode)

**Batch mode is gone.** There is one funnel now, and it is the homepage.

- **`/` collects the CV, then the jobs, one at a time.** Drop a CV → it parses
  in the background (`/api/try/parse-cv`, no `jd`) and collapses to a chip →
  paste a JD → on blur `/api/try/jd-meta` names it and it collapses to
  `Company · Title` → `+ Add another job` appears, up to `MAX_PACK_SIZE` (5).
  Exactly one card is ever expanded. `FunnelState.jdText` is now
  `FunnelState.jobs: JobDraft[]`; `loadFunnel`/`loadHistory` migrate the old
  shape, so saved flows and History rows survive.
- **One merged question set** for every job, from `/api/try/questions`
  (`extractJobQuestions`, renamed from `extractBatchQuestions`). It returns RAW
  pools — the client still owns match → cap → normalize, which is what keeps a
  guest's localStorage answer cache in play. `ChatFlow` is the only
  questionnaire UI; `BatchQuestions` is deleted.
- **`/api/try/import` creates N jobs** sharing a `batch_id` (kept as the run
  grouping key — renaming the column would be a migration for nothing) and
  absorbs what `/api/batch` did: the per-job dealbreaker scan, and folding
  answers into `master_data.additionalFacts` **for already-onboarded users**.
  That last one is a real fix — a returning user's answers used to reach
  `profile_answers` only, so they were remembered for next time and ignored for
  the jobs they were just given for.
- **`/continue`** sends >1 job to `/run/[id]`, 1 job to `/jobs/[id]` as before.
- **`/run/[id]`** is the old batch workspace, renamed (`RunWorkspace`,
  `RunJob`, `runId`). New: **credit allocation.** When the run holds more jobs
  than the balance covers, each locked row gets a checkbox capped at
  `credits.total`, a `N of M credits allocated` line, and `Generate N reports`,
  which spends on the SELECTED jobs only. Selection is derived from the balance
  (no seeding effect), so returning from checkout ticks a sensible default. The
  `BundlePaywall` leads the page when nothing is bought or built yet, and
  demotes below the list afterwards.
- **Free preview is unchanged**: job #1 still generates watermarked and free.
- **Rate limiting.** `checkDailyQuota` now takes a `scope`, because the funnel
  makes several LLM calls per flow and on the old shared counter they would have
  eaten the free-generation allowance. `parse-cv`, `jd-meta` and `questions` all
  charge the `funnel` bucket (`FUNNEL_DAILY_LIMIT = 40`, `src/lib/funnel-quota.ts`);
  generation keeps the original unscoped cookie.
- Deleted: `src/app/batch/**`, `src/app/api/batch/**`,
  `src/components/batch-questions.tsx`, the dead `generateWithRetry`, the
  navbar "Batch mode" item, the History promo link. `PROTECTED_PREFIXES` has
  `/run` in place of `/batch`.
- Was open from the batch build: the run workspace had no bundle-upgrade CTA.
  Moot as of 2026-08-02 — there is no upgrade to offer. The run workspace does
  now carry a **Preview designs** entry point; see the top section.

## Where the code is

- Branch **`main`**, pushed and deployed. The old `freemium-funnel-and-oauth`
  branch is merged history; work directly on `main`.
- **Push = deploy.** Vercel builds `main` automatically. Never push without
  being asked.
- **Vercel: two projects deploy this repo from `main`.** `preci-cv`
  (`https://preci-cv.vercel.app`) is production — env vars live there.
  `preci-cv-gjz9` is an older leftover that also rebuilds on every push and
  serves a degraded site without env vars. Clean it up eventually.
- **Do not trust `list_projects` from the Vercel MCP integration** — it is
  scoped and returned only unrelated projects, which once led to a wrong "no
  project exists" conclusion. Probe the domain over HTTP instead.
- Node is not on `PATH`: `export PATH="$HOME/.local/node/bin:$PATH"`.
- Dev server: launch config **`precicv-dev`** (`.claude/launch.json`) → port 3000.
- Gates: `npx tsc --noEmit` (clean) and `npm run build` (clean, 36 routes).
  eslint has 25 pre-existing `set-state-in-effect` errors; they do not block.

## What is configured and verified

| Piece | State |
|---|---|
| Supabase project `nrcmijgoyxthbdftdzgg` | 5 tables + RLS: `profiles`, `jobs`, `generations`, `purchases`, `profile_answers` |
| Migrations 0001–0009 | ✅ **all applied** (0005 + 0006 run 2026-07-27; 0008 + 0009 run 2026-07-31 in the SQL Editor and verified against production — the `profiles` select in `/api/account/preferences` returns all seven columns) |
| Supabase redirect allow-list | ✅ `https://preci-cv.vercel.app/auth/callback` **and** `http://localhost:3000/auth/callback`; Site URL = `https://preci-cv.vercel.app` |
| Production sign-in | ✅ Google verified end-to-end in incognito by the user |
| Vercel env | Supabase vars ✅ (project URL is in the client bundle). `LEMONSQUEEZY_WEBHOOK_SECRET` ✅ — proven by live webhook deliveries returning `200`; a wrong/missing secret returns `400` |
| **Lemon Squeezy** | Store **SpeCV** id `438606`, USD. Test-mode variants: match `1945861` $3, full `1945868` $4, upgrade `1945870` $1. Webhook registered at `https://preci-cv.vercel.app/api/payments/webhook` (`order_created`), recent deliveries all `200` |
| Missing | PostHog key (`NEXT_PUBLIC_POSTHOG_KEY`) |

## The one remaining blocker

**The Lemon Squeezy store is pending review.** The dashboard shows *"Your
application has been received and will be reviewed as soon as possible"*, and
Test mode cannot be switched off until they approve. Everything required from
our side is done (identity, 2FA, bank, product). This is a waiting game —
watch email, and use the Help link in that sidebar notice if it drags past a
few business days.

**Switch-over list for when approval lands** (test and live are separate
environments in LS — do not assume ids carry over):

1. Turn off Test mode.
2. Re-read the store id and the three variant ids **in live mode**; confirm the
   prices are $3 / $4 / $1 so they match `TIERS` in `src/lib/types.ts`.
3. Create a fresh API key in live mode.
4. Register a **separate** live webhook (`order_created`) — the test-mode one
   does not fire for live orders.
5. Update the six `LEMONSQUEEZY_*` vars + `NEXT_PUBLIC_APP_URL` in Vercel, and
   confirm `DEV_FREE_MODE` is `false` or absent. **Redeploy** — env changes do
   not apply to an existing deployment.
6. One real $3 purchase → verify the three checks below → refund.

⚠️ While the store is in test mode and the checkout is wired to production,
anyone who finds the site can complete a purchase with LS's public test card
and unlock paid content for free. Low exposure while unmarketed; do not leave
it that way.

## Verifying a payment actually landed

**A `200 {"received":true}` from the webhook does NOT prove a purchase was
recorded.** `src/app/api/payments/webhook/route.ts` only writes the row when
`meta.custom_data` carries `user_id`, `job_id` and `tier`; without them it
skips the write and still answers 200. That happens when the order was created
straight from an LS product page instead of through `/api/payments/checkout`.

The real check — **still outstanding, run this first in a new session**:

```sql
select p.tier, p.status, p.amount_cents, p.provider_ref, p.created_at, j.title
from public.purchases p
left join public.jobs j on j.id = p.job_id
order by p.created_at desc
limit 10;
```

- `status = 'paid'` + `provider_ref` filled → the chain works end to end.
- stuck on `pending` despite a 200 → `custom_data` never arrived; investigate.
- no rows → the orders bypassed the app's checkout endpoint.

## What shipped 2026-07-27

Two commits, both live: `c83f7f0` (the batch) and `34ffed5` (a production-only
CSS regression found after deploying — see Gotchas).

| # | Change | Key files |
|---|---|---|
| 1 | Questions translate into the reader's language (RTL included); English stays canonical, so selections still store the English option | `src/lib/i18n.ts`, `api/try/translate`, `chat-seq.ts` (`questionView`), `mcq-options.tsx` |
| 2 | AI example answers adopt into the textarea in one click | `components/chat-flow.tsx` (`AnswerEditor`) |
| 3 | A paid job showing its sample now unlocks automatically, and waits out the webhook instead of showing pricing to someone who just paid | `jobs/[id]/page.tsx` (`justPaid`), `workspace.tsx` |
| 4 | History rows are named from the JD's company before anything is generated | `llm.ts` (`analyzeJdGreeting`), `text.ts` (`companyFromJd`), `funnel.ts` (`defaultProcessName`) |
| 5 | Rename + soft delete on History rows, both local and account-saved | `api/jobs/[id]/route.ts`, `history/page.tsx` |
| 6 | Cross-job answer memory: a returning user is asked only what is new, the rest is recapped | `answer-match.ts`, `api/answers/*`, `chat-seq.ts` (`buildSequence`), `KnownRecap` |
| 7 | My Card reads every past answer — active flow, archived flows and the account — and routes each edit back to its own store | `card/page.tsx` |
| 8 | **Blank CV export fixed** | `globals.css`, `workspace.tsx` |
| 9 | **Missing interview simulation fixed** | `llm.ts` (`generateTailoredCv`), `api/generate/route.ts` |

Root causes for the two export bugs, since they are non-obvious:

- **Blank CV:** Tailwind v4 compiles `scale-*` to the standalone `scale`
  property, so the old `print:transform-none` guard cancelled a property that
  was never set. The wrapper kept `relative` + `scale:.85`, became the
  containing block for the absolutely-positioned `.cv-page`, and printed at
  that wrapper's offset — measured at `top: 3566px`, 675×954 instead of
  794×1123.
- **Missing simulation:** the unlock branch of `/api/generate` returned no
  `simulation`, which unmounts the printable report; and every field of
  `GenerationResultSchema` is defaulted, so a truncated model response parsed
  happily into an empty simulation. Tailoring now treats the simulation and
  diff as post-conditions and rebuilds them via `regenerateReport` — chosen
  over a strict schema, which would discard a good CV over a missing report.

Verified in production by the user: CV export, Google sign-in, History
rename/delete.

## Launch-readiness pass (2026-07-27, later session)

Not yet committed at the time of writing. `npx tsc --noEmit` and
`npm run build` both clean (37 routes — `/refunds` is new).

| Change | Files |
|---|---|
| Real legal pages replacing the two placeholder stubs, plus a refund policy (payment providers require a reachable one) | `app/privacy`, `app/terms`, `app/refunds`, `components/legal-page.tsx` |
| A support address users can actually reach — footer, legal pages and error screens all read it from one constant | `lib/support.ts`, `components/site-footer.tsx` |
| Error boundaries: `error.tsx`, `global-error.tsx`, `not-found.tsx`. Previously any render throw showed the bare Next screen | `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` |
| `/api/generate` and `/api/revise` no longer throw on a model failure — shared JSON error, provider capacity wording passed through | `lib/api-errors.ts` + both routes |
| Stored-data reads switched from `.parse` to `.safeParse` in those routes → 422 with a message instead of a 500 | same |
| `lang` alongside `dir` on translated question content, so a screen reader switches voice | `chat-flow.tsx`, `chat-question-panel.tsx` |
| Brand: README title and `package.json` name now say SpeCV | `README.md`, `package.json` |

Two things in the legal copy are **assumptions to confirm**: governing law
(Israel / Tel Aviv-Yafo) and the 18+ floor for purchases. Both are flagged in
source comments. The pages are plain-language and match what the code does —
they are not a lawyer's review.

**Accessibility, measured:** `--color-ink-faint` (#8b9a8d) is **2.74:1** on the
page background and 2.96:1 on cards — it fails WCAG AA for body text, and it is
what captions, helper text and the footer use. `#657466` clears it (4.59 / 4.95)
with almost no visible change. `--color-muted` (2.05:1) is disabled-state only,
which WCAG exempts. Deliberately not changed — it is a design decision.

## Question translation — REMOVED 2026-07-27

The owner dropped the feature ("לא אוהב את עניין התרגום, מוותר בשלב הנוכחי").
Removed whole, not just the buttons, since a UI-less translation stack would
have left an **unauthenticated LLM endpoint** (`/api/try/translate`, in the
no-auth `try` namespace) that anyone could call once the site is public.

Deleted: `src/lib/i18n.ts`, `src/app/api/try/translate/`, `TranslateToggle`,
`translateQuestions` + its schema in `llm.ts`, `translateTo` in `try-now.tsx`,
the `uiLang` / `translations` funnel-state fields and the `TranslatedQuestion`
type, `optionLabels` on `questionView` and `McqOptions`, and every `dir`/`lang`
attribute that existed to support RTL questions.

`questionView` survives, simplified — it still resolves each question's text
and its example answer, and all three surfaces (chat bubble, left panel, edit
modal) still read through it.

Safe to re-add from git history if it ever comes back. Note that persisted
funnel states in users' browsers still carry the old `uiLang`/`translations`
keys; `loadFunnel` spreads over `EMPTY_FUNNEL` so unknown keys are ignored
harmlessly.

## The "9 items" batch — settled 2026-07-27

A 9-item PRD was re-submitted as new work. It is **the same batch already
shipped in `c83f7f0`**, and this was proven, not assumed: local `HEAD` ==
`origin/main` == `34ffed5`, and the **live production bundle** at
`preci-cv.vercel.app` contains `Back to English`, `Translate these questions`
and `Use this example`. Do not rebuild these. What the walkthrough found:

| # | Item | Verdict |
|---|---|---|
| 1 | Translate toggle | Was genuinely broken for Israeli users, then fixed — and then the whole feature was cut, see above |
| 2 | Adopt example | Works: click fills the textarea, stays editable, label flips to "Replace with this example" |
| 4 | History naming | Correct. The mock JD simply never names an employer, so the `New Application - date` fallback is right |
| 5 | Rename / delete | Works (`Rename this process` ✎, `Delete from history` ✕) |
| 7 | My Card | Works — 26 answers grouped by topic, click-to-edit, progress chart |
| 3, 6 | Auto-unlock, dedup | Code paths verified by reading; need a real account + DB to exercise |
| 8, 9 | Exports | Owner-only — the print dialog cannot be driven from the agent side |

**The real bug behind "the translate feature doesn't exist":** `detectLang()`
returned `""` on the **first** `en*` tag in `navigator.languages`. The very
common Israeli setup `["en-US", "en-IL", "he-IL"]` therefore never reached the
Hebrew sitting one entry below, so `primary` was null, the CTA button never
rendered, and the only remaining affordance was a 12.5px `ink-faint`
underlined link — 2.74:1 contrast, effectively invisible. Two fixes:
`detectLang` now skips English tags instead of returning on them, and the
no-detection fallback renders a real outline Button instead of a faint link
(plus `shrink-0` on the `ms-auto` wrapper, or the padded pill collapses to
min-content and wraps to three lines).

Verified end to end after the fix: the CTA reads **"🌐 תרגם לעברית"**,
translation returns real Hebrew with `dir="rtl"`, `↩ Back to English` appears,
and the result is cached under `translations.he`.

**Known gap, not fixed:** only questions and options translate. The bot's
narration bubbles stay English, which undercuts the point for someone who
struggles with English. Worth a decision.

## Dead code removed 2026-07-27

- **`/dashboard` deleted** (page + `new-job-form` + `sign-out-button`). It was
  the post-auth landing target in 6 places — all re-pointed to `/`:
  `proxy.ts` (prefix list + signed-in `/login` redirect), `auth/callback`,
  `login`, `continue` (×3), `onboarding`. Two user-visible strings that still
  said "dashboard" were reworded.
- **`/settings` rescued.** Its only link lived on the deleted dashboard, and
  the privacy policy points users there for account deletion. Added to the
  navbar account menu.
- `MAX_MCQ_POOL` deleted. `identifyUser` **wired** rather than deleted —
  `AnalyticsProvider` now identifies the session, so PostHog attributes events
  to accounts the moment the key lands.
- ~20 internal-only exports lost the `export` keyword (Zod sub-schemas in
  `types.ts`, `CACHE_TTL_MS`, `tokenOverlap`, `HISTORY_KEY`, …).
- `free_sample_used` **kept** — a documented deliberate no-op; deleting it
  costs a migration to get back.

⚠️ **`npx tsc --noEmit` fails right after deleting a route** —
`.next/types/validator.ts` still imports the removed page. Run `npm run build`
first to regenerate it, then typecheck.

## Batch mode + credit bundles — built AND verified end-to-end 2026-07-31

> **Superseded 2026-08-01** — see the section at the top of this file. The
> credit/bundle half is all still live; the `/batch` surface described below
> was folded into the homepage and `/run/[id]`. File names in this section are
> historical: `batch-workspace.tsx` → `src/app/run/[id]/run-workspace.tsx`,
> `extractBatchQuestions` → `extractJobQuestions`.

Migration 0010 is **applied to production**. The whole flow was driven through a
real signed-in session against the production Supabase and works. What remains
is Lemon Squeezy variants (real money) and one eyeball check on the download.

### Verified end-to-end (batch `0b816b51`, 3 jobs)

| Step | Result |
|---|---|
| Company extraction | Monday.com ✓, Wix.com ✓, agency-fronted posting → **""**, no guess |
| Required company field | Submit blocked while empty, released on fill |
| Merged questionnaire | **7 questions for 3 jobs** — exactly the 5 MCQ + 2 open cap |
| Batch creation | 3 jobs, user-confirmed company names persisted |
| 3-pack Basic | `orders` row `match_x3`, 3 credits, paid |
| Spending 3 credits | 3 `purchases`, all carrying `order_id`, all `amount_cents = 0` |
| Fan-out | Two generations ran concurrently, third queued — CONCURRENCY = 2 |
| Company after generation | **"Confidential Fintech" survived** — proves the /api/generate guard |
| $2 whole-order upgrade | `orders.tier` + all 3 `purchases.tier` → `full` |
| Generations across upgrade | **20 → 20.** Zero LLM calls, as designed |
| Post-upgrade | "Download all" went 3 → **6 files**, all filenames unique |
| Print queue | Fired 6 dialogs in sequence; `document.title` restored and print
  targets unmounted afterwards |

**Still unconfirmed:** that the 6 saved files differ. The dialogs were all
cancelled (see below), so nothing was written to disk. If the mount-then-paint
callback in `batch-workspace.tsx` were broken, you would get the same CV six
times under six correct names — saving files 1 and 3 and comparing is the check.

### Bug found and fixed during verification

Mid-generation the batch page offered to SELL unlocks for jobs already paid
for ("2 jobs still locked"). `locked` was defined as "no result yet" rather than
"no purchase yet", so every job that was merely still generating counted as
locked. Now `unpaid = jobs.filter(j => !j.tier)`, and a paid-but-ungenerated row
renders as **Queued**, not Locked. Verified fixed.

### macOS print dialog — a real product risk

On a Mac with no printer configured, the print dialog's **Print button is
disabled**; saving requires the `PDF ⌄` dropdown → "Save as PDF". This is the
product's ONLY export path, it fires at the moment right after payment, and the
working action is hidden behind a dropdown labelled "PDF". The cheap mitigation
is one line of copy above the download button telling the user what to pick;
the real fix is server-side PDF rendering. Neither is done — the owner chose to
check the behaviour in production first.

### Not built (deliberate, flagged)

- The batch workspace has **no bundle-upgrade CTA**. That offer lives only in
  My Account, History and the job workspace, even though the batch page is the
  highest-intent surface for it.
  **Superseded 2026-08-02:** the whole upgrade path was removed with the second
  tier, so there is nothing left to surface here.

---

Two features, both code-complete, both blocked on setup you have to do.

**What was built**

- **Volume pricing.** `src/lib/packs.ts` holds the matrix (1–5 jobs, Basic and
  Full, plus the whole-order upgrade). `TIERS` in `types.ts` is untouched and
  still owns the single-unit price; every strikethrough anchor is derived from
  it. Verified invariant: `basic(n) + upgrade(n) === full(n)` for all n.
- **Credits.** Migration `0010` adds `orders` (a bundle) and `purchases.order_id`.
  Buying a pack grants credits; spending one mints the ordinary per-job
  `purchases` row, so **every existing entitlement check works unmodified** and
  `unique (job_id)` is untouched. Credits are derived, never stored. Spending
  goes through `spend_credit()`, which locks the order row so two tabs cannot
  both spend the last credit.
- **Whole-order upgrade.** `$1`/`$2` lifts a whole bundle to Full: already-
  unlocked jobs get their interview report retroactively (one UPDATE, no LLM
  call — the simulation was always generated and merely blurred), and unspent
  credits become Full credits. Jobs unlocked from a bundle deliberately do
  **not** offer the per-job `$1` upgrade.
- **Batch mode** at `/batch` (signed-in only, added to `PROTECTED_PREFIXES`).
  Paste up to 5 JDs → company name extracted per JD by `analyzeJdGreeting` and
  **required** before submit → one merged questionnaire capped at the same
  5 MCQ + 2 open a single job gets (`extractBatchQuestions`) → `/batch/[id]`
  fans out `/api/generate` at concurrency 2.
- **Batch download.** `printQueue` in `download.ts` chains N save dialogs on
  `afterprint`. Filenames always carry the company. `src/app/try-now.tsx` was
  not touched at all.

**Before it can work — your actions**

1. ~~Apply migration 0010~~ — **DONE**, applied to production and verified
   read-only: `orders` + both upgrade columns, `purchases.order_id`,
   `jobs.batch_id`, `spend_credit()`, and the read-only RLS policy on `orders`
   (an anon INSERT is refused with `42501`, so users cannot mint credits).
2. ~~Create 9 new Lemon Squeezy variants~~ — **not needed.** `custom_price`
   works on this store (verified against the live API: a checkout on the $3
   Job Match variant with `custom_price: 800` renders **$8.00**, and
   `product_options.name` retitles it "Job Match — 5-pack"). `resolveVariant`
   in `src/lib/lemonsqueezy.ts` falls every pack and the $2 upgrade back to its
   family's single-unlock variant, priced per checkout from `packs.ts`.
   - `createLsCheckout` refuses to return a URL unless LS echoes the exact
     `custom_price` it was sent, so a store that ever stopped honouring it
     would fail the checkout rather than sell a 5-pack for $3.
   - The `VARIANT_ENV` ids still win when set: creating a real dashboard
     variant later is a pure env change, no code.
3. **`DEV_FREE_MODE=true`** exercises the whole thing without Lemon Squeezy:
   pack and upgrade checkouts grant instantly. Note the gate is
   `!lsConfigured() && devFreeMode()` — with `LEMONSQUEEZY_API_KEY` present the
   flag does nothing, so local testing also needs that key commented out.
   **`.env.local` is currently left in that state** (line 14 commented,
   `DEV_FREE_MODE=true`). Restore both before trusting a local payment test:
   uncomment `LEMONSQUEEZY_API_KEY` and set `DEV_FREE_MODE=false`.
4. Supabase **Redirect URLs** now include `http://localhost:3000/**`, which is
   what local OAuth needs. Without it Supabase silently falls back to the
   production Site URL and localhost never receives `/auth/callback` — the
   symptom is a lone `…-auth-token-code-verifier` cookie and no session.

**Known limits, stated deliberately**

- One free preview per BATCH (job #1 only). A user can still open job #2's own
  `/jobs/[id]` page and take its per-job free sample — unchanged behaviour, and
  the account-wide 5/day cap in `free-quota.ts` is still the real ceiling.
- `/api/generate` got one small change it needed: it no longer overwrites a
  `jobs.company`/`title` that is already set. It used to write
  `result.company || null`, which NULLed a confirmed company name whenever the
  tailoring pass read the posting as anonymous — and the export filenames are
  built from that name.
- `generateWithRetry` was generalized into `postWithRetry(url, body)` so
  `/api/generate` could reuse the same budget/backoff policy. Its old signature
  still exists and behaves identically.

## Open items, most important first

0. **SECURITY — `purchases` is user-writable.** `0001_init.sql:87` grants
   `for all using (auth.uid() = user_id)`, so a signed-in user can insert their
   own `{status:'paid', tier:'full'}` row straight from the browser with the
   anon key and unlock any job for free. This predates the credit work but the
   credit accounting sits on top of it: `spend_credit()` is carefully atomic and
   can simply be bypassed. The fix is a SELECT-only policy plus moving the
   remaining user-context writes to the service role — `purchases.upsert` in
   `api/payments/checkout`, and the counter updates in `api/rewrite` and
   `api/generations/[id]/report`. Not done here: it is a separate change that
   needs its own testing pass, and getting a write path wrong locks out paying
   users. `orders` does **not** repeat the mistake (read-only under RLS).

1. **Decide on `QUOTA_DISABLED`.** `src/app/api/try/generate/route.ts:26` has
   it `true`, so every anonymous visitor can generate unlimited CVs on your
   LLM budget. Flipping to `false` restores one per day per IP+browser. A
   one-line change, deliberately left unmade pending the owner's call.
2. **Run the purchases check above** — the only unverified link in the payment
   chain.
3. **Free sample is per JOB** (not per account). Still not confirmed in the
   browser: needs a second job on an account whose sample was spent → expect an
   auto-generated blurred preview, not a bare pricing page.
   - `jobs/[id]/page.tsx`: `freeSampleAvailable = !purchase && !generation`.
   - `profiles.free_sample_used` is still written but **nothing reads it**.
   - Every new job costs an LLM call with no payment. If abuse becomes an
     issue, cap jobs-per-day or samples-per-account.
4. **Sample teaser** (eyeball on `/demo/sample`, no auth needed): blur is per
   section, bottom half of each, measured from `[data-cv-section]` so each
   column locks separately. The design catalog unlocks six designs for a
   sample (`sampleUnlockedTemplates` in `src/lib/templates.ts`). Quirk: a
   design unlocked via one row shows unlocked in every row it appears in, so
   "Recommended" can show 3 open chips.
5. **PostHog** — code fully wired, only the key is missing.
6. **Brand naming is inconsistent** and users see it: app says *SpeCV*, the
   GitHub OAuth app says *PreciCV*, README says *PreciCV*, and Google's consent
   screen shows the raw `…supabase.co` domain.
7. `/dashboard` still exists but nothing links to it — the user called it
   irrelevant. Delete or repurpose.

## Gotchas worth knowing

- **Next 16 error boundaries take `unstable_retry`, not `reset`** (added 16.2;
  `reset` still exists but only clears state without re-fetching). Read
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`
  before touching them.
- **A folder starting with `_` is a private folder and is not routed** — a
  throwaway `app/__boundary-check` returned 404 until renamed.
- **`<Navbar />` must not be a direct child of a column flex container.** Its
  root carries `mx-auto`, so `align-items: stretch` loses to the auto margins
  and the bar collapses to content width, centred. Use a plain
  `min-h-screen` wrapper like `LegalPage` does.

- **The dev server does not minify CSS; production does — and the minifier can
  change semantics.** A print rule written as
  `transform:none; scale:none; rotate:none; translate:none` was folded into
  `transform:scale(1)rotate(0)translate(0)`, which cancels nothing, because
  `scale`/`rotate`/`translate` are separate properties in Tailwind v4. The
  local check passed and production stayed broken. **Verify CSS-dependent
  fixes against a production build** (`npm run build`, then grep
  `.next/static/**/*.css`), not just the dev server. The preview scale now
  lives in a `@media screen` rule (`.cv-preview-scale`) so print never sees it.
- **Print targets are pulled to the page origin with `position:absolute`**, so
  no ancestor may be positioned or carry a transform-ish property. Put
  `.cv-print-reset` on any wrapper between a print target and `<body>`.
- **Gemini emits invalid JSON now and then.** `parseJsonLoose` +
  `repairJsonControlChars` in `src/lib/llm.ts` recover the common cases; a
  failure logs the exact position (grep `[geminiCall] JSON.parse failed`).
  Tailoring runs at `maxTokens: 32000`.
- Generation takes ~15–45s; `/api/generate` has no try/catch, so a model
  failure surfaces as a bare 500.
- A failed sample generation does **not** consume the job's sample.
- **Cannot be automated from the agent side:** file upload (OS dialog), OAuth
  sign-in, and **the print dialog** — `Cmd+P` and the resulting PDF must be
  checked by the user. Print layout can be measured by injecting the print
  rules on screen and reading `getBoundingClientRect`.
- **Browser-harness artifacts to not mistake for bugs:** a programmatic
  `.blur()` does not fire when the window lacks focus, and synthetic `Return`
  key presses may not reach React. `InlineRename` in `history/page.tsx` now
  commits directly on Enter rather than delegating to blur, which is also
  genuinely more robust.
- The funnel reads the **real** Supabase session via `useSession()`
  (`src/lib/use-session.ts`). `src/lib/sim-user.ts` is a dev-only simulator
  that always reports `guest` in production — never gate user-visible state on
  it. `/card` had that bug until 2026-07-27.
