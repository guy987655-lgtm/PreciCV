import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  Dealbreaker,
  DealbreakerScan,
  DealbreakerScanSchema,
  DiffChangeSchema,
  GenerationResult,
  GenerationResultSchema,
  GreetingInfo,
  GreetingInfoSchema,
  MasterProfile,
  MasterProfileSchema,
  McqQuestionnaire,
  McqQuestionnaireSchema,
  Questionnaire,
  QuestionnaireSchema,
  ReportResult,
  ReportResultSchema,
  RewriteLength,
  TailoredCv,
} from "./types";
import { norm, looseMatch } from "./text";

/**
 * Provider-agnostic LLM engine.
 *
 * - ANTHROPIC_API_KEY set  → Claude (quality first, per the PRD).
 * - GEMINI_API_KEY set     → Google Gemini free tier (no credit card) —
 *                            lets the product run at $0 until it earns.
 * When both are set, Claude wins.
 */

/** Heavy generation model — quality is the absolute priority (PRD §1). */
const CLAUDE_GENERATION_MODEL = "claude-fable-5";
/** Fast/cheap model for pre-generation checks and the questionnaire. */
const CLAUDE_FAST_MODEL = "claude-haiku-4-5-20251001";
const GEMINI_MODEL = "gemini-2.5-flash";

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);
}

export const LLM_NOT_CONFIGURED_MSG =
  "The AI engine isn't configured yet. Set ANTHROPIC_API_KEY (Claude) or " +
  "GEMINI_API_KEY (Google's free tier) on the server.";

type StructuredCallOpts<T> = {
  /** "quality" = heavy tailoring calls; "fast" = cheap pre-checks. */
  tier: "quality" | "fast";
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  toolName: string;
  toolDescription: string;
  maxTokens?: number;
};

async function structuredCall<T>(opts: StructuredCallOpts<T>): Promise<T> {
  if (process.env.ANTHROPIC_API_KEY) return anthropicCall(opts);
  if (process.env.GEMINI_API_KEY) return geminiCall(opts);
  throw new Error(LLM_NOT_CONFIGURED_MSG);
}

/* ------------------------------------------------------------------ */
/* Claude: forced tool call whose input matches the zod schema         */
/* ------------------------------------------------------------------ */

async function anthropicCall<T>(opts: StructuredCallOpts<T>): Promise<T> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const jsonSchema = z.toJSONSchema(opts.schema, { target: "draft-7" });

  const response = await client.messages.create({
    model: opts.tier === "quality" ? CLAUDE_GENERATION_MODEL : CLAUDE_FAST_MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    tools: [
      {
        name: opts.toolName,
        description: opts.toolDescription,
        input_schema: jsonSchema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: opts.toolName },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return structured output");
  }
  return opts.schema.parse(toolUse.input);
}

/* ------------------------------------------------------------------ */
/* Gemini: JSON response mode + schema-in-prompt, zod-validated with   */
/* one self-correction retry                                           */
/* ------------------------------------------------------------------ */

const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash-lite";

async function geminiRequestOnce(
  model: string,
  system: string,
  prompt: string,
  maxTokens: number
): Promise<{ ok: true; text: string } | { ok: false; status: number; body: string }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: maxTokens,
          // Disable "thinking" — it silently eats the output-token budget
          // and can truncate long JSON mid-stream.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );

  if (!res.ok) {
    return { ok: false, status: res.status, body: await res.text() };
  }
  const data = await res.json();
  const text: string = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text) return { ok: false, status: 0, body: "empty response" };
  // Defensive: strip accidental markdown fences.
  return {
    ok: true,
    text: text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
  };
}

/**
 * Gemini with resilience: transient overload (429/500/503) retries with
 * backoff, then falls back to flash-lite (a separate capacity pool).
 */
async function geminiRequest(
  system: string,
  prompt: string,
  maxTokens: number
): Promise<string> {
  const plan: { model: string; delayMs: number }[] = [
    { model: GEMINI_MODEL, delayMs: 0 },
    { model: GEMINI_MODEL, delayMs: 1500 },
    { model: GEMINI_FALLBACK_MODEL, delayMs: 1000 },
  ];
  let last: { status: number; body: string } = { status: 0, body: "" };
  for (const attempt of plan) {
    if (attempt.delayMs) await new Promise((r) => setTimeout(r, attempt.delayMs));
    const res = await geminiRequestOnce(attempt.model, system, prompt, maxTokens);
    if (res.ok) return res.text;
    last = res;
    // Only transient failures are worth retrying / falling back.
    if (![429, 500, 503, 0].includes(res.status)) break;
  }
  if (last.status === 429 || last.status === 503) {
    throw new Error(
      "The free AI engine is briefly overloaded. Please try again in a minute."
    );
  }
  throw new Error(`Gemini API error ${last.status}: ${last.body.slice(0, 300)}`);
}

