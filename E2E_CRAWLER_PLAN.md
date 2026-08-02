# SpeCV — Automated E2E / UI Crawler Test Suite

**Implementation spec. Hand this to Claude Code as the source of truth.**
Written 2026-07-28 against the repo as of this date.

> **Read this first, agent:** this is a *plan*, not a request to write the full
> suite in one pass. Implement it in the phases of §7, in order, and stop at
> each phase gate for approval. Do not skip §3 — a mistake there costs real
> money on every run.

---

## 1. Goal & non-negotiables

Simulate **100 randomized users** (mix of paid and free) crawling the entire UI
— every route, every button, modal, dropdown and tab — to surface crashes,
hydration errors, dead links, unhandled rejections and 5xx responses.

Three hard constraints:

| # | Constraint | Why it matters here |
|---|---|---|
| C1 | **Zero AI generation.** No run may cost LLM money. | 13 endpoints in this repo call the LLM. See §3. |
| C2 | **Zero real payments.** | `/api/payments/checkout` hits the live Lemon Squeezy API. |
| C3 | **Zero destructive DB writes against real users.** | `/api/account/delete` hard-cascades an auth user. |

---

## 2. Framework decision — Playwright

Use **Playwright Test** (`@playwright/test`). Not Cypress, not Puppeteer.

The deciding factor is **`BrowserContext.route()`**: Playwright can intercept
and fulfil requests at the *context* level, which is what makes the cost
firewall in §3 possible and reliable. Cypress's `cy.intercept` is per-test and
harder to make fail-closed; Puppeteer has no test runner, no trace viewer, no
worker parallelism.

Secondary reasons: native `storageState` (auth reuse across 100 workers —
critical here, see §4), built-in trace viewer for post-mortem on a crawl
failure you can't reproduce by hand, and first-class parallel workers.

```bash
npm i -D @playwright/test
npx playwright install chromium
```

Chromium only. Cross-browser adds runtime without adding crash coverage for
this purpose.

---

## 3. The cost firewall (C1) — THREE independent layers

**This is the most important section. Implement all three. They are cheap and
each one alone is insufficient.**

The brief's original framing — "don't click the Generate button" — is not
enough. Generation is not the only paid call. The full inventory:

### 3.1 Endpoint classification

| Endpoint | LLM call | Model tier | Verdict |
|---|---|---|---|
| `/api/parse-cv` | `extractProfileFromCv` (16k) | quality | **BLOCK** |
| `/api/generate` | `generateTailoredCv` (32k) | quality | **BLOCK** |
| `/api/revise` | `generateTailoredCv` (32k) | quality | **BLOCK** |
| `/api/generations/[id]/report` | `regenerateReport` (8k) | quality | **BLOCK** |
| `/api/rewrite` | `rewriteSnippet` | fast | **BLOCK** |
| `/api/try/parse-cv` | `extractProfileFromCv` + `analyzeJdGreeting` | quality+fast | **BLOCK** |
| `/api/try/generate` | `generateTailoredCv` (32k) | quality | **BLOCK** |
| `/api/try/report` | `regenerateReport` (8k) | quality | **BLOCK** |
| `/api/try/rewrite` | `rewriteSnippet` | fast | **BLOCK** |
| `/api/try/role-questions` | `generateRoleQuestions` (10k) | fast | **BLOCK** |
| `/api/try/sharpen-suggestions` | `suggestOpenAnswers` | fast | **BLOCK** |
| `/api/try/confirm-answer` | `refineAnswer` | fast | **BLOCK** |
| `/api/jobs` (POST) | `scanDealbreakers` | fast | **CONDITIONAL** — see 3.4 |
| `/api/payments/checkout` | — | — | **BLOCK** (C2, real LS API) |
| `/api/payments/webhook` | — | — | **BLOCK** (C2) |
| `/api/account/delete` | — | — | **BLOCK** (C3, cascade delete) |
| `/api/jd/fetch` | — | — | **BLOCK** (arbitrary outbound scrape) |
| `DELETE /api/jobs/[id]` | — | — | **BLOCK in the main crawl** — see 3.7 |
| `/api/try/import` (POST), `/api/answers` (POST), `/api/answers/match` (POST), `/api/account/profile` (GET), `/api/onboarding/complete` (POST), `PATCH /api/jobs/[id]`, `PATCH /api/generations/[id]` | — | — | ALLOW |

