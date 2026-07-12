# Product Requirements Document (PRD) — v2
## Project: Resume Builder Optimization & Flow Enhancement (Sprint — Next Release)

> **v2 note:** This revision incorporates the clarification decisions made after the v1 draft. It adds explicit priority tiers, per-item acceptance criteria, and resolves open product questions. Original v1 is preserved separately and unchanged.

---

### 0. Execution Guidance (read first)

**Tech context:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Supabase (SSR), Anthropic SDK. Relevant existing components: `src/components/cv-renderer.tsx`, `src/components/cv-controls.tsx`, `src/components/rewrite-tooltip.tsx`, `src/components/report-page.tsx`, and `src/app/jobs/[id]/workspace.tsx`. ⚠️ This is a non-standard Next.js build — consult `node_modules/next/dist/docs/` before writing Next-specific code (see `AGENTS.md`).

**Sequencing (strict):**
1. **P0 — Bug fixes & core state logic:** §2.1, §2.2, §2.3, §2.4, §3.1. Ship and self-verify these first.
2. **P1 — Interaction features:** §3.2 (zoom), §3.3 (smart bullets), §4.1 (mandatory-question routing).
3. **P2 — Content & structure:** §6 (AI & Automation section).
- Cross-cutting: **targeted Edit-Flow visual polish (§5) is in scope** — apply it alongside the functional work, not as a separate phase. No full redesign.

**Editor decision (applies to §2.1, §2.3, §3.3):** Replace the hand-rolled `contentEditable` with a **headless rich-text library** (TipTap / ProseMirror preferred; a clean Quill implementation acceptable). Keep it lightweight and fully style-controllable — no bloated legacy UI. Stored resume content format **may change freely**: data is pre-launch and disposable, so **no backward-compatibility or migration path is required**.

**Verification:** No test framework exists in the repo, and none is required this sprint. Each requirement below carries **manual acceptance criteria**. Fable self-verifies against them (reproduce → confirm expected result) before marking an item done.

---

### 1. Overview & Objective
Refine the core resume editing experience, fix critical state-management bugs, and elevate the overall UX. This release eliminates visual friction during dark-mode editing, corrects report-generation workflows, makes interactive components more intuitive, and delivers the "perfect finish" Edit Flow — a frictionless, premium, high-control editing workspace — plus strategic AI-focused content optimization.

---

## PRIORITY 0 — Bug Fixes & Core State Logic

### 2. Functional Requirements & Bug Fixes

#### 2.1 Dark Mode Edit Contrast Fix
* **User Story:** As a user editing my resume on a dark-background template, I want to see the text I'm typing clearly so I don't experience eye strain or make typos due to a white-on-white rendering issue.
* **Current Behavior:** On a black/dark-background template, clicking to edit a text field renders white text over a white background (white-on-white), making input invisible while typing.
* **Expected Behavior:**
    * The rich-text editor wrapper must dynamically detect the underlying background color (computed luminance of the container).
    * If the background is dark, the input style toggles to high-contrast mode: crisp white text on a dark charcoal (`#121212`) input surface, **or** a clearly bordered light-gray container with dark text.
    * Caret (`caret-color`) must be explicitly set to contrast with the input background.
* **Acceptance Criteria:**
    * On a dark template, entering edit mode shows visible, high-contrast text and a visible caret from the first keystroke.
    * On a light template, appearance is unchanged.
    * Verified on at least: one dark template and one light template.

#### 2.2 Reset Button Reactivity & State Management
* **User Story:** As a user making experimental edits, I want the "Reset" button to become active immediately upon making changes so I can revert to my last saved state.
* **Current Behavior:** After modifying text, "Reset" stays disabled; it fails to recognize the document is dirty.
* **Expected Behavior:**
    * Client state implements an `isDirty` flag tracking changes against `lastSavedState`.
    * On the first character or formatting change, "Reset" transitions from disabled (`pointer-events: none; opacity: 0.5`) to active/clickable.
    * Clicking "Reset" rolls state back to the exact JSON payload of `lastSavedState` and re-renders the canvas.