async function geminiCall<T>(opts: StructuredCallOpts<T>): Promise<T> {
  const jsonSchema = z.toJSONSchema(opts.schema, { target: "draft-7" });
  const basePrompt =
    `${opts.prompt}\n\n` +
    `Respond ONLY with a JSON object that fulfills this task: ` +
    `${opts.toolDescription}\n` +
    `The JSON MUST strictly match this JSON Schema:\n` +
    `${JSON.stringify(jsonSchema)}`;
  const maxTokens = opts.maxTokens ?? 8000;

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nYour previous response was invalid: ${lastError}\n` +
          `Return corrected JSON that strictly matches the schema.`;
    const text = await geminiRequest(opts.system, prompt, maxTokens);
    try {
      const parsed = opts.schema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } catch {
      lastError = "response was not valid JSON";
    }
  }
  throw new Error(`AI returned invalid structured output (${lastError})`);
}

/* ------------------------------------------------------------------ */
/* 1. Baseline extraction from uploaded CV text                        */
/* ------------------------------------------------------------------ */

const ExtractionSchema = z.object({
  profile: MasterProfileSchema,
  questionnaire: QuestionnaireSchema,
  // Tolerate a missing quick check — the funnel simply skips that step.
  mcq: McqQuestionnaireSchema.prefault({}),
});

export async function extractProfileFromCv(
  rawCvText: string,
  targetJdText?: string
): Promise<{
  profile: MasterProfile;
  questionnaire: Questionnaire;
  mcq: McqQuestionnaire;
}> {
  const result = await structuredCall({
    tier: "quality",
    system:
      "You are the data-ingestion engine of SpeCV, a CV tailoring platform. " +
      "You extract a complete, granular professional profile from raw CV text " +
      "into the Master Data Lake schema. Preserve every fact — do not summarize " +
      "away details, metrics, or technologies. Record the order in which major " +
      "sections appear in the original document in originalSectionOrder " +
      "(e.g. [\"summary\", \"experience\", \"skills\", \"education\"]).",
    prompt:
      `Extract the professional profile from this CV text. Then produce TWO ` +
      `question sets:\n\n` +
      `1. "mcq" — a quick check of 8-14 SHORT multiple-choice questions. ` +
      `Ask ONLY what genuinely matters for bridging THIS CV to the target ` +
      `job (when given) — no filler. Mark "required": true on ONLY the ` +
      `questions that are ESSENTIAL to close the gap between the CV and the ` +
      `job (at most 8); everything else is "required": false (optional ` +
      `enrichment). Each question is answerable in one tap and has 3-5 short ` +
      `options grounded in THIS CV plus plausible alternatives. Set ` +
      `"selectType": "single" when exactly one answer is logical (skill ` +
      `level, yes/no, team size, recency); use "ranked" ONLY when picking ` +
      `several and prioritizing them makes sense (e.g. tools used). For ` +
      `questions listing concrete tools/technologies, the LAST option must ` +
      `be "None of these". CRITICAL — "topic" is a CATEGORY, not a ` +
      `per-question label: use AT MOST 4 distinct broad topic values across ` +
      `the whole set (e.g. "SQL & Data", "Visualization", "Leadership"), ` +
      `each shared by several questions. Do NOT add an "Other" option — the ` +
      `UI appends one automatically.\n\n` +
      `COMPLETENESS CHECK (critical): scan the extracted profile for entries ` +
      `that would render as bare headers — an education entry with no ` +
      `coursework/honors/notes, an experience role with no bullets, a project ` +
      `with no description. For EACH such entry ADD one more question to ` +
      `"mcq" with "required": true and topic "Details", asking what to ` +
      `highlight about that specific entry (options: plausible concrete ` +
      `directions like "Relevant coursework", "Final project", "Honors", ` +
      `"Key responsibilities"). On THESE questions ALSO set ` +
      `"placeholderText" to ONE generic-but-professional sentence describing ` +
      `the entry from its header alone (e.g. "Completed comprehensive ` +
      `coursework and projects aligned with core degree requirements."). ` +
      `Leave "placeholderText" as an empty string on every other question.\n\n` +
      `2. "questionnaire" — 4-7 targeted OPEN questions that uncover UNSTATED ` +
      `information that would strengthen tailored CVs: missing metrics ` +
      `(team sizes, revenue impact, performance numbers), unclear scope, ` +
      `gaps in dates, technologies implied but not listed. Each question ` +
      `must reference something specific from THIS CV. In "why", explain in ` +
      `one sentence how the answer improves future tailoring.\n\n` +
      (targetJdText?.trim()
        ? `IMPORTANT: the candidate is targeting the specific job below. Make ` +
          `BOTH question sets laser-focused on bridging the gap between this ` +
          `CV and that job's requirements: probe the skills/tools the job ` +
          `demands, experience the CV under-sells, and anything ambiguous ` +
          `that matters for THIS role.\n` +
          `--- TARGET JOB START ---\n${targetJdText.slice(0, 20000)}\n` +
          `--- TARGET JOB END ---\n\n`
        : "") +
      `--- CV TEXT START ---\n${rawCvText.slice(0, 50000)}\n--- CV TEXT END ---`,
    schema: ExtractionSchema,
    toolName: "save_extracted_profile",
    toolDescription:
      "Save the extracted master profile, the quick multiple-choice check, " +
      "and the gap-filling questionnaire.",
    maxTokens: 16000,
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* 1a. Greeting facts from the JD — powers the chat's personalized     */
/*     opening ("…you're interested in the X position")                */
/* ------------------------------------------------------------------ */

/**
 * Extracts the target job title + field from the JD and whether the
 * candidate's current role sits in the same field. Takes raw CV text (not the
 * parsed profile) so it can run concurrently with extractProfileFromCv.
 */
export async function analyzeJdGreeting(
  jdText: string,
  rawCvText: string
): Promise<GreetingInfo> {
  return structuredCall({
    tier: "fast",
    system:
      "You extract greeting facts for a CV-tailoring chat. From a job " +
      "description you identify the job title and its professional field; " +
      "from the candidate's CV you infer their current field and judge " +
      "whether it is the same field as the job's.",
    prompt:
      `From the JOB DESCRIPTION extract:\n` +
      `- targetJobTitle: the exact position title being hired for, cleaned of ` +
      `req numbers/locations (e.g. "Senior Data Analyst").\n` +
      `- field: a SHORT human label for the job's professional field, 1-3 ` +
      `words (e.g. "Data Analytics", "Product Management").\n` +
      `Then from the CANDIDATE CV infer the candidate's current professional ` +
      `field (their most recent role) and set:\n` +
      `- sameField: true only when the candidate's current field and the ` +
      `job's field are essentially the same line of work (a seniority step ` +
      `within one field is the SAME field; analyst → marketing is NOT).\n\n` +
      `--- JOB DESCRIPTION START ---\n${jdText.slice(0, 6000)}\n` +
      `--- JOB DESCRIPTION END ---\n\n` +
      `--- CANDIDATE CV START ---\n${rawCvText.slice(0, 2500)}\n` +
      `--- CANDIDATE CV END ---`,
    schema: GreetingInfoSchema,
    toolName: "save_greeting_info",
    toolDescription:
      "Save the job title, field label, and same-field verdict for the greeting.",
    maxTokens: 300,
  });
}

/* ------------------------------------------------------------------ */
/* 1b. Role-standard question bank: what the job market expects of     */
/*     this role → one experience question per topic                   */
/* ------------------------------------------------------------------ */

export async function generateRoleQuestions(
  profile: MasterProfile,
  existingTopics: string[],
  existingQuestions: string[] = []
): Promise<McqQuestionnaire> {
  const roleSummary =
    `Headline: ${profile.headline}\n` +
    `Recent titles: ${profile.experience
      .slice(0, 3)
      .map((e) => e.title)
      .filter(Boolean)
      .join("; ")}\n` +
    `Skills: ${profile.skills.join(", ")}\n` +
    `Summary: ${profile.summary}`;

  return structuredCall({
    tier: "fast",
    system:
      "You are the market-research engine of SpeCV. You know the standard " +
      "requirements, tools and skills that appear in real job postings " +
      "across the web (LinkedIn, Indeed, company career pages) for any " +
      "role. You turn that market standard into short experience questions.",
    prompt:
      `Candidate role profile:\n${roleSummary}\n\n` +
      `Identify 20-35 requirements/skills/tools that employers TYPICALLY ` +
      `list in job postings for this role — the standard market toolkit, ` +
      `including ones missing from the candidate's own skill list. For EACH ` +
      `topic produce ONE short multiple-choice question about the ` +
      `candidate's hands-on experience with it. These are ALL optional ` +
      `enrichment — set "required": false on every question. Options must ` +
      `be short and one-tap answerable: either experience levels ("Use it ` +
      `daily", "Used it in past roles", "Basic familiarity", "No ` +
      `experience") or concrete tool choices. Set "selectType": "single" ` +
      `when exactly one answer is logical (levels, yes/no, amounts); use ` +
      `"ranked" ONLY when picking several and prioritizing makes sense. For ` +
      `questions listing concrete tools, the LAST option must be "None of ` +
      `these". CRITICAL — "topic" is a CATEGORY, not a per-question label: ` +
      `group ALL questions under at most 5 broad topic values (e.g. "Data & ` +
      `SQL", "BI & Visualization", "Cloud & Tooling", "Statistics", ` +
      `"Leadership"), each covering several questions; reuse the existing ` +
      `category names below when they fit. Do NOT add an "Other" option — ` +
      `the UI appends one automatically.\n\n` +
      `Existing categories already covered (reuse fitting category names):\n` +
      `${existingTopics.join("; ") || "(none)"}\n\n` +
      `Questions the candidate has ALREADY been asked — do NOT repeat these or ` +
      `ask a reworded/near-duplicate of any of them:\n` +
      `${existingQuestions.map((q) => `- ${q}`).join("\n") || "(none)"}`,
    schema: McqQuestionnaireSchema,
    toolName: "save_role_questions",
    toolDescription:
      "Save the role-standard experience questions derived from typical " +
      "job-market requirements.",
    maxTokens: 10000,
  });
}

/* ------------------------------------------------------------------ */
/* 2. Pre-generation dealbreaker scan (fast + cheap, runs BEFORE any   */
/*    credit is consumed)                                              */
/* ------------------------------------------------------------------ */

export async function scanDealbreakers(
  jdText: string,
  dealbreakers: Dealbreaker[]
): Promise<DealbreakerScan> {
  if (dealbreakers.length === 0) return { hits: [] };

  const list = dealbreakers
    .map((d) => `- [${d.id}] (${d.category}) ${d.description}`)
    .join("\n");

  return structuredCall({
    tier: "fast",
    system:
      "You are a strict pre-screening engine. You check whether a job " +
      "description conflicts with a candidate's absolute non-negotiables " +
      "(dealbreakers). Only report a hit when the JD contains real evidence " +
      "of a conflict; quote that evidence verbatim. Do not invent conflicts.",
    prompt:
      `Candidate dealbreakers:\n${list}\n\n` +
      `Job description:\n---\n${jdText.slice(0, 30000)}\n---\n\n` +
      `Report every dealbreaker the JD conflicts with. For each hit include ` +
      `the dealbreaker id, its text, the verbatim JD evidence, and your ` +
      `confidence. If there are no conflicts return an empty hits array.`,
    schema: DealbreakerScanSchema,
    toolName: "report_dealbreaker_scan",
    toolDescription: "Report dealbreaker conflicts found in the JD.",
    maxTokens: 2000,
  });
}

/* ------------------------------------------------------------------ */
/* 3. The Tailoring Engine                                             */
/* ------------------------------------------------------------------ */

/**
 * Rough 1-page budget. An A4 page at ~10.5pt with tight margins fits about
 * 3,400-3,800 characters of body text; we validate against a conservative
 * budget and ask the model to compress if exceeded.
 */
const ONE_PAGE_CHAR_BUDGET = 3600;

export function estimateCvChars(cv: TailoredCv): number {
  let n = cv.headline.length + cv.summary.length + cv.skills.join(", ").length;
  for (const section of cv.sections) {
    n += section.title.length + 10;
    for (const item of section.items) {
      n += item.primary.length + item.secondary.length + item.meta.length + 10;
      n += item.bullets.reduce((a, b) => a + b.length + 4, 0);
    }
  }
  return n;
}

const TAILORING_SYSTEM =
  "You are the tailoring engine of SpeCV. You produce a custom-tailored, " +
  "STRICTLY ONE-PAGE resume from a candidate's master profile and a target " +
  "job description, plus a transparent change report.\n\n" +
  "Non-negotiable rules:\n" +
  "1. NEVER invent facts, employers, dates, titles, or metrics. Every claim " +
  "must come from the master profile. You may rephrase, reorder, merge and " +
  "cut — never fabricate.\n" +
  "2. THE ONE-PAGE CONSTRAINT IS ABSOLUTE. Edit, summarize and prioritize " +
  "aggressively. If a role is not relevant to this job, drop it ENTIRELY. " +
  "But every role you keep MUST have at least one bullet describing what the " +
  "person did — never output a job with a title and dates but no bullets. " +
  "Shorten by cutting the NUMBER of bullets (an old or minor role can keep " +
  "just one tight line), never down to zero. Total body text across all " +
  `fields must stay under ${ONE_PAGE_CHAR_BUDGET} characters.\n` +
  "2b. Put the professional summary ONLY in the top-level 'summary' field. " +
  "Do NOT also create a section titled 'Summary' or 'Profile' — that would " +
  "duplicate it. Never emit an empty section or an item with no content.\n" +
  "3. Mirror the JD's terminology where the profile genuinely supports it " +
  "(ATS keyword alignment), leading with the most relevant achievements.\n" +
  "4. Respect the original CV's section order (originalSectionOrder) when " +
  "it exists — this replicates the structure of the user's own document.\n" +
  "5. In the diff report, log every meaningful change with type " +
  "added/removed/modified/reordered, the original and updated text, and a " +
  "one-sentence reason tied to the JD. For a 'reordered' entry, put the item " +
  "text in 'updated' only and leave 'original' empty — never repeat the exact " +
  "same text in both fields.\n" +
  "6. In gapAnalysis, be honest: matchScore 0-100, real strengths, real " +
  "gaps, and concrete recommendations (courses, framing, talking points).\n" +
  "7. Give every section and item a short stable id (e.g. 'exp-1').\n" +
  "8. In 'simulation', prepare the candidate for THIS job's interview: a " +
  "30-second elevator pitch in the candidate's voice, and 6-8 questions " +
  "this employer is likely to ask (mix of role-specific, behavioral, and " +
  "gap-probing). For each: whyTheyAsk (one sentence), howToAnswer — " +
  "concrete guidance grounded ONLY in the candidate's real background — " +
  "and 'tone': how the interviewer will ask it ('friendly' = warm " +
  "rapport-building, 'curious' = genuinely probing for detail, " +
  "'challenging' = skeptical, pressure-testing a gap).\n" +
  "9. AI & AUTOMATION SECTION: IF the candidate's profile shows real " +
  "AI/automation signals (LLM tools, prompt engineering, ML/predictive " +
  "analytics, workflow automation, data pipelines) OR the job description " +
  "values such skills AND the profile supports at least some of them, add " +
  "a section with id 'ai-automation' titled 'AI & Automation Expertise'. " +
  "STRICTLY non-narrative and scannable: each item is one category — " +
  "item.primary = a category label adapted to the candidate's real stack " +
  "(defaults: 'LLMs / Prompting', 'Predictive Analytics', 'Data " +
  "Automation', 'Frameworks'), item.bullets = ONE line listing the " +
  "concrete tools/skills, comma-separated. OMIT any category with no real " +
  "content — never render an empty bucket. AGGREGATE: any AI tool already " +
  "mentioned inside a work entry must ALSO be listed here for keyword " +
  "scanners. Never invent proficiency the profile doesn't support; when " +
  "there are no genuine signals, do NOT add the section at all.";

/**
 * Safety net for the "blank role" bug: the model must never leave a kept
 * experience entry with a title/dates but no bullets. When it does, we
 * borrow the strongest bullet for that exact company/title straight from
 * the base profile (the uploaded CV + mandatory answers) — no invention,
 * strictly the user's own material. Empty and summary-duplicate sections
 * are dropped so the rendered CV stays clean.
 */
function repairCv(cv: TailoredCv, profile: MasterProfile): TailoredCv {
  for (const section of cv.sections) {
    const kind = norm(section.title);
    // Sections whose entries must carry a description (§4.1 Content
    // Completeness Rule). Short-list sections (languages, certifications,
    // "AI & Automation Expertise"…) legitimately render as bare lines —
    // whole words only, so e.g. "expertise" ≠ "experience".
    const needsDescription =
      /\b(experience|work|employment|career|education|academic|studies|projects?)\b/.test(
        kind
      );
    for (const item of section.items) {
      if (item.bullets.length > 0) continue;
      const match = profile.experience.find(
        (e) =>
          (e.company && item.secondary && looseMatch(e.company, item.secondary)) ||
          (e.title && item.primary && looseMatch(e.title, item.primary))
      );
      if (match && match.bullets.length > 0) {
        item.bullets = [match.bullets[0]];
      } else if (
        needsDescription &&
        (item.primary.trim() || item.secondary.trim())
      ) {
        // §4.1 backstop — never emit a title-only entry: synthesize a
        // generic professional line from the entry's own header.
        item.bullets = [
          /educ|stud/.test(kind)
            ? `Completed comprehensive coursework and projects aligned with core ${
                item.primary.trim() || "degree"
              } requirements.`
            : /project/.test(kind)
              ? `Designed and delivered ${
                  item.primary.trim() || "the project"
                } end-to-end, covering its core goals and implementation.`
              : `Delivered the role's core responsibilities and day-to-day contributions${
                  item.secondary.trim() ? ` at ${item.secondary.trim()}` : ""
                }.`,
        ];
      }
    }
  }
  // Drop sections that merely duplicate the top-level summary, plus any
  // section left with no usable items.
  cv.sections = cv.sections.filter((section) => {
    const title = norm(section.title);
    if (cv.summary && (title === "summary" || title === "profile")) return false;
    const usable = section.items.filter(
      (it) =>
        it.primary.trim() ||
        it.secondary.trim() ||
        it.meta.trim() ||
        it.bullets.length > 0
    );
    section.items = usable;
    return usable.length > 0;
  });
  return cv;
}

export async function generateTailoredCv(
  profile: MasterProfile,
  jdText: string,
  opts?: { revisionInstructions?: string; previousCv?: TailoredCv }
): Promise<GenerationResult> {
  const basePrompt =
    `MASTER PROFILE (single source of truth):\n` +
    `${JSON.stringify(profile, null, 1)}\n\n` +
    `TARGET JOB DESCRIPTION:\n---\n${jdText.slice(0, 30000)}\n---\n` +
    (opts?.previousCv
      ? `\nPREVIOUS TAILORED CV (revise this, do not start over):\n` +
        `${JSON.stringify(opts.previousCv, null, 1)}\n`
      : "") +
    (opts?.revisionInstructions
      ? `\nUSER REVISION INSTRUCTIONS:\n${opts.revisionInstructions}\n`
      : "") +
    `\nAlso extract jobTitle and company from the JD. Produce the tailored ` +
    `one-page CV, the full change/diff report, and the interview ` +
    `simulation (pitch + likely questions with guidance).`;

  let result = await structuredCall({
    tier: "quality",
    system: TAILORING_SYSTEM,
    prompt: basePrompt,
    schema: GenerationResultSchema,
    toolName: "save_tailored_cv",
    toolDescription: "Save the tailored one-page CV and its diff report.",
    maxTokens: 16000,
  });

  // Layout validation: enforce the 1-page budget with one compression retry.
  if (estimateCvChars(result.cv) > ONE_PAGE_CHAR_BUDGET) {
    result = await structuredCall({
      tier: "quality",
      system: TAILORING_SYSTEM,
      prompt:
        basePrompt +
        `\n\nYOUR PREVIOUS ATTEMPT WAS TOO LONG ` +
        `(${estimateCvChars(result.cv)} chars > ${ONE_PAGE_CHAR_BUDGET}). ` +
        `Compress harder: cut the least JD-relevant content first. Here is ` +
        `that attempt to compress:\n${JSON.stringify(result.cv, null, 1)}`,
      schema: GenerationResultSchema,
      toolName: "save_tailored_cv",
      toolDescription: "Save the compressed tailored CV and its diff report.",
      maxTokens: 16000,
    });
  }

  result.cv = repairCv(result.cv, profile);
  return result;
}

/* ------------------------------------------------------------------ */
/* 4. Report regeneration — rebuild diff + simulation around an        */
/*    already-edited CV WITHOUT re-tailoring the CV itself             */
/* ------------------------------------------------------------------ */

/**
 * §2.4 root cause: GenerationResultSchema's defaulted fields are OPTIONAL in
 * the derived JSON schema, so the model may legally omit gapAnalysis/changes
 * and zod silently backfills empty shapes — the "empty Match Analysis /
 * Change Report" bug. This strict variant makes them required and non-empty,
 * so omission becomes a parse failure that triggers a corrective retry.
 */
const StrictReportSchema = z.object({
  diff: z.object({
    changes: z.array(DiffChangeSchema).min(1),
    gapAnalysis: z.object({
      matchScore: z.number().min(0).max(100),
      strengths: z.array(z.string()).min(1),
      gaps: z.array(z.string()).min(1),
      recommendations: z.array(z.string()).min(1),
    }),
  }),
  simulation: z.object({
    pitch: z.string().min(1),
    questions: z
      .array(
        z.object({
          question: z.string(),
          whyTheyAsk: z.string().default(""),
          howToAnswer: z.string().default(""),
          tone: z.enum(["friendly", "curious", "challenging"]).default("curious"),
        })
      )
      .min(3),
  }),
  jobTitle: z.string().default(""),
  company: z.string().default(""),
});

/**
 * The user edited their CV inline; this rebuilds the change report and
 * interview simulation so the deliverables stay in sync — the CV text is
 * treated as final and is never modified.
 *
 * §2.4 definitions: the Change Report diffs the ORIGINAL resume data
 * (`profile` — the uploaded CV's extraction — falling back to `baseCv`, the
 * first AI draft) against the FINAL edited CV; the Match Analysis re-scores
 * the FINAL CV against the JD. Both are explicitly required to be non-empty,
 * with one corrective retry if the model under-fills either.
 */
export async function regenerateReport(
  finalCv: TailoredCv,
  jdText: string,
  opts?: { baseCv?: TailoredCv; profile?: MasterProfile }
): Promise<ReportResult> {
  const prompt =
    `The candidate's FINAL, user-approved tailored CV is below. It is fixed — ` +
    `do NOT rewrite, shorten or change it. Produce ONLY (a) the change/diff ` +
    `report and (b) the interview simulation for THIS exact CV against the ` +
    `target job.\n\n` +
    `FINAL TAILORED CV:\n${JSON.stringify(finalCv, null, 1)}\n\n` +
    (opts?.profile
      ? `ORIGINAL RESUME DATA (as uploaded — the Change Report compares the ` +
        `FINAL CV against this):\n${JSON.stringify(opts.profile, null, 1)}\n\n`
      : "") +
    (opts?.baseCv
      ? `PREVIOUS AI-GENERATED CV (interim reference for what changed):\n` +
        `${JSON.stringify(opts.baseCv, null, 1)}\n\n`
      : "") +
    `TARGET JOB DESCRIPTION:\n---\n${jdText.slice(0, 30000)}\n---\n\n` +
    `Also extract jobTitle and company from the JD.\n\n` +
    `YOU MUST RETURN ALL OF THE FOLLOWING — none may be empty:\n` +
    `1. "changes" (the Change Report): every meaningful difference between ` +
    `the original resume data and the FINAL CV — rephrasings, additions, ` +
    `removals, reordering. There is always at least one entry unless the two ` +
    `are literally identical.\n` +
    `2. "gapAnalysis" (the Match Analysis): matchScore 0-100 scoring THIS ` +
    `final CV against the job, plus non-empty strengths, gaps and concrete ` +
    `recommendations.\n` +
    `3. "simulation": the pitch and 6-8 interview questions grounded ONLY in ` +
    `the CV's real content.`;

  const call = (extra = "") =>
    structuredCall({
      tier: "quality",
      system: TAILORING_SYSTEM,
      prompt: prompt + extra,
      schema: StrictReportSchema,
      toolName: "save_report",
      toolDescription:
        "Save the change report (diff.changes), match analysis " +
        "(diff.gapAnalysis) and interview simulation for the final CV. " +
        "ALL fields are required and must be non-empty.",
      maxTokens: 8000,
    });

  // The strict schema turns an omitted section into a parse failure; the
  // provider layers already re-prompt once on that. One more outer retry
  // covers a model that parses but still under-delivers semantically.
  let result: ReportResult;
  try {
    result = ReportResultSchema.parse(await call());
  } catch (e) {
    console.warn("[report-regen] strict parse failed — corrective retry:", e);
    result = ReportResultSchema.parse(
      await call(
        `\n\nYOUR PREVIOUS ATTEMPT OMITTED OR LEFT EMPTY one of "changes", ` +
          `"gapAnalysis" or "simulation". Every field listed above is ` +
          `MANDATORY and must be fully populated.`
      )
    );
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* 5. Snippet rewrite — reword a highlighted piece of CV text          */
/* ------------------------------------------------------------------ */

const RewriteSchema = z.object({ text: z.string() });

/**
 * Rewrites a highlighted CV snippet (a bullet, a headline, a summary line).
 * `length` nudges the structure: "short" = tighter/one line, "long" = a fuller
 * version with more concrete detail. Never invents facts — rephrases only.
 */
export async function rewriteSnippet(
  text: string,
  opts?: { length?: RewriteLength; context?: string; jdText?: string }
): Promise<string> {
  const lengthRule =
    opts?.length === "short"
      ? "Make it noticeably SHORTER and punchier — one tight line, lead with impact."
      : opts?.length === "long"
        ? "Make it FULLER — add concrete specificity (scope, action, result) but stay to at most two lines and never fabricate."
        : "Keep roughly the same length; sharpen the wording.";

  const result = await structuredCall({
    tier: "fast",
    system:
      "You are a resume line editor. You rewrite a single snippet of a CV to " +
      "be crisper and more impactful. NEVER invent facts, metrics, employers " +
      "or dates — only rephrase what is given. Keep the candidate's voice. " +
      "Return plain text with no surrounding quotes, labels or markdown.",
    prompt:
      `Rewrite this CV snippet.\n${lengthRule}\n\n` +
      (opts?.context ? `Where it appears: ${opts.context}\n` : "") +
      (opts?.jdText
        ? `Target job (mirror its terminology only where the snippet already ` +
          `supports it):\n---\n${opts.jdText.slice(0, 4000)}\n---\n`
        : "") +
      `\nSNIPPET:\n${text.slice(0, 2000)}`,
    schema: RewriteSchema,
    toolName: "save_rewrite",
    toolDescription: "Save the rewritten snippet text.",
    maxTokens: 1000,
  });
  return result.text.trim();
}

/* ------------------------------------------------------------------ */
/* 6. Sharpen-step smart placeholders — example answers per open       */
/*    question, grounded in the candidate's own CV                     */
/* ------------------------------------------------------------------ */

const SuggestionsSchema = z.object({
  suggestions: z.array(z.object({ id: z.string(), answer: z.string() })),
});

/**
 * Generates a realistic EXAMPLE answer for each open question, grounded in the
 * candidate's profile, to seed the Sharpen-step inputs as inspiration
 * placeholders. These are illustrative — the user overwrites them.
 */
export async function suggestOpenAnswers(
  profile: MasterProfile,
  questions: { id: string; question: string; why?: string }[]
): Promise<Record<string, string>> {
  if (questions.length === 0) return {};
  const profileSummary =
    `Headline: ${profile.headline}\n` +
    `Summary: ${profile.summary}\n` +
    `Recent experience: ${profile.experience
      .slice(0, 4)
      .map((e) => `${e.title} at ${e.company} — ${e.bullets.slice(0, 2).join("; ")}`)
      .join(" | ")}\n` +
    `Skills: ${profile.skills.join(", ")}`;

  const result = await structuredCall({
    tier: "fast",
    system:
      "You help a candidate answer gap-filling questions about their own CV. " +
      "For each question you draft a SHORT, plausible example answer written " +
      "in the first person, grounded in the candidate's real background. It " +
      "is a suggestion the user will edit — keep it to one concise sentence, " +
      "concrete but not fabricated beyond what the profile implies.",
    prompt:
      `Candidate profile:\n${profileSummary}\n\n` +
      `For EACH question below, return an example first-person answer keyed ` +
      `by the question id. Questions:\n` +
      questions
        .map((q) => `- [${q.id}] ${q.question}${q.why ? ` (why: ${q.why})` : ""}`)
        .join("\n"),
    schema: SuggestionsSchema,
    toolName: "save_suggestions",
    toolDescription: "Save one example answer per question id.",
    maxTokens: 2000,
  });
  const out: Record<string, string> = {};
  for (const s of result.suggestions) {
    if (s.answer.trim()) out[s.id] = s.answer.trim();
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 7. Open-answer confirmation loop (PRD 2.5) — professionally rewrite */
/*    the user's answer; once approved it replaces the raw text        */
/*    everywhere (chat bubble, edit panel, generation payload)         */
/* ------------------------------------------------------------------ */

const RefinedAnswerSchema = z.object({ refined: z.string() });

/**
 * Reformulates a free-text answer into polished professional English for the
 * chat confirmation step. Translation + polish only: every fact, number, name
 * and detail is preserved. Invoked only when the answer is long enough to be
 * worth confirming (the caller decides), so short answers never pay this
 * round-trip. The approved text becomes the canonical answer.
 */
export async function refineAnswer(
  question: string,
  answer: string
): Promise<string> {
  const result = await structuredCall({
    tier: "fast",
    system:
      "You rewrite a candidate's answer to a screening question as polished, " +
      "professional first-person English prose. Translate to English when the " +
      "answer is in another language. PRESERVE EVERY fact, number, name, " +
      "technology and detail — do NOT add facts, drop details, summarize, or " +
      "give advice. Keep roughly the same length as the original. Return " +
      "plain text — no quotes, labels or markdown.",
    prompt:
      `Question: ${question}\n\nCandidate's answer:\n${answer.slice(0, 4000)}\n\n` +
      `Rewrite the answer professionally, keeping all of its details.`,
    schema: RefinedAnswerSchema,
    toolName: "save_refined_answer",
    toolDescription: "Save the professionally rewritten answer.",
    maxTokens: 1200,
  });
  return result.refined.trim();
}