Note especially that **`/api/rewrite` (inline edit) and
`/api/generations/[id]/report` (Regenerate report)** are precisely the
"premium buttons a paid user clicks" from the brief — and both are full-price
LLM calls.

### 3.2 Layer 1 — no API keys in the test environment (the hard stop)

`.env.e2e` must **omit `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` entirely.**

`llmConfigured()` in `src/lib/llm.ts` returns false, and every LLM route
short-circuits to `LLM_NOT_CONFIGURED_MSG` before any network call. This is the
only layer with a *structural* guarantee: with no key, no bill is possible.

Layers 2 and 3 exist so the UI still receives realistic data instead of errors.

### 3.3 Layer 2 — fail-closed route interception (the functional layer)

In the Playwright fixture, register **one** context-level handler over
`**/api/**` and make the default branch **block, not pass**:

```ts
// tests/e2e/fixtures/api-firewall.ts
// Allowlist is (method, path) pairs — method matters: PATCH /api/jobs/[id]
// is safe, DELETE /api/jobs/[id] destroys seeded fixtures.
const ALLOWLIST: [string, RegExp][] = [
  ['POST',  /^\/api\/answers$/],
  ['POST',  /^\/api\/answers\/match$/],
  ['GET',   /^\/api\/account\/profile$/],
  ['POST',  /^\/api\/onboarding\/complete$/],
  ['POST',  /^\/api\/try\/import$/],
  ['PATCH', /^\/api\/jobs\/[^/]+$/],
  ['PATCH', /^\/api\/generations\/[^/]+$/],
];

await context.route('**/api/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  const method = route.request().method();

  // MUST come first: /api/generations/[id]/report is an LLM call and would
  // otherwise be swallowed by the /api/generations/[id] pattern.
  if (matchesMock(path)) {
    return route.fulfill({ status: 200, json: mockFor(path) });
  }
  if (ALLOWLIST.some(([m, re]) => m === method && re.test(path))) {
    return route.continue();
  }
  // Default: BLOCK. Any endpoint added to the app in future is blocked
  // until someone consciously allowlists it.
  recordBlocked(method, path);
  return route.fulfill({ status: 200, json: { error: 'blocked-by-e2e-firewall' } });
});
```

Rules for this handler:

- **Order matters.** Match the more specific `/api/generations/[id]/report`
  before the generic `/api/generations/[id]`.
- Never write `route.continue()` as the fallback. The whole point is that a
  route added six months from now is blocked by default.
- `recordBlocked()` appends to a per-run report so you can see whether the
  crawler reached an endpoint you'd forgotten about. That list is itself a
  useful output.

### 3.4 Layer 3 — server-side kill switch

Add to `src/lib/llm.ts`, at the top of `structuredCall`:

```ts
if (process.env.E2E_BLOCK_LLM === "true") {
  throw new Error("E2E_BLOCK_LLM: LLM call blocked by test harness");
}
```

Six lines, guarded by an env var that is never set in production. This catches
any call originating **server-side** (a server component or a route handler
calling another handler), which Playwright's browser-level interception cannot
see. Log the stack trace — if this ever fires, layer 2 has a hole worth fixing.

### 3.5 The `/api/jobs` exception (free, if you seed correctly)

`scanDealbreakers` returns early with `{ hits: [] }` when the dealbreakers array
is empty, before any LLM call. So: **seed every test persona with
`profiles.dealbreakers = '[]'`** and `/api/jobs` POST becomes free and can stay
on the allowlist, keeping the real job-creation path under test. Do not seed
dealbreakers on any persona.

### 3.7 `DELETE /api/jobs/[id]` — block in the main crawl

It isn't dangerous (RLS scopes it to the caller's own job), but a crawler that
finds the delete-job control will shred the seeded fixtures mid-run and every
subsequent assertion becomes a false failure. Block it during the crawl and
cover it in a separate, purpose-built spec that seeds a throwaway job first.

### 3.6 Belt and braces

Run against a **dedicated Anthropic API key with a low workspace spend cap**
even though §3.2 means it should never be used. If the cap is ever touched, a
layer failed and you want to know within dollars, not at end of month.

---

## 4. Auth & persona seeding (Supabase)

### 4.1 The obstacle

