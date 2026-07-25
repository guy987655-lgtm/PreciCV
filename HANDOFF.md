# HANDOFF — Supabase auth + freemium funnel + payments (2026-07-25)

Point this file at a fresh session to continue exactly where we stopped.
Pricing strategy lives in **`PRICING_MODEL.md`** — that is the source of truth
for tiers and the payment provider.

## Where the code is

- Branch **`freemium-funnel-and-oauth`**. `main` is untouched. To ship:
  `git checkout main && git merge freemium-funnel-and-oauth`.
- **Vercel: two projects deploy this repo from `main`.** `preci-cv`
  (`https://preci-cv.vercel.app`) is the one we treat as production — set its
  env vars there. `preci-cv-gjz9` (`https://preci-cv-gjz9.vercel.app`) is an
  older one from 2026-07-15, left alone; it will also rebuild on every push to
  `main` and serve a degraded site without env vars. Clean it up eventually.
- **Do not trust `list_projects` from the Vercel MCP integration** — it is
  scoped and returned only unrelated projects, which led to a wrong "no project
  exists" conclusion. Verify by probing the domain over HTTP instead.
- Node is not on `PATH`: `export PATH="$HOME/.local/node/bin:$PATH"`.
- Dev server: launch config **`precicv-dev`** (`.claude/launch.json`) → port 3000.
- Typecheck (the reliable gate, since `/jobs/[id]` only compiles when visited):
  `npx tsc --noEmit` — currently clean.

## What is configured and verified

| Piece | State |
|---|---|
| Supabase project `nrcmijgoyxthbdftdzgg` | 4 tables live (`profiles`, `jobs`, `generations`, `purchases`) + RLS |
| GitHub / Google / LinkedIn OAuth | ✅ all three verified reaching their real auth screens |
| Supabase redirect allow-list | `http://localhost:3000/auth/callback` |
| Provider callback (set in each provider console) | `https://nrcmijgoyxthbdftdzgg.supabase.co/auth/v1/callback` |
| `.env.local` | `GEMINI_API_KEY` ✅, `NEXT_PUBLIC_SUPABASE_URL` ✅, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ✅, `SUPABASE_SERVICE_ROLE_KEY` ✅, `NEXT_PUBLIC_APP_URL` ✅, `DEV_FREE_MODE=false`, plus the Lemon Squeezy block below |
| **Lemon Squeezy** (live-probed 2026-07-25) | Store **SpeCV** id `438606`, USD, **test mode**. Variants: match `1945861` $3, full `1945868` $4, upgrade `1945870` $1. `LEMONSQUEEZY_API_KEY` ✅ returns 200 |
| **Missing** | `LEMONSQUEEZY_WEBHOOK_SECRET` (needs a public URL first), PostHog key |

## Production readiness — audited 2026-07-24

Verified by probing each service directly (`npm run build` + live API calls):

| Check | Result |
|---|---|
| `next build` | ✅ exit 0, 33 routes, no errors or warnings |
| `tsc --noEmit` | ✅ clean (eslint has 20 pre-existing `set-state-in-effect` errors; they do not block the build) |
| OAuth handoff | ✅ all three 302 to the real provider (github.com / accounts.google.com / api.linkedin.com); Supabase has github, google, linkedin_oidc, email enabled |
| RLS | ✅ anonymous reads 0 rows on all 4 tables while service_role sees them; anonymous INSERT into `purchases` blocked (42501) — nobody can grant themselves a paid purchase |
| Lemon Squeezy checkout | ✅ 2026-07-25: `POST /v1/checkouts` returned **201** with `test_mode:true`; the `custom` data (`user_id`/`job_id`/`tier`) round-tripped, and the hosted page rendered with SpeCV branding, $3.00, card + PayPal |

**Blockers before real money can be taken:**

1. **Migration `0005_lemonsqueezy.sql` is not applied to the live database.** It
   renames `purchases.stripe_session_id` → `provider_ref`, which the webhook
   writes. Until it runs, a paid order fails to record and the user keeps seeing
   the blurred sample. **Do this before the first production payment.**
2. **No deploy target** — no Vercel project for this repo (re-verified
   2026-07-25), so pushing to GitHub deploys nothing and no production env var
   exists (`.env.local` is gitignored and local-only).
3. **No webhook exists** — needs a public URL first. After deploying, register
   `https://<prod>/api/payments/webhook` in Lemon Squeezy and set
   `LEMONSQUEEZY_WEBHOOK_SECRET` to the same self-chosen string in both the LS
   dashboard and the Vercel env. `verifyLsWebhook` rejects everything without it.
4. **Redirect allow-list is localhost-only** — add `https://<prod>/auth/callback`
   and set the Site URL, or every production sign-in dead-ends. (Not verifiable
   from the API: Supabase validates it at the callback stage, and reading the
   list needs a management token.)
5. **Lemon Squeezy store is not activated** — steps 3/4/7 in the LS dashboard
   (identity, 2FA, bank) are required before live payments. Test mode works now.

