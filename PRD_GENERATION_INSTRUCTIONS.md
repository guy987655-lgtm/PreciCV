# PRD Generation Instructions

Use these instructions whenever I want to document a **fix, change, or addition** to PreciCV.

## How I will use this
- I will provide raw explanations **in Hebrew** (free text, screenshots, or voice-style notes) describing what I want fixed/changed/added.
- You will turn my input into a **well-structured PRD written in English**, regardless of the language I write in.
- If my input is missing critical detail (e.g. which component, expected result, edge cases), ask me **up to 3 focused clarifying questions before writing** — but only if the gap genuinely blocks a correct PRD. Otherwise, proceed and state any assumptions explicitly.

## Mandatory content — every PRD must answer four things
For each topic, the PRD must clearly explain:
1. **Current State** — how it works today.
2. **The Problem** — what is wrong / painful / broken about the current state, and why it matters (impact on the user or the product).
3. **Desired State** — the target behavior after the change.
4. **Benefits of the Desired State** — why the new state is better (UX, conversion, clarity, performance, etc.).

## Output format — numbered and clear
Follow this exact structure and numbering style (mirrors our existing PRD format). Number topics sequentially: `Topic 1`, `Topic 2`, ... If I give several unrelated changes at once, create a separate numbered Topic for each.

```
---

## N. Topic N: <Short Descriptive Title>

### N.1 Context
<1–3 sentences framing the area and why this topic exists. This is where the CURRENT STATE and THE PROBLEM are summarized at a high level.>

### N.2 User Story
As a <user type>, I want <goal> so that <benefit>.

### N.3 Current Behavior
<Precise description of how it works today — the CURRENT STATE in detail. Reference concrete components/screens/files where known (e.g. src/app/jobs/[id]/workspace.tsx).>

### N.4 Problem with Current Behavior
<What is wrong with the above and the concrete impact — THE PROBLEM. Be specific about the friction, bug, or missed opportunity.>

### N.5 Expected Behavior
<The DESIRED STATE — exactly how it should work after the change. Unambiguous and testable.>

### N.6 Benefits
<Why the desired state is better — BENEFITS. Tie to user experience, completion/conversion, clarity, maintainability, etc.>

### N.7 Requirements
N.7.1 <Atomic, implementable requirement.>
N.7.2 <Next requirement.>
N.7.3 <...as many as needed; keep each one single-purpose.>

### N.8 Acceptance Criteria
- <Manually verifiable pass/fail condition.>
- <Include at least one criterion confirming the OLD problem no longer occurs.>
- <Cover both the changed case and the unchanged case (no regressions).>
```

## Writing rules
- **Language:** PRD output is always in **English**, even when my input is Hebrew.
- **Tone:** precise, implementation-oriented, no marketing fluff.
- **Specificity:** name real components, files, states, and buttons whenever they can be inferred from the codebase or my notes. Prefer concrete values (colors, thresholds, counts) over vague terms.
- **Testability:** every requirement should be verifiable by a manual acceptance criterion. No test framework is assumed.
- **Assumptions:** if you assume anything, list it under a short `Assumptions` note inside the relevant topic.
- **Scope discipline:** document only what I asked for. Do not invent adjacent features. If you notice a related risk, mention it briefly under `Open Questions` at the end — do not silently expand scope.
- **Tech context reminder:** this is a non-standard Next.js 16 build; when a requirement touches Next-specific behavior, note that implementation must consult `node_modules/next/dist/docs/` per `AGENTS.md`.

## Deliverable
- Save each generated PRD as its own Markdown file in the project folder, named `PRD_<short-slug>_v<n>.md`.
- Then show it to me so I can review.
