# HANDOFF — Supabase auth + freemium funnel (2026-07-24)

Point this file at a fresh session to continue exactly where we stopped.

## Where the code is

- Branch **`freemium-funnel-and-oauth`**, commit **`4ef99b2`**. **Not pushed** —
  in this project `push == deploy`, so pushing is the user's call.
- `main` is untouched. To ship: `git checkout main && git merge freemium-funnel-and-oauth`.
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
| `.env.local` (7 keys, all live-probed 2026-07-24) | `GEMINI_API_KEY` ✅, `NEXT_PUBLIC_SUPABASE_URL` ✅, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ✅, `SUPABASE_SERVICE_ROLE_KEY` ✅, `SUPABASE_SECRET_KEY` ✅ (spare), `STRIPE_SECRET_KEY` ✅ test-mode, `DEV_FREE_MODE=false` |
| **Missing** | `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`, PostHog key |

## Production readiness — audited 2026-07-24

Verified by probing each service directly (`npm run build` + live API calls):

| Check | Result |
|---|---|
| `next build` | ✅ exit 0, 33 routes, no errors or warnings |
| `tsc --noEmit` | ✅ clean (eslint has 20 pre-existing `set-state-in-effect` errors; they do not block the build) |
| OAuth handoff | ✅ all three 302 to the real provider (github.com / accounts.google.com / api.linkedin.com); Supabase has github, google, linkedin_oidc, email enabled |
| RLS | ✅ anonymous reads 0 rows on all 4 tables while service_role sees them; anonymous INSERT into `purchases` blocked (42501) — nobody can grant themselves a paid purchase |
| Stripe key + Checkout | ✅ test key valid; a session created through the exact code path (inline `price_data`) succeeded and the `user_id`/`job_id`/`tier` metadata round-tripped |

**Blockers before real money can be taken:**

1. **Stripe account is not activated** — `details_submitted=false`, `charges_enabled=false`,
   `payouts_enabled=false`, no capabilities. Onboarding (business details + bank)
   must be completed in the Stripe dashboard; until then only test mode works.
2. **No webhook exists anywhere** — 0 registered endpoints on the Stripe account and
   no `STRIPE_WEBHOOK_SECRET`. `purchases.status` only flips to `paid` from
   `checkout.session.completed`, so today a user would pay and still see the
   blurred sample. Register `https://<prod>/api/stripe/webhook` after the first deploy.
3. **No deploy target** — the Vercel account holds `world-cup-2026`,
   `claude-code-course` and `tapecalc`; there is no project for this repo. Pushing
   to GitHub therefore deploys nothing yet, and no env var exists in production
   (`.env.local` is gitignored and local-only).
4. **Redirect allow-list is localhost-only** — add `https://<prod>/auth/callback`
   and set the Site URL, or every production sign-in dead-ends. (Not verifiable
   from the API: Supabase validates it at the callback stage, and reading the
   list needs a management token.)

Recommended order: push → create the Vercel project and set env vars → deploy →
add the prod callback to Supabase → register the Stripe webhook → test with
`4242 4242 4242 4242` → complete Stripe activation → swap in live keys.

## The flow as it now works

```
/  (guest funnel)
  → upload CV + paste JD → questions
  → "Register to see your results"        ← guests never get a free full CV
  → /login → provider → /auth/callback (next=/continue)
  → /continue → POST /api/try/import      ← creates profile + job in Supabase
  → /jobs/{id}                            ← AUTO-generates this job's sample
  → blurred + watermarked results + "Unlock full version →" → tiers $2/$3/$5
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
3. **Stripe** — keys + webhook not configured; `DEV_FREE_MODE=true` grants
   purchases for free. Prices live in `TIERS` (`src/lib/types.ts`), charged via
   inline `price_data`, so no Stripe products need creating.
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