* **Acceptance Criteria:**
    * Typing one character enables Reset; reverting all changes (or saving) returns it to disabled.
    * Reset restores the canvas byte-for-byte to `lastSavedState` with no residual edits.

#### 2.3 Rewrite Tooltip Dismissal Logic (Click-Outside)
* **User Story:** As a user of the AI Rewrite feature, I want the tooltip to close when I click anywhere else so my workspace stays clutter-free.
* **Current Behavior:** The tooltip stays open until the user clicks "Use" or presses `Esc`.
* **Expected Behavior:**
    * Add a global click/`blur` listener implementing a `click-outside` pattern.
    * If the tooltip is open and a click lands outside its DOM boundary, it closes automatically **without applying changes**.
    * Existing "Use" and `Esc` behavior remains intact.
* **Acceptance Criteria:**
    * Clicking outside closes the tooltip and discards the suggestion.
    * Clicking inside the tooltip (e.g., to select text) does **not** close it.

#### 2.4 Empty Sections Upon Report Regeneration (Match Analysis & Change Report)
* **User Story:** As a user who modified my resume, I want to regenerate my evaluation report so I can see how my manual changes impacted my Match Analysis and Change Report.
* **Current Behavior:** Clicking regenerate partially fails — the report loads, but "Match Analysis" and "Change Report" return completely empty.
* **Diagnosis-first requirement (suspected state-sync issue):**
    1. **Check the frontend payload first:** verify that when "Refresh Report" is clicked, the API call sends the **newly edited resume state** — not an empty or stale payload. This is the primary suspect.
    2. **If the payload is correct, check the backend/prompt:** ensure the LLM is explicitly instructed to regenerate and return **both** "Match Analysis" and "Change Report" in the expected JSON schema on a refresh event, and that the UI correctly maps/renders them.
* **Definitions (to remove ambiguity):**
    * **Match Analysis** = the current alignment score/breakdown of the (edited) resume against the target Job Description.
    * **Change Report** = the diff/summary of what changed between the **original uploaded resume** and the **current tailored/edited resume**.
* **Expected Behavior:**
    * The regeneration trigger captures and sends the latest edited resume state.
    * The backend processes the updated payload and returns complete data for **all** sections, recalculating Match Analysis and Change Report.
    * The UI maps and renders the new data with no blank components.
* **Acceptance Criteria:**
    * After editing → "Done" → "Refresh Report", both sections render populated, accurate content reflecting the edits.
    * A trace/log (temporary is fine) confirms the edited payload reached the backend.

---

### 3. UI/UX Enhancements & Interaction Rules

#### 3.1 Conditional Activity for "Refresh Report" Button  *(P0)*
* **Context:** Workflow: generate resume/report → enter Edit Mode for final adjustments → update report. In Edit Mode the user can "Reset" (revert to pre-edit state) or "Done" (save changes and exit Edit Mode).
* **User Story:** As the product system, I want to prevent regenerating a report while the user is still editing, so reports are only ever generated against saved, finalized data.
* **Requirement:** "Refresh Report" is fully disabled (unclickable) while the user is in Edit Mode.
* **Logic Flow:**
    * Enter Edit Mode → "Refresh Report" → `disabled=true`.
    * Modify text or click "Reset" → still in Edit Mode → "Refresh Report" stays disabled.
    * Click "Done" → system saves and exits Edit Mode → "Refresh Report" becomes enabled/clickable.
* **Acceptance Criteria:**
    * "Refresh Report" cannot be clicked at any point during Edit Mode.
    * It re-enables only after "Done" persists changes and exits Edit Mode.

---

## PRIORITY 1 — Interaction Features

