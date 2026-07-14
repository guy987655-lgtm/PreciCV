# PRD: precicv UX Improvements Batch — v2

*Supersedes `PRD_precicv-ux-improvements-batch_v1.md`. v2 corrects the v1 assumptions against the actual codebase and locks in the product decisions made during review (2026-07-15).*

---

## 0. Architecture Notes (read before implementing any topic)

These facts invalidated parts of v1 and shape every topic below:

- **localStorage-first model.** The primary public flow is anonymous. All funnel state (profile, questionnaire, answers, results, template, versions) lives in `localStorage` under `precicv_funnel_v1`, managed by `src/lib/funnel.ts`. Archived flows live under `specv_history_v1`. A Supabase-backed authenticated workspace exists in parallel (`jobs`, `generations`, `profiles`, `purchases` tables; migrations in `supabase/migrations/`).
- **Two Results surfaces** share the same control components (`src/components/cv-controls.tsx`):
  1. Guest funnel: `src/app/try-now.tsx`, `state.step === "gate"` branch — the primary surface.
  2. Signed-in workspace: `src/app/jobs/[id]/workspace.tsx`.
- **Questionnaire questions and their answer options are LLM-generated per CV** at upload time (`src/lib/llm.ts`: `extractProfileFromCv`, `generateRoleQuestions`). There is no static question/option list to edit. MCQ questions already render clickable pill options via `src/components/mcq-options.tsx`.
- **The chat flow is fully scripted** (`src/lib/chat-seq.ts` → `buildSequence`), rendered by `src/components/chat-flow.tsx` with scripted beats in `src/components/chat-script.tsx`. No LLM decides the next question at runtime.
- **Editing is inline TipTap with real-time save** (`src/components/cv-editor.tsx`; `editCv` in try-now.tsx). There is no "Use" button for general edits — "Use" belongs to the AI-rewrite tooltip (`src/components/rewrite-tooltip.tsx`).
- **No tour/overlay library and no chart library** are installed; both topics that need them will use small custom components rather than new dependencies.
- **No per-answer timestamps** exist anywhere in the data model (only a flow-level `savedAt`).

---

## 1. Topic 1: Quick Reply Buttons in the Greeting Exchange

### 1.1 Context
MCQ questions in the chat already present clickable pill options (`src/components/mcq-options.tsx`), so v1's premise ("no predefined answer shortcuts") was wrong for most of the flow. The one closed question that is free-text-only is the **personalized greeting exchange** (`GreetingBlock` in `src/components/chat-script.tsx`), e.g. "Makes sense, looking to stay in the Data Analytics field, huh?" — the moment shown in `image_b3ca2e.png`.

### 1.2 User Story
As a user replying to the opening greeting question, I want quick-reply buttons for standard answers so that I can progress into the questionnaire faster without typing.

### 1.3 Current Behavior
`GreetingBlock` renders a free-text input ("Say anything — or tell me a bit about what you're looking for...") plus "Skip" and "Send →". No predefined answer shortcuts.

### 1.4 Problem with Current Behavior
Requiring manual text input for a simple confirm/deny question creates friction at the very first interactive moment of the chat, especially on mobile.

### 1.5 Expected Behavior
A row of hardcoded quick-reply pills renders with the greeting question — e.g. **"Yep"**, **"Not necessarily"**, **"Definitely no"**. Clicking a pill submits that text as the greeting reply through the exact same handler as typing it and pressing "Send →", and the flow advances. The free-text input and "Skip" remain available.

**Scope note (decided in review):** quick replies apply to the greeting exchange only. MCQs already have pills; open-ended phase-3 questions stay free-text. No generic `quickReplies` array API on the chat component is required.

### 1.6 Benefits
- **Improved UX:** One tap instead of typing at the flow's first friction point.
- **Completion Rate:** Faster entry into the questionnaire, reducing drop-off.