`src/app/login/page.tsx` offers **OAuth only** — Google, LinkedIn, GitHub. There
is no email/password form. Playwright cannot and should not drive a real Google
consent screen: it is bot-detected, MFA-gated, and rate-limited. **Do not
attempt UI login.**

### 4.2 The approach — seed with service role, then mint a session

**Step A — enable the Email provider** in the *test* Supabase project only
(Dashboard → Authentication → Providers → Email). Users created this way never
appear in production.

**Step B — `globalSetup` creates users with the admin client:**

```ts
const admin = createAdminClient(); // SUPABASE_SERVICE_ROLE_KEY
await admin.auth.admin.createUser({
  email: `e2e+paid-${i}@specv.test`,
  password: E2E_PASSWORD,
  email_confirm: true,
});
```

**Step C — a test-only session route.** Add
`src/app/api/test/session/route.ts`, hard-guarded:

```ts
export async function POST(req: Request) {
  if (process.env.E2E_TEST_MODE !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { email, password } = await req.json();
  const supabase = await createClient();          // the app's own SSR client
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return NextResponse.json({ error: error.message }, { status: 401 });
  return NextResponse.json({ ok: true });
}
```

This reuses the app's own cookie adapter, so the resulting cookies are byte-
identical to a real session — no hand-crafting of chunked `sb-<ref>-auth-token`
values, no drift when `@supabase/ssr` changes its encoding. `globalSetup` POSTs
to it once per persona and saves `context.storageState()` to
`tests/e2e/.auth/<persona>.json`, which all 100 workers then reuse.

Also add `/api/test/` to the `proxy.ts` matcher exclusion list, and confirm the
route returns 404 when `E2E_TEST_MODE` is unset — that assertion belongs in the
suite itself.

### 4.3 The five personas

`src/lib/sim-user.ts` already defines five valid user states. **Mirror them
exactly** — do not invent a sixth, and note that "paid without profile" was
deliberately removed from the architecture.

| Persona | registered | profile | paid | Auth | Share of 100 |
|---|---|---|---|---|---|
| `guest` | ✗ | ✗ | ✗ | none | 25 |
| `guest_with_profile` | ✗ | ✓ (localStorage funnel) | ✗ | none | 20 |
| `registered_no_profile` | ✓ | ✗ | ✗ | storageState | 15 |
| `registered_with_profile` | ✓ | ✓ | ✗ | storageState | 20 |
| `paid` | ✓ | ✓ | ✓ | storageState | 20 |

The two guest personas need no auth at all — the funnel lives in localStorage
(`FUNNEL_KEY`). Seed them by injecting `mockFunnelState()` from
`src/lib/mock-data.ts` via `context.addInitScript`.

### 4.4 Seeding paid users (C-requirement #4 from the brief)

Paid users must land on **pre-generated** CVs and reports so premium buttons are
clickable without generating anything. In `globalSetup`, insert directly with
the service-role client:

1. `profiles` — `master_data` + `raw_cv_text` from `mockFunnelState()`,
   `onboarded: true`, **`dealbreakers: []`** (see §3.5).
2. `jobs` — `jd_text` from `mockFunnelState().jdText`, `status: 'generated'`.
3. `generations` — `cv` + `diff` JSONB. **Derive these fixtures from
   `src/app/demo/demo-data.ts` and `src/lib/mock-data.ts`, validated through the
   zod schemas in `src/lib/types.ts` at seed time.** Hand-written JSON will
   drift from the schema and produce false-positive "crashes" that waste a whole
   debugging afternoon. Note `mock-data.ts` currently exports only
   `mockFunnelState()` — export the underlying `MOCK_JD` / `MOCK_POOL` constants
   as part of Phase 2 rather than duplicating them.
4. `purchases` — `tier: 'full'`, `status: 'paid'`, `amount_cents: 400`.
   Remember the `unique (job_id)` constraint: one purchase per job.

Give each paid persona **2–3 jobs** so `/history` and the job switcher have
real content to traverse.

Also set `DEV_FREE_MODE=true` in `.env.e2e` — `lemonsqueezy.ts` then grants
purchases without contacting the payment provider, which is a second guard for
C2.

### 4.5 Teardown

