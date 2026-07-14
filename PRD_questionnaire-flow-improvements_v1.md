# PRD — Questionnaire Flow Improvements (v1)

---

## 1. Topic 1: Auto-Scroll to Newly Loaded Question

### 1.1 Context
In the current questionnaire/assessment flow, users submit an answer and trigger the loading state for the next question. While the new question loads correctly, the viewport remains static. This forces users to manually scroll down to view the newly rendered question, its possible answers, and the primary call-to-action, creating repetitive friction.

### 1.2 User Story
As a user completing a questionnaire, I want the screen to automatically scroll to the next question once it finishes loading so that I can see the question, all possible answers, and the "Continue" button without having to manually scroll.

### 1.3 Current Behavior
When a user selects an answer and submits it, the application enters a loading state to fetch/render the next question. Once the new question is injected into the DOM, the browser viewport maintains its previous Y-axis scroll position. Because the new content appears lower on the page, the question text, the available answer choices, and the "Continue" button remain entirely or partially below the fold (out of view).

### 1.4 Problem with Current Behavior
The static viewport requires the user to perform a manual downward scroll action after every single answer submission. This breaks the momentum of the flow, introduces unnecessary physical friction (especially on mobile devices), and can cause confusion if the user thinks the page hasn't updated.

### 1.5 Expected Behavior
Immediately after the loading state resolves and the new question container is rendered in the DOM, the application will automatically trigger a smooth scroll event. The viewport will align to ensure that the new question text, all possible answers, and the "Continue" button are fully visible on the screen simultaneously.

### 1.6 Benefits
- **Improved UX:** Removes repetitive manual scrolling, creating a seamless user journey.
- **Clarity:** Provides immediate visual feedback that the next question is ready and prompts the user for action by ensuring the "Continue" button is immediately visible.
- **Completion Rate:** Reduces drop-off by maintaining user momentum through the questionnaire flow.

### 1.7 Requirements
1.7.1 The system must detect when the loading state for a new question transitions from `true` to `false` and the new DOM elements are fully mounted.
1.7.2 Upon mounting the new question, trigger a programmatic scroll targeting the newly active question block.
1.7.3 The scroll alignment logic must calculate the viewport height to ensure the question text, the complete list of answers, and the "Continue" button are all in view (e.g., using `element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })` or a custom offset calculation).
1.7.4 If the viewport is already tall enough to encompass the entire question set and the "Continue" button without scrolling, the auto-scroll should not disrupt the view unnecessarily.
1.7.5 **Note on Tech Context:** As this is a non-standard Next.js 16 build, ensure the scroll logic hooks into the correct client-side lifecycle post-mutation (consult `node_modules/next/dist/docs/` per `AGENTS.md`).

### 1.8 Acceptance Criteria
- Verify that answering a question triggers the loading state for the next question.
- Verify that once the loading finishes, the browser automatically smoothly scrolls down so the new question text, all answer options, AND the "Continue" button are completely visible.
- Verify that the OLD problem (having to manually scroll down to see the answers or the button) no longer occurs on desktop or mobile viewports.

---

## 2. Topic 2: Confirmation Modal for "Generate My Report" Button

### 2.1 Context
After completing the mandatory questions, the user enters the optional questions phase. During this phase, a "Generate my report" button becomes available. Because it sits within the same flow as the standard navigation, there is a high risk of accidental clicks.

### 2.2 User Story
As a user answering optional questions, I want a confirmation prompt if I click "Generate my report" so that I don't accidentally skip the remaining optional questions by mistaking it for the "Continue" button.

### 2.3 Current Behavior
During the optional questions phase, the "Generate my report" button is displayed on the screen. Clicking this button immediately halts the questionnaire and triggers the backend generation of the CV and reports.

### 2.4 Problem with Current Behavior
Users moving quickly through the questionnaire may accidentally click the "Generate my report" button instead of the "Continue" button. Because there is no friction or confirmation, this accidental click prematurely ends their session, preventing them from answering the remaining optional questions that could improve their final CV.

### 2.5 Expected Behavior
When a user clicks the "Generate my report" button, the generation process is intercepted. A modal (popup) appears, calculating and displaying the exact number of optional questions remaining. It asks the user for explicit confirmation to proceed with generating the CV and reports.

### 2.6 Benefits
- **Error Prevention:** Eliminates accidental early exits caused by misclicking.
- **Data Enrichment:** Encourages users to complete the optional questions by reminding them that they are leaving questions on the table.
- **User Control:** Makes the destructive/final action of generating the report highly deliberate.

### 2.7 Requirements
2.7.1 Intercept the `onClick` event of the "Generate my report" button.
2.7.2 Calculate the dynamic number of remaining unanswered optional questions (let's call this variable `X`).
2.7.3 Trigger a modal/popup dialog that prevents interaction with the background UI.
2.7.4 The modal must display the following messaging (or highly similar): "You have X optional questions left. Do you want me to start generating your tailored CV and reports?"
2.7.5 The modal must contain two actions: a primary button to confirm ("Yes, generate") and a secondary/cancel button to close the modal ("Cancel" / "Continue answering").
2.7.6 Clicking the cancel button must close the modal and return the user to their current question state without losing data.
2.7.7 Clicking the confirm button must trigger the standard CV/report generation process.

### 2.8 Acceptance Criteria
- Verify that clicking "Generate my report" during the optional phase opens a confirmation modal instead of immediately generating the report.
- Verify that the modal accurately displays the remaining number of optional questions (e.g., if there are 3 left, it says "You have 3 optional questions left").
- Verify that clicking the cancel action closes the modal, and the user can continue answering the current optional question.
- Verify that the OLD problem (accidentally triggering the generation process with a single click) is no longer possible.
- Verify that clicking the confirm action inside the modal successfully initiates the report generation process.