#### 3.2 Canvas Zoom Functionality in Display Review Mode
* **User Story:** As a user reviewing my final layout, I want to zoom in/out of the canvas to inspect small fonts or check overall structural alignment.
* **Scope (this sprint): desktop only** — trackpad pinch + on-screen control. Mobile/touch zoom is out of scope for this release.
* **Requirement:** Zoom is available **exclusively** in "Display Review" mode (not in Edit Mode).
* **Acceptance Criteria:**
    * A floating zoom control (`[ − ] 100% [ + ]`) sits at the bottom-right or top-right of the viewport wrapper.
    * Supports trackpad pinch-to-zoom, bounded within the preview container.
    * Range **50%–150%** with smooth transitions (`transition: transform 0.2s ease`).
    * Control is hidden/inactive outside Display Review mode.

#### 3.3 Rich-Text Smart Bullet Logic (Enter Key Behavior)
* **User Story:** As a user formatting my experience, I want Enter to create a new bullet automatically, like Word/Notion.
* **Requirement:** Implement via the new headless editor's keyboard handling (this is a primary reason for the editor swap).
* **Logic:**
    * Cursor inside an active list item (`<li>`): pressing `Enter` prevents the default block break and inserts a new sibling `<li>` below, auto-focusing the cursor into it.
    * Pressing `Enter` on an **empty** bullet line deletes that bullet and exits the list block (standard rich-text behavior).
* **Acceptance Criteria:**
    * Enter mid-list creates a new bullet and moves focus into it.
    * Enter on an empty bullet exits the list cleanly (no stray empty `<li>`).
    * Behavior is consistent across the templates used in the editor.

---

### 4. Content Validation & Quality Assurance Rules

#### 4.1 Prevention of "Empty Headers" via Mandatory Intake — with AI Fallback
* **Context:** Workflow begins with the user uploading their original resume + target Job Description. The system analyzes the gap and generates an intake questionnaire (Mandatory Closed, Optional Closed, Open). Only after answering does it generate the tailored resume and simulation reports.
* **User Story:** As a user, I want every entry (Education, Experience, etc.) to include a descriptive summary, so I don't end up with bare titles that look incomplete or unprofessional.
* **Current Behavior:** The generator sometimes produces sections (e.g., Education) with only header info (Degree + Institution) and no description — an unacceptable "empty header."
* **Expected Behavior — "Smart AI Fallback" model:**
    * **Content Completeness Rule:** No entry or section may render as a title only. Every entry requires at least a short description or bullet.
    * **Pre-Generation Validation (Intake Phase):** Before generation, evaluate whether there's enough data to write descriptive text for every identified section.
    * **Dynamic Mandatory Routing:** If a section lacks the info needed for a description (missing coursework, honors, projects, etc.), dynamically generate a relevant question and route it into the **Mandatory Questions** stage. The system does not proceed to generation while genuinely empty sections remain unaddressed.
    * **AI Placeholder Fallback (critical):** Each such mandatory question includes a **"Use AI Placeholder"** action. If the user can't or won't elaborate, the system generates a generic-but-professional description from the header (e.g., for an empty degree: *"Completed comprehensive coursework and projects aligned with core degree requirements."*). This guarantees zero empty headers **without** hard-blocking the funnel.
* **Acceptance Criteria:**
    * Generation never emits a title-only entry.
    * Missing-description sections surface a mandatory question **with** a working "Use AI Placeholder" fallback.
    * Choosing the fallback fills the section with sensible, professional text and lets generation proceed.

---

### 5. Core UX Philosophy: The "Perfect Finish" Edit Flow  *(cross-cutting — targeted polish IN scope)*
* **Strategic Context:** The core value prop is AI-tailored resumes, but AI output rarely matches subjective preference perfectly. The final manual edit is the "last mile" of the journey.
* **Objective:** The editing flow must be frictionless, premium, and high-control. It should feel like a professional, polished workspace — not an afterthought.
* **In-scope polish for this sprint** (apply alongside the functional work, no full redesign):
    * Clear visual distinction between **View Mode** and **Edit Mode** (e.g., mode chrome, borders, subtle backdrop).
    * Micro-animations for state transitions (button enable/disable, tooltip open/close, zoom).
    * Intuitive button placement/repositioning within the Edit Flow.
    * Dark-mode contrast correctness (ties to §2.1).