### 1.7 Requirements
1.7.1 Add a hardcoded quick-reply option set to the greeting reply UI in `src/components/chat-script.tsx` (`GreetingBlock`).
1.7.2 Render the options as pill buttons above or below the greeting text input, styled consistently with the existing MCQ pills.
1.7.3 Clicking a pill must invoke the same submission path as typing the text and clicking "Send →" (the existing greeting-reply handler that sets `greetingReply` / `greetingDone`).
1.7.4 The free-text input and the existing "Skip" control remain available and functional alongside the pills.

### 1.8 Acceptance Criteria
- Quick-reply pills ("Yep", "Not necessarily", "Definitely no") appear with the greeting question.
- Clicking a pill submits that text as the user's greeting reply and advances the scripted flow.
- Typing a custom reply or skipping still works exactly as before.
- The OLD problem (having to manually type a yes/no answer at the greeting) is resolved.

---

## 2. Topic 2: Guarantee Popular LLM Tools in Generated Options

### 2.1 Context
v1 assumed a static list of answer options for an "LLM tools" question. In reality, **all MCQ questions and options are LLM-generated per CV** at upload time by `extractProfileFromCv` and `generateRoleQuestions` in `src/lib/llm.ts`. There is no schema or data source to edit — the fix is prompt engineering.

### 2.2 User Story
As a user answering questions about AI tools, I want to see popular, recognizable options like ChatGPT, Claude, and Grok so that I can accurately report my experience.

### 2.3 Current Behavior
The generation prompts instruct the model to produce tool-listing MCQs (`selectType: "ranked"`, last option `"None of these"`), but do not require any specific tools, so market-leading LLM products may be missing from the generated options.

### 2.4 Problem with Current Behavior
Users cannot accurately reflect their skill set if the tools they actually use are absent from the generated options, leading to a less accurate final CV. (The `"Other…"` free-text escape exists but adds friction.)

### 2.5 Expected Behavior
Whenever the LLM generates a question about AI/LLM tool usage, its option list must include **"ChatGPT"**, **"Claude"**, and **"Grok"** (in addition to whatever else it deems relevant), with `"None of these"` remaining the last option and the auto-appended `"Other…"` escape unchanged.

### 2.6 Benefits
- **Data Accuracy:** Captures a more accurate reflection of the user's AI tool proficiency.
- **Relevance:** Keeps the platform feeling current with the tools people actually use.

### 2.7 Requirements
2.7.1 Amend the prompt in `extractProfileFromCv` (`src/lib/llm.ts`) so that any AI/LLM-tools question it emits must include "ChatGPT", "Claude", and "Grok" among the options.
2.7.2 Apply the same instruction to `generateRoleQuestions` (the "＋ More questions for my role" bank) for AI/LLM-tool questions.
2.7.3 Preserve existing option rules: `"None of these"` last and mutually exclusive; `"Other…"` auto-appended by the UI.
2.7.4 No changes to answer storage or CV-generation mapping are needed — selected options already flow into `additionalFacts` via `profileWithAnswers()` (`src/lib/funnel.ts`).

### 2.8 Acceptance Criteria
- Upload a CV that plausibly triggers an AI-tools question; verify "ChatGPT", "Claude", and "Grok" appear as selectable options.
- Verify selecting them saves normally and the selections are reflected in the generated CV/report.
- Verify `"None of these"` still appears last and behaves exclusively.

---

## 3. Topic 3: Persist All Results-View State (Theme, Split View — alongside Template)

### 3.1 Context
v1 claimed the CV design selection is not persisted. It **is**: the selected `template` is saved in the localStorage funnel (`state.template`, key `precicv_funnel_v1`) for guests and in the `generations.template` column for signed-in users. What actually resets between sessions are the other two view controls: the CV **light/dark theme** and **Split view**, which are plain `useState` in `src/app/try-now.tsx` (`cvTheme`, `splitView`, ~lines 241–243) and equivalent local state in `workspace.tsx`.

**Decision (review):** broaden the topic — persist *all* view state (template ✓ already done, theme, split view) so the whole Results view restores exactly.

