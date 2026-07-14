# PRD — Chat Enhancements and Fixes (v2)

Supersedes v1. All **Current Behavior** sections below were verified against the codebase (as of 2026-07-14); v1 assumed several behaviors that do not match the implementation (no typing indicator, no smooth scroll, no translation — all of which partially exist). File and component names are real.

---

## 1. Topic 1: Left Pane Synchronization & Chat Layout Overhaul

### 1.1 Context
The left question panel reveals the entire question list the moment the chat opens, defeating the conversational one-question-at-a-time reveal. Separately, the chat transcript sits directly on the page background with no card framing, so the surface feels flat and unpolished.

### 1.2 User Story
As a user, I want a clean, WhatsApp-style chat where upcoming questions stay hidden until the bot asks them, so that I can focus on the current question without being overwhelmed.

### 1.3 Current Behavior
`ChatQuestionPanel` (`src/components/chat-question-panel.tsx`) maps over the **full** sequence from `buildSequence()` (`src/lib/chat-seq.ts`) — every required MCQ, optional MCQ, and open question — grouped under the phase headers "Required" / "Optional" / "In your words". Each row's status is derived by `itemStatus()` (`answered` / `auto` / `skipped` / `pending`); there is **no "asked" status** — chat progress is tracked by the `cursor` / `shownCount` frontier inside `ChatFlow` (`src/components/chat-flow.tsx`), which is not passed to the panel. Layout: the chat screen is a grid `grid gap-6 lg:grid-cols-[240px_1fr]` (`chat-flow.tsx`); the panel is a sticky `<aside>` on desktop and a drawer on mobile (same component); the chat column (`flex min-w-0 flex-col gap-4`) has no card wrapper of its own.

### 1.4 Problem with Current Behavior
Seeing 15+ upcoming questions on load causes cognitive overload and spoils the conversational pacing the chat is built around. The missing container styling makes the transcript blend into the background, lowering perceived quality.

### 1.5 Expected Behavior
The panel must list **only questions the bot has already asked in the transcript** (i.e., items whose index is below the transcript frontier `shownCount` that `ChatFlow` already computes — this includes answered/auto-filled/skipped history restored on reload). Below the last visible question, a single dimmed, non-interactive row reads **"+X more questions…"** (X = remaining hidden count) without revealing any question text. Phase headers appear only once their first question is visible. The same filtered rendering applies to the mobile drawer. The chat column is wrapped in a distinct card container — `border-radius: 16px`, internal padding `24px`, card background with border — and the gap between the panel and the chat card is increased (e.g., `gap-6` → `gap-10` on `lg`).

### 1.6 Benefits
Preserves the one-question-at-a-time reveal (focus, lower cognitive load) while the "+X more" row keeps a sense of progress; the card framing gives the chat a modern, standalone appearance.

### 1.7 Requirements
1.7.1 Pass the transcript frontier from `ChatFlow` into `ChatQuestionPanel` as a new prop (e.g., `askedCount`, fed from `shownCount`).
1.7.2 In `ChatQuestionPanel`, render only `seq` items with index `< askedCount`; keep the existing status dot/label logic for visible rows.
1.7.3 Render a phase header only when at least one question of that phase is visible.
1.7.4 When `seq.length − askedCount > 0`, append one dimmed non-clickable row "+X more questions…" after the last visible item.
1.7.5 Verify the mobile drawer (same component instance in `chat-flow.tsx`) inherits the filtering with no divergence.
1.7.6 Wrap the chat column content in a card container: `rounded-[16px]`, border, card background, `p-6` (24px).
1.7.7 Increase the grid gap between the panel and the chat card (e.g., `lg:gap-10`).

**Assumption:** the count X changes when new questions are appended mid-flow (role-bank "＋ More questions for my role", generated open questions); the row simply re-renders with the updated count.