`globalTeardown` deletes every `e2e+*@specv.test` user via
`admin.auth.admin.deleteUser`. All tables cascade from `auth.users`, so that one
call cleans everything. Make teardown idempotent and make it run even when the
suite fails, or the test project accumulates thousands of orphaned users.

---

## 5. Crawler design

### 5.1 Shape

A **seeded random walk**, not exhaustive BFS. Exhaustive crawling of a stateful
funnel doesn't terminate; a seeded walk with a fixed action budget does, and —
because the seed is recorded — a failure replays deterministically with
`--seed=<n>`.

Per virtual user:

```
budget = 40 actions
start  = persona's natural entry route
loop:
  1. snapshot interactive elements
  2. pick one (weighted, seeded RNG)
  3. act
  4. wait for network idle (capped)
  5. assert health invariants
  6. if stuck/dead-ended, navigate to a random known route
```

### 5.2 Element discovery

The repo currently has **zero `data-testid` attributes**. Don't build the
crawler around selectors that don't exist. Discover by role instead:

```ts
const targets = await page.locator(
  'button:visible, [role="button"]:visible, a[href^="/"]:visible, ' +
  '[role="menuitem"]:visible, [role="tab"]:visible, summary:visible, ' +
  'input[type="checkbox"]:visible, select:visible, [role="switch"]:visible'
).all();
```

Weight the picks so the crawler doesn't spend 40 actions toggling one dropdown:
prefer unvisited elements, decay repeats, and cap dwell time per route.

**Selector-based exclusion is a UX nicety, not a safety mechanism.** The network
firewall in §3 is what guarantees safety. Do not let a reviewer accept a
name-matched denylist as sufficient.

That said, add `data-testid` to roughly ten high-stakes controls — Generate,
Unlock/Pay, Delete account, Sign out, Rewrite, Regenerate report — as a cheap
readability win in reports. Small production diff, worth it.

### 5.3 Health invariants (what counts as a finding)

Assert continuously, not just at the end:

- `page.on('pageerror')` — uncaught exception.
- `page.on('console')` filtered to `error` — excluding a small, *justified*
  allowlist of known-noisy third-party warnings (PostHog, Vercel Analytics).
  Keep that allowlist short and comment each entry.
- Any response `>= 500`.
- React hydration mismatch (`console.error` matching `/hydrat/i`).
- The `global-error.tsx` boundary rendering — the app's own crash screen.
- Next.js dev error overlay (`nextjs-portal`).
- Navigation to a 404.
- A route that renders zero interactive elements (usually a silent render
  failure, not an empty page).

### 5.4 Artifacts

On failure: trace, screenshot, video, plus a JSON record containing the seed,
persona, the exact action sequence, and the blocked-endpoint log from §3.3.
Write a run summary to `tests/e2e/reports/<timestamp>.json`.

### 5.5 Scale & runtime

100 users × 40 actions. Use `workers: 6` locally (each worker is a browser
context; more will thrash a laptop and produce timeout noise that reads as
false failures). Expect **20–40 minutes** for a full run. Provide
`E2E_USER_COUNT` so the default dev loop can run 10 users in ~3 minutes.

---

## 6. File layout

```
playwright.config.ts
tests/e2e/
  global-setup.ts          # create users, seed DB, save storageState
  global-teardown.ts       # delete e2e+*@specv.test
  fixtures/
    api-firewall.ts        # §3.3 fail-closed interception
    mocks/                 # LLM response fixtures, zod-validated
    personas.ts            # §4.3 definitions + distribution
    seed.ts                # service-role DB inserts
  crawler/
    walk.ts                # seeded random walk engine
    discover.ts            # element discovery
    invariants.ts          # §5.3 health assertions
    report.ts
  specs/
    crawl.spec.ts          # the 100-user parameterized crawl
    firewall.spec.ts       # asserts the firewall itself works
  .auth/                   # gitignored
  reports/                 # gitignored
```

`firewall.spec.ts` is not optional. It must assert that a deliberate call to
`/api/generate` is intercepted, and that `/api/test/session` 404s when
`E2E_TEST_MODE` is unset. A safety mechanism nobody tests is a safety mechanism
nobody has.

---

## 7. Phased implementation — stop at each gate

**Phase 0 — Harness skeleton.** Install Playwright, `playwright.config.ts`,
`.env.e2e` loading, one smoke test hitting `/`. *Gate: it runs green.*