* **Guiding Principles:**
    * **Zero Friction:** interactions feel instant; text is always legible regardless of template background.
    * **Absolute State Clarity:** the user always knows their mode; external actions (Download/Refresh) are locked during editing and require explicit "Done"/"Reset".
    * **Empowerment over Automation:** tooltips and AI rewrites guide, but the user keeps absolute manual control. Clicking "Done" should feel rewarding and finalize the document for export.
* **Acceptance Criteria:**
    * Mode is unambiguous at a glance in both View and Edit.
    * Key transitions are animated (no abrupt jumps), and nothing feels janky or "unfinished."

---

## PRIORITY 2 — Content & Structure

### 6. Dedicated "AI & Automation" Technical Section
* **Strategic Context:** Job requirements around AI, data analysis, and automation are evolving fast; recruiters and ATS actively scan for explicit AI-tool proficiency. A centralized, highly scannable technical section complements narrative mentions in work history.
* **User Story:** As a candidate, I want a dedicated section aggregating my AI and automation proficiencies as hard technical skills, so recruiters can verify my stack without reading my whole career narrative.
* **Rendering model — hybrid (smart default + manual override):**
    * **Smart Default (conditional):** Auto-generate and display the section **if** AI/automation signals are detected in the user's original data **OR** the target Job Description implicitly/explicitly values technical automation skills.
    * **Manual Override (Empowerment principle):** The user always has a **toggle in the Edit Flow** to show/hide "AI & Automation Expertise," regardless of the system's initial decision.
* **Format Specifications:**
    * Section titled **"AI & Automation Expertise"** (or close variant).
    * **No narrative storytelling** — present as technical data points, categorized lists, or skill badges.
    * Suggested categories: **LLMs / Prompting, Predictive Analytics, Data Automation, Frameworks.** These are the default buckets; **omit any bucket with no relevant content** rather than showing it empty, and it's acceptable to adapt bucket labels to the candidate's actual stack.
    * **Content Aggregation:** Even if an AI tool/process is mentioned contextually within a job entry above, it must **also** be listed here for keyword-scanner visibility.
* **Acceptance Criteria:**
    * Section appears automatically when relevance is detected; absent otherwise.
    * The Edit-Flow toggle reliably shows/hides it and persists the choice for that resume.
    * Rendered content is scannable (lists/badges), non-narrative, with no empty category blocks.

---

### Appendix A — Decision Log (v1 → v2)
1. **Sequencing:** P0 bugs first (§2.1–2.4, §3.1), then P1 features, then P2 content. *(was: unordered mix)*
2. **Visual polish:** targeted Edit-Flow polish is in scope; no full redesign. *(was: ambiguous "soul of the flow")*
3. **AI & Automation section:** hybrid — conditional smart default + Edit-Flow user toggle. *(was: unspecified)*
4. **Mandatory intake:** strict block **with** "Use AI Placeholder" fallback to protect conversion. *(was: hard block only)*
5. **Editor:** replace contentEditable with a headless RTE (TipTap/ProseMirror/clean Quill). *(was: unspecified)*
6. **Storage/migration:** none required — data is pre-launch/disposable. *(newly confirmed)*
7. **Bug 2.4:** diagnose frontend payload first, then backend/prompt; both target sections defined. *(was: undefined root cause + undefined "Change Report")*
8. **Verification:** manual acceptance criteria per item; no test infra this sprint. *(newly specified)*
9. **Zoom:** desktop/trackpad only, 50–150%, Display Review mode only. *(mobile scope clarified out)*