### 1.8 Acceptance Criteria
- On a fresh flow, after the greeting completes, the panel shows only the first asked question plus "+X more questions…"; no upcoming question text is visible anywhere in the panel or drawer.
- Each new question appears in the panel at exactly the moment the bot asks it in the chat.
- Reloading mid-flow shows all previously asked/answered items in the panel (history restored — no regression), still hiding unasked ones.
- Clicking a visible panel row still opens the edit modal (no regression).
- The chat transcript sits inside a visibly rounded, padded card with clear spacing from the left panel.
- The old problem — full question list visible on load — no longer occurs.

---

## 2. Topic 2: Chat Pacing and Humanization Effects

### 2.1 Context
Scripted bot beats already deliver sequentially with a typing indicator, but the 800ms pause is too short for multi-sentence messages and text still lands as a complete block, so the exchange reads as machine-generated.

### 2.2 User Story
As a user, I want the bot to mimic human typing pauses and reveal text progressively so that I can read messages at a natural pace.

### 2.3 Current Behavior
`chat-script.tsx` already implements: `TypingIndicator` (three bouncing dots), `TypingBotMessage` (indicator for `SCRIPT_TYPING_MS = 800` ms, then the full message pops in with `chat-pop-in`), and `ScriptedBotMessages` (chains messages sequentially via `onDone`). Question bubbles in `ChatFlow` do **not** use this system — they appear with a uniform CSS `chat-fade-in` (`src/app/globals.css`), delayed by `SCRIPT_TYPING_MS + 150` ms when a phase intro precedes them. Restored history renders statically (`animate` is a mount-time decision; `animateItem = i >= initialCursor`). **No typewriter effect exists anywhere** — message text always appears as one block.

### 2.4 Problem with Current Behavior
800ms of "typing" before a two-sentence message is implausibly fast, and the instant block reveal undercuts the human feel. New question bubbles skip the typing indicator entirely, so pacing is inconsistent between scripted beats and questions.

### 2.5 Expected Behavior
Bot messages keep the queue/indicator system, with two upgrades: (1) the typing-indicator delay before each message is raised to **1200–1500 ms**; (2) after the indicator, message text is revealed with a **fast typewriter** effect — characters appended rapidly, with the full message completing within ~1.2 s regardless of length. The same indicator + typewriter treatment also applies to **newly asked question bubbles** at the cursor frontier, gated by the existing `animateItem` / `initialCursor` logic so restored history still renders instantly and statically.

### 2.6 Benefits
Consistent, believable conversational pacing across scripted beats and questions; text is easier to digest; no long waits accumulate in multi-message beats (a 3-message beat stays under ~8 s total).

### 2.7 Requirements
2.7.1 Raise `SCRIPT_TYPING_MS` (`src/components/chat-script.tsx`) from 800 to a value in 1200–1500 (e.g., 1300).
2.7.2 Add a typewriter reveal phase to `TypingBotMessage`: after the indicator, append characters rapidly; cap total reveal duration at ~1.2 s independent of message length.
2.7.3 Fire `onDone` only after the typewriter completes, so `ScriptedBotMessages` continues to chain messages correctly.
2.7.4 Apply the indicator + typewriter treatment to newly asked question bubbles (`BotBubble` rendering in `chat-flow.tsx`), gated by `animateItem` — restored history must render statically with no animation.
2.7.5 Preserve the mount-time `animate` semantics (completed messages render statically after reload).

### 2.8 Acceptance Criteria
- Trigger a multi-message beat (e.g., the personalized greeting): messages appear one at a time, each preceded by ~1.2–1.5 s of the dots indicator.
- Message text types out rapidly rather than appearing as a solid block.
- A newly asked question bubble gets the same indicator + typewriter treatment.
- Reload mid-flow: all history renders instantly with no typing animation (no regression).
- The old problem — messages landing simultaneously as a wall of text — no longer occurs.

---

## 3. Topic 3: Visible Smooth Scrolling

### 3.1 Context
An auto-scroll effect exists and even requests smooth behavior, but in practice the transcript appears to jump — the user cannot visually follow the conversation advancing.

### 3.2 User Story
As a user, I want the chat to glide down visibly when I submit an answer and the conversation continues, so that I keep my visual context.

