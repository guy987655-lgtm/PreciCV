import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  Dealbreaker,
  DealbreakerScan,
  DealbreakerScanSchema,
  GenerationResult,
  GenerationResultSchema,
  MasterProfile,
  MasterProfileSchema,
  Questionnaire,
  QuestionnaireSchema,
  TailoredCv,
} from "./types";

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

async function geminiRequest(
  system: string,
  prompt: string,
  maxTokens: number
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
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
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) {
      throw new Error(
        "The free AI quota was exceeded for now. Try again in a minute (Gemini free tier rate limit)."
      );
    }
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text: string = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text) throw new Error("Gemini returned an empty response");
  // Defensive: strip accidental markdown fences.
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
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
});

export async function extractProfileFromCv(
  rawCvText: string
): Promise<{ profile: MasterProfile; questionnaire: Questionnaire }> {
  const result = await structuredCall({
    tier: "quality",
    system:
      "You are the data-ingestion engine of PreciCV, a CV tailoring platform. " +
      "You extract a complete, granular professional profile from raw CV text " +
      "into the Master Data Lake schema. Preserve every fact — do not summarize " +
      "away details, metrics, or technologies. Record the order in which major " +
      "sections appear in the original document in originalSectionOrder " +
      "(e.g. [\"summary\", \"experience\", \"skills\", \"education\"]).",
    prompt:
      `Extract the professional profile from this CV text. Then produce a ` +
      `dynamic questionnaire of 4-7 targeted questions that uncover UNSTATED ` +
      `information that would strengthen tailored CVs: missing metrics ` +
      `(team sizes, revenue impact, performance numbers), unclear scope, ` +
      `gaps in dates, technologies implied but not listed. Each question ` +
      `must reference something specific from THIS CV. In "why", explain in ` +
      `one sentence how the answer improves future tailoring.\n\n` +
      `--- CV TEXT START ---\n${rawCvText.slice(0, 50000)}\n--- CV TEXT END ---`,
    schema: ExtractionSchema,
    toolName: "save_extracted_profile",
    toolDescription:
      "Save the extracted master profile and the gap-filling questionnaire.",
    maxTokens: 16000,
  });
  return result;
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
  "You are the tailoring engine of PreciCV. You produce a custom-tailored, " +
  "STRICTLY ONE-PAGE resume from a candidate's master profile and a target " +
  "job description, plus a transparent change report.\n\n" +
  "Non-negotiable rules:\n" +
  "1. NEVER invent facts, employers, dates, titles, or metrics. Every claim " +
  "must come from the master profile. You may rephrase, reorder, merge and " +
  "cut — never fabricate.\n" +
  "2. THE ONE-PAGE CONSTRAINT IS ABSOLUTE. Edit, summarize and prioritize " +
  "aggressively. Drop experience irrelevant to this JD. Older roles get one " +
  "line. Total body text across all fields must stay under " +
  `${ONE_PAGE_CHAR_BUDGET} characters.\n` +
  "3. Mirror the JD's terminology where the profile genuinely supports it " +
  "(ATS keyword alignment), leading with the most relevant achievements.\n" +
  "4. Respect the original CV's section order (originalSectionOrder) when " +
  "it exists — this replicates the structure of the user's own document.\n" +
  "5. In the diff report, log every meaningful change with type " +
  "added/removed/modified/reordered, the original and updated text, and a " +
  "one-sentence reason tied to the JD.\n" +
  "6. In gapAnalysis, be honest: matchScore 0-100, real strengths, real " +
  "gaps, and concrete recommendations (courses, framing, talking points).\n" +
  "7. Give every section and item a short stable id (e.g. 'exp-1').";

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
    `one-page CV and the full change/diff report.`;

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

  return result;
}