**Phase 1 — The firewall, before anything else.** §3.2–3.4 plus
`firewall.spec.ts`. *Gate: a test that deliberately calls `/api/generate`
proves it never reaches Anthropic. Nothing else is built until this passes.*

**Phase 2 — Auth & seeding.** §4 end to end. *Gate: `storageState` for all five
personas; a paid persona loads a pre-generated CV; teardown leaves the DB
clean.*

**Phase 3 — Crawler engine.** §5, run with 5 users. *Gate: a seeded run is
reproducible — same seed, same action sequence.*

**Phase 4 — Scale to 100 + reporting.** Persona distribution, parallelism,
JSON report, artifact capture.

**Phase 5 — Triage.** Cluster findings by root cause, not by occurrence. One
hydration bug will surface 40 times; the report should say "1 issue × 40", or
the output is unreadable.

---

## 8. Acceptance criteria

1. A full 100-user run completes with **$0.00** of LLM spend — verified against
   the Anthropic console, not assumed.
2. No Lemon Squeezy checkout is created.
3. No non-`e2e+` user or row is modified; teardown leaves zero residue.
4. Every one of the 13 page routes is visited at least once per run.
5. Findings are reproducible from `--seed`.
6. `firewall.spec.ts` passes and fails loudly when the firewall is disabled.

---

## 9. Repo-specific hazards

- **`/api/account/delete` cascades.** If it ever escapes the firewall while a
  persona is authenticated, that user and all their rows are gone. Blocked in
  §3.1 — verify it explicitly in `firewall.spec.ts`.
- **`proxy.ts` redirects unauthenticated hits** to `/onboarding`, `/jobs`,
  `/my-account`, `/continue` → `/login?next=…`. The crawler must treat that as
  expected behaviour for guest personas, not a finding.
- **`try-now.tsx` is a ~1500-line client component** driving the whole guest
  funnel from localStorage. It is the highest-value crawl target and the most
  likely source of state-dependent crashes. Give guest personas a larger action
  budget here.
- **`purchases` has `unique (job_id)`** — checkout returns 409 on a second
  purchase for the same job. Expected, not a finding.
- **`generations` has `unique (job_id, revision_number)`** — seed distinct
  revision numbers.
- **`llm.ts` retries aggressively** (`maxRetries: 5`, 110s timeout). Without
  §3.2 a single leaked call could become six billed requests.

---

## 10. What Guy must do manually

Ordered. Items 1–4 block Phase 0.

1. **Create a separate Supabase project for testing.** Do not point this at
   production — the suite creates and deletes users. Run all six migrations in
   `supabase/migrations/` against it. Supply `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. **Enable the Email provider** in that project (Authentication → Providers →
   Email). Disable email confirmation, or rely on `email_confirm: true`.
3. **Create `.env.e2e`** with the test project's keys,
   `E2E_TEST_MODE=true`, `E2E_BLOCK_LLM=true`, `DEV_FREE_MODE=true`,
   `NEXT_PUBLIC_APP_URL=http://localhost:3000`, and **no `ANTHROPIC_API_KEY`
   and no `GEMINI_API_KEY`**. Add it to `.gitignore`.
4. **Approve the two production-code changes** this requires:
   `src/app/api/test/session/route.ts` (~15 lines, 404s unless
   `E2E_TEST_MODE=true`) and the six-line guard in `src/lib/llm.ts`.
5. **Create a dedicated Anthropic API key with a low spend cap** as a tripwire
   (§3.6). Do not put it in `.env.e2e` — keep it in the console only, so a
   charge appearing there is unambiguous evidence of a leak.
6. **Decide the target.** Local `npm run build && npm start` is recommended over
   a Vercel preview: faster, no function timeouts, no deploy per iteration.
7. **Approve the fixture source** — derive from `src/lib/mock-data.ts` and
   `src/app/demo/demo-data.ts`, or supply 2–3 real CVs (PDF/DOCX) and JDs if you
   want more realistic traversal.
8. **Confirm the persona split** in §4.3 (currently 45 guest / 35 registered
   free / 20 paid) matches your real traffic mix.
9. **Budget ~30 minutes of runtime** for a full run and decide where it lives —
   local-only, or CI. If CI, the service-role key needs a secrets store.

Nothing else requires you. Everything from §2 through §9 is Claude Code's work.