### 3.3 Current Behavior
`chat-flow.tsx` has a `bottomRef` sentinel `<div>` at the end of the transcript and a `useEffect` that calls `bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })`, keyed on `cursor`, `confirming`, `ackDone`, `greetingDone`, `branchChoice`, and `branchStarted`. Despite `behavior: "smooth"`, the motion is not visible/followable because: `block: "nearest"` yields minimal movement; the effect fires **before** the step's final height exists (the typing indicator is later replaced by the full message — a layout shift the scroll never accounts for); and there is no re-trigger when a message finishes rendering.

### 3.4 Problem with Current Behavior
The user perceives an instant jump (or content appearing below the fold), which is jarring and breaks the modern chat feel.

### 3.5 Expected Behavior
Whenever the user submits an answer and the chat continues, and whenever a bot message finishes rendering (indicator → message swap, typewriter completion), the transcript scrolls to the bottom in a **visible, natural glide** the eye can follow. New content must end up fully in view above the sticky footer (see Topic 5).

### 3.6 Benefits
Maintains spatial context, matches standard chat-app behavior, and makes the pacing work from Topic 2 legible instead of happening off-screen.

### 3.7 Requirements
3.7.1 Change the scroll call to produce visible motion — e.g., `block: "end"` on the sentinel, or smooth-scroll the container to `scrollHeight`.
3.7.2 Re-trigger the scroll when a bot message finishes rendering (hook into the `onDone` / typewriter-completion callbacks from Topic 2), not only on cursor/state changes.
3.7.3 Ensure the scroll runs after the DOM height for the step is final (trigger from completion callbacks rather than solely from the state-change effect), eliminating the pre-layout-shift jump.
3.7.4 Give the sentinel a `scroll-margin-bottom` at least equal to the sticky footer height so "bottom" lands above the footer.

### 3.8 Acceptance Criteria
- Submitting an answer produces a fluid, visible downward scroll.
- When a bot message finishes typing, the transcript glides to keep it fully in view (above the footer).
- The old problem — a 0-frame jump or content appearing hidden below the fold — no longer occurs.
- Scrolling behavior is verified on both desktop and mobile viewports.

---

## 4. Topic 4: Post-Mandatory Buttons and Tooltips

### 4.1 Context
After the mandatory questions, `TransitionBlock` already offers two side-by-side choices, but the labels and styling don't communicate what each choice means or that Generate is the finalization step, and there are no explanatory tooltips.

### 4.2 User Story
As a user, I want clear, distinct choices after the mandatory questions so that I know exactly what happens if I generate now versus continue answering.

### 4.3 Current Behavior
`TransitionBlock` (`src/components/chat-script.tsx`) renders, after the milestone message, a `flex flex-row flex-wrap gap-2` container with **"Continue Answering"** (`Button variant="outline"`, left) and **"Generate Now"** (primary, right). The chosen label is echoed back as a `UserBubble`. There are no tooltips, and no reusable `Tooltip` component exists in the codebase (`src/components/ui.tsx` exports Button / Modal / Spinner / Textarea only; `RewriteTooltip` is a selection-anchored CV tool, not a hover-hint primitive).

### 4.4 Problem with Current Behavior
Users can't tell whether they must keep answering or can finalize immediately, and what value continuing adds — risking drop-offs at the highest-intent moment of the funnel.

### 4.5 Expected Behavior
Two side-by-side buttons (order as today):
- **Left — "Continue"**, green background. Tooltip: *"You can continue answering more questions so we might discover an important detail for the final version—and even if not, at least we'll have a bit more info about you for future jobs."*
- **Right — "Generate CV and report"**, white background. Tooltip: *"At this stage, the system begins generating your CV."*

Tooltips are delivered by a new reusable `Tooltip` component in `src/components/ui.tsx`: shown on hover and keyboard focus on desktop; on touch devices it must be accessible (e.g., press-and-hold or visible on focus) without blocking the button's primary tap action. The `UserBubble` echo of the choice uses the new labels.

### 4.6 Benefits
Clear expectations at the decision point improve conversion and autonomy; a reusable Tooltip primitive serves future UI needs.

