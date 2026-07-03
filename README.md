# PreciCV — AI-Powered Career Agent & CV Tailoring Platform

Generate precise, custom-tailored, **one-page** resumes and gap-analysis
reports for every job application. Built per the PreciCV PRD v2.0.

## Stack

| Layer | Tech |
|---|---|
| AI engine | Claude Fable (generation) + Claude Haiku (fast pre-checks), structured JSON outputs |
| App | Next.js 16 (App Router, RSC), TypeScript strict |
| UI | Tailwind CSS v4, shadcn-style components |
| DB & Auth | Supabase (PostgreSQL, JSONB, RLS, Social OAuth) |
| Billing | Stripe Checkout + webhook |
| Analytics | PostHog (normalized `button_clicked` event) |

## Product flow

1. **Onboarding** — Social sign-in (Google / LinkedIn / GitHub) with mandatory
   ToS consent → upload CV (PDF/DOCX) → server-side parsing → Claude extracts
   the baseline profile into the **Master Data Lake** → dynamic questionnaire
   fills data gaps → user defines absolute **Dealbreakers**.
2. **Tailoring loop** — paste a JD (or URL with anti-scraping fallback) →
   **pre-generation dealbreaker scan** (cheap Haiku call, runs *before* any
   credit is spent) → red-flag warning modal if conflicts are found → pay per
   job (Standard $10 / Premium $15) → Claude generates a strictly one-page CV
   + change/diff report + gap analysis.
3. **Review workspace** — side-by-side UI: diff report on the left (pastel
   red strikethrough removals, pastel green additions), WYSIWYG inline-editable
   CV on the right (edits are free, saved automatically, no API calls).
   3 ATS templates (classic / modern / compact). Export as PDF.
4. **Premium revisions** — up to 10 AI revisions locked to the same `job_id`;
   JD updates must pass an **>85% cosine-similarity** anti-fraud check.
5. **Privacy** — "Delete My Account & Data" performs a hard cascade delete.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the **SQL Editor**, run `supabase/migrations/0001_init.sql`.
3. Under **Authentication → Providers**, enable **Google**, **LinkedIn (OIDC)**
   and **GitHub** (each needs a client ID/secret from the provider's console;
   set the callback URL Supabase shows you).
4. Under **Authentication → URL Configuration**, add
   `http://localhost:3000/auth/callback` and your production
   `https://YOUR-DOMAIN/auth/callback` to the redirect allow-list.
5. Copy the project URL, anon key, and service-role key into `.env.local`.

### 2. Environment

```bash
cp .env.example .env.local
# fill in the values
```

**AI engine — pick one:**
- **Free (no credit card):** get a `GEMINI_API_KEY` at
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The free
  tier's daily quota covers testing and early users.
- **Best quality (paid, per the PRD):** get an `ANTHROPIC_API_KEY` at
  [console.anthropic.com](https://console.anthropic.com). If both keys are
  set, Claude is used.

To test the full flow **before** configuring Stripe, set `DEV_FREE_MODE=true`
(purchases are granted without payment — never enable in production).

### 3. Stripe (when ready to charge)

1. Get your secret key from the Stripe dashboard (test mode first).
2. Create a webhook endpoint pointing to `https://YOUR-DOMAIN/api/stripe/webhook`
   listening to `checkout.session.completed`; copy its signing secret to
   `STRIPE_WEBHOOK_SECRET`.
3. Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

### 4. Run

```bash
npm install
npm run dev
```

### 5. Deploy to Vercel

1. Push this repo to GitHub.
2. Import it in Vercel — it auto-detects Next.js.
3. Add all env vars from `.env.local` in the Vercel project settings
   (set `NEXT_PUBLIC_APP_URL` to your production URL, `DEV_FREE_MODE=false`).
4. Point the Stripe webhook and Supabase redirect URLs at the production domain.

> Note: CV generation calls can take 30–90s. On Vercel's free (Hobby) plan,
> serverless functions cap at 60s — the routes declare `maxDuration = 300`,
> which is honored on the Pro plan. On Hobby, expect occasional timeouts on
> the generate/revise routes.

## Architecture notes

- **Structured outputs** — every LLM call forces a tool call whose
  `input_schema` is generated from the zod schemas in `src/lib/types.ts`,
  then re-validated with zod. No free-text JSON parsing.
- **One-page constraint** — the prompt contains strict compression
  directives; output is validated against a character budget and the model is
  asked to compress once more if exceeded (layout validation + fallback,
  PRD §4.4).
- **Layout replication** — the original CV's section order is captured at
  ingestion (`originalSectionOrder`) and the tailoring prompt preserves it;
  rendering falls back to 3 pre-built ATS templates.
- **Anti-fraud** — one purchase per `job_id` (DB unique constraint), revision
  count enforced server-side, JD swaps blocked below 85% term-frequency
  cosine similarity (`src/lib/similarity.ts`).
- **PDF export** — print-to-PDF with a dedicated A4 print stylesheet (only
  the CV pane prints). Serverless-friendly; a headless-Chromium render
  service can replace it later without UI changes.
- **Analytics** — a single normalized `button_clicked` PostHog event with
  `button_name, action, button_text, click_source, job_id` (PRD §8).
