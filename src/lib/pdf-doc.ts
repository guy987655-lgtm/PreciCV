import { z } from "zod";
import {
  CV_TEMPLATES,
  DiffReportSchema,
  InterviewSimulationSchema,
  TailoredCvSchema,
} from "./types";

/**
 * The contract between "a document on screen" and "a PDF file".
 *
 * Everything the renderer needs travels in the request. That is deliberate:
 * two of the four download surfaces — the anonymous funnel and History — hold
 * their CV in localStorage and NOWHERE else, so a server that looked the
 * document up by id could never serve them. Posting the document instead gives
 * all four surfaces one code path.
 */

export const PrintDocSchema = z.object({
  target: z.enum(["cv", "report"]),
  /** Names the file — see pdfFileName. */
  meta: z.object({
    name: z.string().max(200).default(""),
    company: z.string().max(200).default(""),
  }),
  cv: TailoredCvSchema,
  template: z.enum(CV_TEMPLATES).default("classic"),
  theme: z.enum(["light", "dark"]).default("light"),
  split: z.boolean().default(false),
  /* ---- the report needs the rest of the generation ---- */
  diff: DiffReportSchema.nullable().default(null),
  simulation: InterviewSimulationSchema.nullable().default(null),
  jobTitle: z.string().max(300).default(""),
  company: z.string().max(300).default(""),
});

export type PrintDoc = z.infer<typeof PrintDocSchema>;

function slug(s: string): string {
  return s
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The downloaded file's name.
 *
 *   CV     → SpeCV-Guy-Ratzon-PayPal.pdf
 *   Report → SpeCV-Guy-Ratzon-PayPal-Interview-Report.pdf
 *
 * Deliberately carries no timestamp. An earlier version appended one to dodge
 * the OS "replace existing file?" prompt, but the noise meant users renamed
 * the file by hand before attaching it to an application — a predictable name
 * is worth the occasional replace prompt. The report keeps its suffix so
 * "download both" cannot emit two files with the same name.
 */
export function pdfFileName(
  target: "cv" | "report",
  meta: { name?: string; company?: string }
): string {
  const parts = [
    "SpeCV",
    slug(meta.name || "candidate"),
    meta.company ? slug(meta.company) : "",
    target === "report" ? "Interview-Report" : "",
  ].filter(Boolean);
  return `${parts.join("-")}.pdf`;
}