### 4.7 Requirements
4.7.1 Rename "Generate Now" → **"Generate CV and report"** in `TransitionBlock` (button and the `UserBubble` echo).
4.7.2 Rename "Continue Answering" → **"Continue"** (button and the `UserBubble` echo).
4.7.3 Style the Generate button with a white background (readable border/text on the card background) and the Continue button with a green background, keeping the side-by-side flex row.
4.7.4 Create a reusable `Tooltip` component in `src/components/ui.tsx` supporting hover + keyboard focus on desktop and a touch-accessible mode on mobile.
4.7.5 Attach the two exact tooltip texts above to their buttons.

**Assumption:** "green" maps to the existing accent/success token in `globals.css` rather than a new hard-coded hex; exact token chosen at implementation time.

### 4.8 Acceptance Criteria
- Completing the mandatory questions shows both buttons side-by-side: "Continue" (green, left) and "Generate CV and report" (white, right).
- Hovering (or focusing) each button shows its exact tooltip copy; on a mobile viewport the tooltip content is reachable and does not swallow the tap.
- Clicking each button still triggers the correct branch, and the user-bubble echo shows the new label (no regression).
- The old problem — unexplained "Generate Now" / "Continue Answering" labels with no guidance — no longer occurs.

---

## 5. Topic 5: Sticky Footer Covering In-Chat Action Buttons

### 5.1 Context
During and after the post-mandatory transition, the sticky bottom action bar floats above the transcript and can cover the in-chat buttons, hiding the user's next step. (Root cause confirmed: it is the sticky footer, not absolute positioning inside the button group as v1 assumed.)

### 5.2 User Story
As a user, I want every available action button fully visible without scrolling, so that I never think I'm stuck.

### 5.3 Current Behavior
`chat-flow.tsx` renders a sticky action footer (`sticky bottom-0 z-10 … bg-bg/90 backdrop-blur`) containing "← Back", a `requiredAnswered/required` counter, and — once a branch is resolved (`generateUnlocked`) — a large **"Generate my reports →"** button. The transcript scrolls beneath this footer. In the optional-questions phase, the current question's editor with its **"Continue →"** button (and the `TransitionBlock` buttons / "Let's Start →" / "Generate Reports →" at the frontier) sit at the transcript's bottom edge and are covered by the footer until the user manually scrolls; the auto-scroll (`block: "nearest"`, Topic 3) does not account for the footer height.

### 5.4 Problem with Current Behavior
A critical UX blocker: the primary "Generate my reports →" CTA visually buries the "Continue →" button, so users may believe they cannot continue and abandon the flow.

### 5.5 Expected Behavior
The footer and the in-chat buttons must be fully visible **simultaneously**, with no overlap and no manual scroll required: the transcript reserves clearance equal to the footer height, and the auto-scroll target lands content above the footer.

### 5.6 Benefits
Restores the continue path during the optional phase, preventing premature termination of the flow.