### 3.2 User Story
As a user styling my CV, I want my full view setup — design, light/dark background, and split view — restored on every visit so that I don't have to reconfigure it each time.

### 3.3 Current Behavior
Template persists. `cvTheme` resets to `"light"` and `splitView` resets to `false` on every page load/refresh, on both Results surfaces.

### 3.4 Problem with Current Behavior
Users must re-apply their theme and layout preferences every session, which undercuts the (already working) template persistence.

### 3.5 Expected Behavior
Theme and split view choices persist with the same lifetime and mechanism as the template: guests via the localStorage funnel state, signed-in users via the generation record. On load, the Results page renders with the saved theme, split view, and template applied.

### 3.6 Benefits
- **Improved UX:** The Results view is fully continuous across sessions.
- **Efficiency:** No redundant clicks re-establishing preferences.

### 3.7 Requirements
3.7.1 Guests: add `cvTheme` (`"light" | "dark"`) and `splitView` (boolean) fields to `FunnelState` in `src/lib/funnel.ts` (with defaults and legacy-shape migration in `loadFunnel()`); wire the toggles in `try-now.tsx` to read/patch funnel state instead of local `useState`.
3.7.2 Signed-in: persist the same two fields on the `generations` record (new columns or a JSON prefs column — mirror how `template` is handled), saved via `PATCH /api/generations/[id]` and validated in `src/app/api/generations/[id]/route.ts`; hydrate them in `workspace.tsx` on mount.
3.7.3 Respect `effectiveSplit(template, splitView)` — templates whose `splitMode` forces split must keep overriding the saved preference.
3.7.4 **Tech note:** consult `node_modules/next/dist/docs/` on hydration; the funnel page is client-rendered from localStorage, so apply saved state during the existing hydrate step (before first paint of the gate step) to avoid theme/layout flicker.

### 3.8 Acceptance Criteria
- Change theme to dark and enable split view, refresh the page: both restore (guest and signed-in surfaces).
- Template persistence continues to work as before.
- A template with forced split mode still forces it regardless of the saved preference.
- The OLD problem (theme/split resetting on refresh) no longer occurs.

---

## 4. Topic 4: Results Page Onboarding Tour (Guest Funnel)

### 4.1 Context
The Results page has multiple interactive controls — design catalog, theme toggle, split view, AI-section toggle, edit, download — and no guidance for first-time users. No tour/coachmark infrastructure exists in the app.

**Decisions (review):** guest funnel surface only (`try-now.tsx` gate step); build a small **custom overlay component** (no new dependency); first-seen flag in **localStorage** (users are largely anonymous). The signed-in workspace can inherit the component in a later batch.

### 4.2 User Story
As a first-time user reaching the Results page, I want a guided tour of the available tools so that I know exactly how to customize and download my CV.

### 4.3 Current Behavior
The user lands on the Results step and must discover the toolbar and features unaided. No overlay/spotlight/tooltip-tour primitives exist (closest reusables: `Modal`/`Spinner` in `src/components/ui.tsx`, the `FullScreenCv` overlay).

### 4.4 Problem with Current Behavior
Users can miss high-value customization features (AI-section toggle, split view) or feel overwhelmed, reducing perceived product value.

### 4.5 Expected Behavior
On the very first arrival at the Results step, a tour auto-starts: the background dims and a positioned tooltip spotlights one control at a time with a "Next" button (and a dismiss/skip affordance visible at every step). Sequence:
1. **Design catalog** (`TemplateCatalog`): "Here you can change the design."
2. **Theme toggle** (`ThemeToggle`): "Switch between light and dark backgrounds."
3. **Split view** (`SplitToggle`): "Splits the page into two views."
4. **AI section on/off** (`AiSectionToggle`): "Toggle a dedicated section for jobs involving AI."
5. **Edit** (`EditToolbar`): highlights the edit functionality.
6. **Download** button: highlights where to export the final files.

