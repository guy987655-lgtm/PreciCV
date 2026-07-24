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
| `.env.local` | `GEMINI_API_KEY`, `DEV_FREE_MODE=true`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| **Missing** | service-role/secret key, Stripe keys, PostHog key, `NEXT_PUBLIC_APP_URL` |

## The flow as it now works

```
/  (guest funnel)
  → upload CV + paste JD → questions
  → "Register to see your results"        ← guests never get a free full CV
  → /login → provider → /auth/callback (next=/continue)
  → /continue → POST /api/try/import      ← creates profile + job in Supabase
  → /jobs/{id}                            ← AUTO-generates the one-time sample
  → blurred + watermarked results + "Unlock full version →" → tiers $2/$3/$5
```

Free users may **view only** — no download/export, `print:hidden` on samples.

## Open items, most important first

1. **Free sample is per ACCOUNT; the user wants it per JOB.** ← live blocker.
   Signing in with Google reused the same Supabase user (identities are linked
   by matching email), whose one free sample was already spent, so the user
   landed on a bare pricing page. A message now explains it, but the user
   still hits it and wants a preview for every new job.
   Change `freeSampleAvailable` in `src/app/jobs/[id]/page.tsx` — it currently
   reads `profiles.free_sample_used`. Per-job means dropping that check (and,
   if a cap is still wanted, tracking usage on the job/generation instead).
2. **Not yet visually confirmed by the user:** the blur starting mid-Experience,
   and the design-catalog / light-dark tasters on the sample.
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
- A failed sample generation does **not** consume the free sample (the flag is
  set only after a successful insert).
- **Cannot be automated from the agent side:** file upload (OS dialog) and OAuth
  sign-in (credentials). The user has to drive those; verify via screenshots and
  by reading the dev-server log.
- The funnel reads a *simulated* user state (`src/lib/sim-user.ts`), not the real
  Supabase session — in production it is always `guest`. That is why the register
  gate works, and why a logged-in user revisiting the funnel would be bounced to
  `/dashboard` by the middleware instead of `/continue`.