Recommended order: push → create the Vercel project and set env vars → deploy →
apply migration 0005 → add the prod callback to Supabase → register the LS
webhook → test end-to-end in test mode → activate the store → leave test mode.

## The flow as it now works

```
/  (guest funnel)
  → upload CV + paste JD → questions
  → "Register to see your results"        ← guests never get a free full CV
  → /login → provider → /auth/callback (next=/continue)
  → /continue → POST /api/try/import      ← creates profile + job in Supabase
  → /jobs/{id}                            ← AUTO-generates this job's sample
  → blurred + watermarked results + "Unlock full version →" → $3 / $4 (+$1 upgrade)
```

Free users may **view only** — no download/export, `print:hidden` on samples.
The sample is **one per job**: every job the user adds auto-generates its own
blurred preview.

## Open items, most important first

1. ~~Free sample is per ACCOUNT~~ → **now one free sample PER JOB.** Done in
   code, **not yet confirmed in the browser** by the user (needs a second job
   on an account whose sample was already spent → expect an auto-generated
   blurred preview instead of a bare pricing page).
   - `src/app/jobs/[id]/page.tsx` — `freeSampleAvailable = !purchase && !generation`.
   - `src/app/api/generate/route.ts` — the account-wide 403 (`free_sample_used`)
     is gone; the per-job cap is the existing "one revision-0 row per job"
     guard, which still answers 409.
   - `profiles.free_sample_used` is still written but **nothing reads it** —
     informational only (kept so a lifetime cap could return without a
     backfill). The `0002_free_sample.sql` header still says "per registered
     user"; that comment is now historical.
   - Note: every new job costs an LLM call with no payment. If abuse/cost
     becomes an issue, cap jobs-per-day or samples-per-account instead.
2. **Sample teaser reworked** (verified on `/demo/sample`, which renders the
   sample workspace with no auth — the fastest way to eyeball this):
   - The blur is now **per section, bottom half of each** (it used to be one
     band from mid-Experience down, which left a two-column layout almost
     fully readable). Bands are measured from `[data-cv-section]` and carry
     their own left/width, so each column locks separately.
     `data-cv-section` had to be added to the summary/skills blocks and to the
     layouts that never tagged theirs (`src/components/cv-renderer.tsx`); a
     design that still tags nothing falls back to one lower-half band.
   - The design catalog locks all but **six designs** for a sample: 2 per row,
     skipping rows' overlaps so the six are distinct
     (`sampleUnlockedTemplates` in `src/lib/templates.ts`). Locked chips show
     🔒 and are `disabled`. Paid CVs still get the whole catalog.
   - Consequence worth knowing: a design unlocked via one row shows unlocked in
     every row it appears in, so "Recommended" can show 3 open chips. Unlocking
     strictly the 2 leftmost per row instead would yield only 4 distinct
     designs, since the recommended row is drawn from the other two.
3. **Payments** — Lemon Squeezy is wired and probed; only the webhook is
   missing (needs a public URL). `DEV_FREE_MODE=true` still grants purchases for
   free locally. Prices live in `TIERS` (`src/lib/types.ts`) **and** as three
   variants in the LS dashboard — change one, change the other. See
   `PRICING_MODEL.md`.
4. **PostHog** — code fully wired, only `NEXT_PUBLIC_POSTHOG_KEY` is missing.
5. **Brand naming is inconsistent** and users see it: app says *SpeCV*, the
   GitHub OAuth app says *PreciCV*, README says *PreciCV*, and Google's consent
   screen shows the raw `…supabase.co` domain.
6. `/dashboard` (the old authenticated dashboard) still exists but nothing links
   to it — the user called it irrelevant. Decide: delete or repurpose.

## Gotchas worth knowing

- **Gemini emits invalid JSON now and then.** `parseJsonLoose` +
  `repairJsonControlChars` in `src/lib/llm.ts` recover the common cases, and a
  failure logs the exact position: grep the dev log for
  `[geminiCall] JSON.parse failed`. Tailoring runs at `maxTokens: 32000` — the
  old 16000 truncated large diffs and produced 500s.
- Generation takes ~15–45s; `/api/generate` has no try/catch, so a model failure
  surfaces as a bare 500.
- A failed sample generation does **not** consume the job's sample — nothing is
  inserted, so the retry button (and a reload) still offer it.
- **Cannot be automated from the agent side:** file upload (OS dialog) and OAuth
  sign-in (credentials). The user has to drive those; verify via screenshots and
  by reading the dev-server log.
- The funnel reads a *simulated* user state (`src/lib/sim-user.ts`), not the real
  Supabase session — in production it is always `guest`. That is why the register
  gate works even when signed in: the funnel still sends the user to
  `/login?next=/continue`. `src/proxy.ts` now honours that `next` for an
  already-signed-in user (relative paths only), so redoing the funnel creates a
  new job and its free sample instead of dead-ending on `/dashboard`.