Steps whose target is absent are **skipped automatically** — e.g. `AiSectionToggle` only renders when the CV contains the `ai-automation` section.

### 4.6 Benefits
- **Clarity:** Educates the user on product capabilities at the moment of highest engagement.
- **Engagement:** Encourages interaction with the customization tools.

### 4.7 Requirements
4.7.1 Build a custom spotlight/tour component (dimmed backdrop, target highlight via element ref/rect, positioned tooltip with step text, "Next", and dismiss "×"/"Skip tour"). No third-party tour library.
4.7.2 Anchor the six steps to the real components listed in 4.5 (all reachable in the gate-step JSX of `try-now.tsx`; controls live in `src/components/cv-controls.tsx`).
4.7.3 Store a `hasSeenResultsTour` flag in localStorage; set it when the tour completes **or** is dismissed; never auto-show again when the flag is set.
4.7.4 Skip any step whose target element is not mounted (notably step 4).
4.7.5 **Dependency:** implement after Topic 5, since the theme toggle's position changes (step 2 must anchor to its new toolbar location).
4.7.6 The tour must scroll each target into view if needed and reposition on window resize; dismissing mid-tour closes the overlay immediately.

### 4.8 Acceptance Criteria
- A first-time user (no flag in localStorage) sees the tour auto-start on reaching the Results step.
- The tour follows the 6-step sequence, skipping the AI-section step when that toggle isn't rendered.
- The tour can be dismissed at any step; it never reappears after completion or dismissal (verify across refreshes).
- The OLD problem (no first-time guidance) is resolved.

---

## 5. Topic 5: Relocate Theme Toggle into the CV Toolbar

### 5.1 Context
The Light/Dark CV theme toggle (`ThemeToggle`, `src/components/cv-controls.tsx`) currently sits in the "Choose a design" section header row, while Split view (`SplitToggle`) sits in the `<CvToolbar>` strip on top of the preview frame — two different containers on both Results surfaces.

### 5.2 User Story
As a user adjusting my workspace, I want all view-related settings grouped together so I can configure my layout in one place.

### 5.3 Current Behavior
Guest funnel: `ThemeToggle` renders at ~`try-now.tsx:1321` (design-section header), `SplitToggle` inside `<CvToolbar>` at ~`try-now.tsx:1391`. The workspace (`workspace.tsx`) mirrors the same arrangement.

### 5.4 Problem with Current Behavior
Fragmented view controls force users to hunt across the page for basic display settings.

### 5.5 Expected Behavior
`ThemeToggle` moves into `<CvToolbar>`, rendered directly adjacent to `SplitToggle`, on **both** surfaces. It disappears from the "Choose a design" header row.

### 5.6 Benefits
- **Improved UX:** All view controls (split, theme, full-screen review) live in one logical strip.

### 5.7 Requirements
5.7.1 Move the `ThemeToggle` call site from the design-section header into the `<CvToolbar>` children, next to `SplitToggle`, in `try-now.tsx`.
5.7.2 Apply the same move in `src/app/jobs/[id]/workspace.tsx` (same shared components, ~lines 808–893).
5.7.3 Adjust the segmented-pill styling if needed so it visually matches the other toolbar buttons; remove any now-empty right-alignment wrapper in the design header.

### 5.8 Acceptance Criteria
- The Light/Dark toggle appears inside the toolbar directly next to the Split view button on both Results surfaces.
- The toggle no longer appears in the "Choose a design" header.
- Toggling theme still works identically (and, with Topic 3, persists).

---

## 6. Topic 6: Instant Reset with Undo Toast (Remove Confirmation Popup)

### 6.1 Context
In edit mode, "Reset" (`resetCv`, ~`try-now.tsx:686`) restores the snapshot taken when the user pressed Edit — i.e., it discards **all edits from the current editing session**, not a single field. It's currently guarded by a native `confirm()` dialog.