### 5.7 Requirements
5.7.1 Add bottom clearance so the last transcript element always clears the sticky footer — padding-bottom on the transcript container and/or `scroll-margin-bottom` on the `bottomRef` sentinel equal to the footer height (shared with 3.7.4).
5.7.2 Keep all in-chat CTAs (`TransitionBlock` buttons, "Let's Start →", "Generate Reports →", the editor's "Continue →") in normal document flow (they already are) — the fix is clearance, not repositioning.
5.7.3 Verify the footer's translucent `backdrop-blur` never sits over an interactive control at rest (after auto-scroll settles).

### 5.8 Acceptance Criteria
- In the optional-questions phase, the footer's "Generate my reports →" and the current question's "Continue →" are both fully visible at the same time without scrolling.
- The `TransitionBlock` choice buttons are never covered by the footer.
- Both buttons are clickable in that state.
- The old problem — the Generate button hiding the Continue button until scrolled — no longer occurs, on desktop and mobile widths.

---

## 6. Topic 6: Hebrew Answer Translation (Always, Without Confirmation)

### 6.1 Context
A translate-and-polish pipeline already exists for open answers, but it only engages above a word-count threshold and requires a confirmation step — so short Hebrew answers enter the English transcript raw.

### 6.2 User Story
As a user answering in Hebrew, I want the chat to record my answer as polished English automatically, so that the transcript and the generated CV stay consistent.

### 6.3 Current Behavior
Open answers are typed into the current-question editor; on "Continue →", `continueFrom()` (`src/components/chat-flow.tsx`) commits the raw text as the canonical answer, and the derived timeline renders it as a `UserBubble`. Only when the answer exceeds `CONFIRM_WORD_THRESHOLD = 25` words does it call `POST /api/try/confirm-answer` → `refineAnswer()` (`src/lib/llm.ts`), which translates non-English input and polishes it while preserving every fact; the result is offered in a confirmation box ("Use this wording →" / "No, let me rephrase it") and replaces the answer only on approval. Short Hebrew answers (≤ 25 words) bypass this entirely and appear raw. On API failure or an empty result, the flow keeps the verbatim answer and advances.

### 6.4 Problem with Current Behavior
Raw Hebrew inside an English-localized builder breaks transcript consistency, and unpolished Hebrew reaches the generation payload — the user never sees what the system will actually use.

### 6.5 Expected Behavior
Every **non-English** open answer is translated **regardless of length** and **without a confirmation step**: on submit, the editor shows a loading state while `POST /api/try/confirm-answer` runs; the returned English text is committed as the canonical answer (so the `UserBubble` renders only the English version) and the flow advances automatically. Raw Hebrew is never rendered as a chat bubble. **English answers are unchanged**: ≤ 25 words pass straight through; > 25 words keep the existing confirmation loop. If the API fails or returns empty, fall back to the raw text and advance (never block the user).

### 6.6 Benefits
Consistent English transcript, higher trust (the user sees exactly what the AI recorded), and cleaner input for CV/report generation — with zero added friction for the common short-answer case.

### 6.7 Requirements
6.7.1 Add a client-side language heuristic in `chat-flow.tsx` (e.g., presence of Hebrew Unicode range `֐–׿`, or majority non-Latin characters) classifying an answer as non-English.
6.7.2 In `continueFrom()`, for non-English answers, bypass `CONFIRM_WORD_THRESHOLD` and always call `/api/try/confirm-answer`, showing the existing loading state (`Spinner`) in the editor.
6.7.3 On success, commit the refined English via the existing answer-update path (`handleOpen`) **before** advancing — no confirmation UI on this path.
6.7.4 On failure or empty response, keep the raw answer and advance (preserve the existing fallback).
6.7.5 Keep the English path untouched: ≤ 25 words → straight through; > 25 words → existing confirmation loop.
6.7.6 Reuse the existing `confirm-answer` route and `refineAnswer()` unchanged; if any route change becomes necessary, consult `node_modules/next/dist/docs/` first (non-standard Next.js 16 build, per `AGENTS.md`).

**Assumption:** the raw draft may exist transiently in `state.answers` while typing (the timeline only bubbles it after advancing), so overwriting the answer before `advance()` is sufficient to guarantee the bubble is English-only.

### 6.8 Acceptance Criteria
- Submit a short (< 25 words) Hebrew answer: a loading state appears, then the user bubble shows English; the raw Hebrew never appears as a bubble.
- Submit a long (> 25 words) Hebrew answer: it is translated and committed automatically, with **no** confirmation dialog.
- Submit a short English answer: appears instantly, exactly as today (no regression).
- Submit a long English answer: the existing "Use this wording →" confirmation loop still appears (no regression).
- Simulate an API failure: the raw answer is used and the flow advances — the user is never stuck.

---

## Open Questions

1. **Scroll hijacking (Topic 3):** should auto-scroll be suppressed while the user has manually scrolled up to read history (standard chat-app behavior), resuming only near the bottom?
2. **Greeting reply (Topic 6):** the one-time free-text greeting reply (`GreetingBlock`, `chat-script.tsx`) is appended raw and is currently out of scope — should it get the same translation treatment?
3. **"+X more questions…" count (Topic 1):** open questions and role-bank questions are appended mid-flow, so X grows during the session — acceptable, or should late-loaded questions be excluded from the count?