**Decision (review):** remove the popup, but because a one-click whole-session wipe is otherwise unrecoverable, add a transient **Undo toast** as the safety net.

### 6.2 User Story
As a user editing my CV, I want reset to happen instantly — with a brief chance to undo — so I can revert changes quickly without a confirmation dialog interrupting me.

### 6.3 Current Behavior
Clicking "Reset" (⟲, enabled only when `isDirty`) triggers `confirm("Discard the edits you made in this editing session?")`; only on OK is `editSnapshot` restored.

### 6.4 Problem with Current Behavior
The confirmation popup adds friction to rapid experimentation — the user can already see the change happen live, so a blocking dialog is redundant.

### 6.5 Expected Behavior
Clicking "Reset" immediately restores the pre-edit snapshot in the UI — no dialog. Simultaneously a small toast appears (~5 seconds): *"Edits discarded"* with an **Undo** action. Clicking Undo restores the CV state exactly as it was the instant before reset (edit mode still active). If the toast expires, the reset stands.

### 6.6 Benefits
- **Efficiency:** Zero-friction revert during rapid editing.
- **Error Prevention:** A misclick on Reset is recoverable, which the raw v1 spec was not.

### 6.7 Requirements
6.7.1 Remove the `confirm()` call from `resetCv` in `try-now.tsx` (and the workspace equivalent if it shares the pattern); apply the snapshot restore immediately.
6.7.2 Before restoring, capture the current (dirty) CV state; render a toast component with an "Undo" button that reapplies it. Auto-dismiss after ~5s; a new reset replaces any pending toast.
6.7.3 No new dependency — a minimal toast can live in `src/components/ui.tsx` alongside the existing primitives.
6.7.4 Undo must also restore `reportStale` and any related flags to their pre-reset values so the report state stays consistent.

### 6.8 Acceptance Criteria
- Clicking "Reset" instantly reverts the CV to its session-start state with no popup.
- An "Undo" toast appears; clicking it within the window restores the discarded edits exactly.
- Letting the toast expire finalizes the reset.
- The OLD problem (a confirmation popup appearing) no longer occurs.

---

## 7. Topic 7: Apply AI Rewrite on Click-Outside (Rewrite Tooltip)

### 7.1 Context
v1 framed this as "auto-save on click-outside in edit mode," but regular TipTap edits already save in real time with no "Use" button. The "Use" button belongs to the **AI rewrite tooltip** (`src/components/rewrite-tooltip.tsx`): select text → get Rewrite/Short/Long candidates → browse with Undo/Redo (↶/↷) → press "Use" to keep one. Today, **clicking outside the tooltip discards the unapplied candidate**.

**Decision (review):** click-outside should **apply** the currently shown candidate instead of discarding it.

### 7.2 User Story
As a user trying AI rewrites, I want the version I'm currently looking at to stick when I click away, so I don't lose a rewrite I liked just because I forgot to press "Use".

### 7.3 Current Behavior
Clicking outside the rewrite tooltip closes it and reverts the text to the pre-rewrite original unless "Use" was pressed.

### 7.4 Problem with Current Behavior
Users see the rewritten text live in the CV and reasonably assume it's applied; clicking away then silently throws it away — surprising data loss that contradicts the app's otherwise auto-saving editing model.

### 7.5 Expected Behavior
When the rewrite tooltip is open with a candidate displayed, clicking anywhere outside it applies that candidate — running the exact same code path as the "Use" button — and closes the tooltip. The "Use" button may remain as an explicit affirmation. Recovery from an unwanted auto-apply is via the editor's normal undo/versioning.

**Accepted trade-off (review):** a stray click can now commit AI text; this is deemed better than silently losing an accepted-looking rewrite.

### 7.6 Benefits
- **Improved UX:** Matches the app's auto-save mental model.
- **Error Prevention:** Eliminates accidental loss of a chosen rewrite.

### 7.7 Requirements
7.7.1 In `rewrite-tooltip.tsx`, change the click-outside handler from discard-and-close to: invoke the "Use" handler for the currently displayed candidate, then close.
7.7.2 If the displayed state is the original text (user Undo'd back to it, or no candidate was generated), click-outside simply closes with no change — nothing to apply.
7.7.3 Rewrite quota accounting (`MAX_REWRITES`) must behave identically whether a candidate is kept via "Use" or via click-outside.

### 7.8 Acceptance Criteria
- Generate a rewrite, click elsewhere on the page: the rewritten text remains in the CV and the tooltip closes.
- Undo back to the original inside the tooltip, click outside: the original text remains (no phantom apply).
- The OLD problem (click-outside discarding a rewrite the user wanted) no longer occurs.

---

## 8. Topic 8: Refresh Report Auto-Scroll & Faded Loading State

### 8.1 Context
"Refresh report" (`RefreshReportButton` in `cv-controls.tsx`; handler `regenerateReportNow`, ~`try-now.tsx:724`) regenerates the report via `POST /api/try/report` (workspace: `POST /api/generations/[id]/report`). The button label changes to "Refreshing…" but the viewport doesn't move and the stale report below stays fully readable.

### 8.2 User Story
As a user refreshing my report after edits, I want the screen to scroll to the report and clearly show it is loading, so I know the system is processing my updates.

### 8.3 Current Behavior
Clicking the button updates it in place ("Refreshing…", driven by `reportBusy`); the "Match analysis" card (~`try-now.tsx:1426`) and the rest of the report remain unchanged and fully legible below the fold until the response lands.

### 8.4 Problem with Current Behavior
The user gets no spatial guidance to where the update happens and can keep reading outdated analysis with no signal that it's being replaced.

### 8.5 Expected Behavior
On click: the page smooth-scrolls to the top of the report area (the **"Match analysis"** section), and all report sections enter a faded loading state — text contrast heavily reduced (color blending toward the background, barely legible) and interactions disabled — until the new report arrives, at which point full contrast returns.

### 8.6 Benefits
- **Clarity:** Directs attention to exactly what is being updated.
- **Visual Feedback:** Prevents reading stale data as if it were current.

### 8.7 Requirements
8.7.1 Attach a ref/id to the Match-analysis card; in `regenerateReportNow`, call `scrollIntoView({ behavior: "smooth" })` on it when the refresh starts.
8.7.2 Reuse the existing `reportBusy` state as the loading flag (no new state needed in the funnel; workspace mirrors with its own busy flag).
8.7.3 While busy, apply CSS classes to the report sections (Match analysis, strengths/gaps/recommendations, simulation) that reduce text contrast to near-background and set `pointer-events: none`; restore on completion or error.
8.7.4 Apply the same treatment on both Results surfaces.
8.7.5 **Tech note:** consult `node_modules/next/dist/docs/` on loading UI/transitions in this Next.js version; the fetch is client-side, so a CSS-class toggle on `reportBusy` suffices — avoid layout-shifting skeleton swaps.

### 8.8 Acceptance Criteria
- Clicking "Refresh report" smooth-scrolls the viewport to the "Match analysis" section.
- During the load, report text fades toward the background and is non-interactive; it returns to normal when the refresh completes.
- On API error, the report returns to full contrast (no stuck faded state).
- The OLD problem (no scroll, unclear loading) no longer occurs.

---

## 9. Topic 9: Floating Download Button on Scroll

### 9.1 Context
The Download button ("Download my files (2 PDFs)", ~`try-now.tsx:1331`, handler `exportBoth`) sits right-aligned above the preview frame and scrolls out of view on the long Results page. The site also has its own top header, so a naive always-fixed button would collide with it.

**Decision (review):** keep the button where it is; show a **floating fixed copy** only after the original scrolls out of view.

### 9.2 User Story
As a user reviewing my long CV/report, I want the download action to stay reachable as I scroll so I can export instantly without scrolling back to the top.

### 9.3 Current Behavior
The button is static in the layout; once the user scrolls past it, exporting requires scrolling back up.

### 9.4 Problem with Current Behavior
The primary conversion action (export) disappears exactly while the user is reviewing the content that convinces them to export.

### 9.5 Expected Behavior
The original button stays in place. When it leaves the viewport (scrolling down), a floating copy appears fixed at the **top-right, below the site header**, with enough right/top offset to never overlap the CV/report content column. Scrolling back up (original visible again) hides the floating copy. The floating copy is identical in label, handler, and disabled logic.

### 9.6 Benefits
- **Conversion:** The primary CTA is always one click away.
- **Improved UX:** No content occlusion, no layout jump — the in-flow button is untouched.

### 9.7 Requirements
9.7.1 Observe the original button with an `IntersectionObserver`; render the floating copy (`position: fixed`, top-right below the header) only while the original is out of view.
9.7.2 The floating copy invokes the same `exportBoth` handler and mirrors the same disabled conditions (`reportBusy || editing`) and label states ("Syncing report…").
9.7.3 z-index above page content, below modals/overlays (including the Topic 4 tour backdrop and `FullScreenCv`).
9.7.4 Offset/padding so it never covers the document container at common viewport widths; on narrow/mobile widths it may compact (icon + short label) but must not overlap content.
9.7.5 Implement on the guest funnel surface; mirror in the workspace if its layout matches (same shared pattern).

### 9.8 Acceptance Criteria
- Scrolling down past the original button makes a floating Download button appear top-right, below the header; scrolling back up hides it.
- The floating button downloads exactly like the original and respects its disabled states.
- The button does not cover or block readable CV/report text at desktop or mobile widths.

---

## 10. Topic 10: "My Card" Unique-Questions Chart (Cumulative, Forward-Only)

### 10.1 Context
The "My card" page (`src/app/card/page.tsx`) shows answered/suggested questions from localStorage funnel state. Two hard constraints surfaced in review:
- **No per-answer timestamps exist** (`mcqAnswers: Record<string, McqAnswer>`, `answers: Record<string, string>` — no time fields; only a flow-level `savedAt`). Historical months cannot be reconstructed — the chart is **forward-only** from ship date, and existing answers are backfilled with the ship date.
- **No chart library is installed.** The chart will be a small custom SVG bar chart (consistent with the no-new-dependency decision on Topic 4). Guests' data is per-device (localStorage).

**Decision (review):** cumulative aggregation, forward-only data accepted, timestamps added now.

### 10.2 User Story
As a user tracking my progress, I want a monthly chart of how many unique questions I've answered in total so that I can visualize my growing profile.

### 10.3 Current Behavior
No historical visualization exists; the data model cannot even support one (no answer timestamps).

### 10.4 Problem with Current Behavior
Users get no visual feedback on accumulated effort, making the platform feel transactional rather than a continuous career tool.

### 10.5 Expected Behavior
The "My card" page shows a bar chart: X-axis = months, Y-axis = **cumulative count of unique questions answered up to and including that month** (deduplicated by question id across the active flow and archived history). Months before the feature shipped show the backfilled baseline; the chart begins at the first month with data.

### 10.6 Benefits
- **Engagement:** Gamifies answering optional questions.
- **Data Visibility:** Immediate visual value on the profile page.

### 10.7 Requirements
10.7.1 Add an `answeredAt` timestamp: extend `McqAnswer` (`src/lib/funnel.ts`) with `answeredAt?: number`, and change/augment open-answer storage so each answer records its time; set it in the answer handlers (`updateMcqAnswer`, `answerOpen` in `try-now.tsx`, and Card-page edits).
10.7.2 Migration in `loadFunnel()`: answers lacking `answeredAt` get backfilled with the migration moment (ship date); handle archived history flows (`specv_history_v1`) the same way.
10.7.3 Aggregation util: collect unique question ids across active + archived flows, take each id's earliest `answeredAt`, bucket by month, output cumulative counts.
10.7.4 Render a custom SVG bar chart component on the Card page (no charting dependency): month labels on X, cumulative unique count on Y, styled with the existing design tokens; empty/one-month states handled gracefully.
10.7.5 Document in-code that guest data is per-device; if/when answers sync to Supabase accounts, the same `answeredAt` field carries over.

### 10.8 Acceptance Criteria
- A bar chart renders on the "My card" page.
- Answering a new unique question is reflected in the current month's bar (cumulative count increments); re-answering an already-counted question does not.
- Pre-existing answers appear as a backfilled baseline in the ship-date month.
- Answers from archived history flows are included in the dedup/aggregation.

---

## 11. Topic 11: History Flow Naming — "Company - Role" with Fallback

### 11.1 Context
History rows (`src/app/history/page.tsx`) are titled by `flowDisplayName` → `defaultProcessName` (`src/lib/funnel.ts:380–396`), currently `"{jobTitle} - {company}"` (role first), with a manual rename (`processName`) overriding everything. `company` is **LLM-extracted from the job description** (prompts in `src/lib/llm.ts`), so it's legitimately empty when the JD doesn't name the company or when the flow hasn't generated yet (`results` is null).

**Decision (review):** switch to **"Company - Role"**, fallback **"General - <Role>"** when company is missing, and manual renames continue to win.

### 11.2 User Story
As a user looking at my past applications, I want history items named "Company - Role" so I can scan for a specific application instantly.

### 11.3 Current Behavior
`defaultProcessName`: `"{jobTitle} - {company}"` when both exist; `jobTitle` alone when company is empty; `"New Application - {date}"` when there are no results (in-progress flows). The row's secondary line separately appends the company when present (~`history/page.tsx:233`).

### 11.4 Problem with Current Behavior
Mixed formats (with/without company, role-first) make the list hard to scan and inconsistent.

### 11.5 Expected Behavior
Default titles follow **`<Company> - <Role>`** strictly:
- Both present → `"{company} - {jobTitle}"`.
- Company missing/empty → `"General - {jobTitle}"`.
- No results yet (in-progress flow) → keep `"New Application - {date}"`.
- A user's manual rename (`processName`, editable inline, max 50 chars) always overrides the default format and is never rewritten.

### 11.6 Benefits
- **Clarity:** Company-first scanning matches how users think about applications.
- **Consistency:** One predictable format, no blank fragments.

### 11.7 Requirements
11.7.1 Update `defaultProcessName` in `src/lib/funnel.ts` to the company-first format with the `"General"` fallback; keep the no-results date fallback.
11.7.2 Keep the `processName` override precedence in `flowDisplayName` unchanged.
11.7.3 Review the company suffix on the history row's date line (`history/page.tsx:233`) so it doesn't duplicate the company now present in the title (drop or adjust it), and ensure no blank " - " fragments render anywhere.
11.7.4 Because titles are computed at render time (not stored), legacy flows update automatically — verify no archived-flow migration is needed beyond this.

### 11.8 Acceptance Criteria
- Completed flows with a known company display "Company - Role".
- Completed flows without a company display "General - Role" — no blank spaces or dangling hyphens.
- In-progress flows still display "New Application - {date}".
- Manually renamed flows keep their custom names.
- The OLD problem (inconsistent, company-less naming) is resolved.

---

## Cross-Topic Sequencing Notes

- **Topic 5 before Topic 4** (tour anchors to the theme toggle's new toolbar position).
- **Topic 3 and Topic 5** touch the same toggles — coordinate in one editing pass of `try-now.tsx`/`workspace.tsx`/`cv-controls.tsx`.
- **Topics 4, 6, 10** all add small custom UI primitives (spotlight overlay, toast, SVG chart) — keep them dependency-free and colocated with existing primitives (`src/components/ui.tsx` or sibling files).
- Guest funnel (`try-now.tsx`) is the primary surface for every topic; Topics 3, 5, 8 (and optionally 9) must also land in the signed-in workspace since the components are shared.
