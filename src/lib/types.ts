import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Master Data Lake — the single immutable source of truth per user    */
/* ------------------------------------------------------------------ */

export const ContactSchema = z.object({
  fullName: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  location: z.string().default(""),
  linkedin: z.string().default(""),
  website: z.string().default(""),
});

export const ExperienceSchema = z.object({
  company: z.string().default(""),
  title: z.string().default(""),
  location: z.string().default(""),
  startDate: z.string().default(""),
  endDate: z.string().default(""),
  current: z.boolean().default(false),
  bullets: z.array(z.string()).default([]),
  technologies: z.array(z.string()).default([]),
});

export const EducationSchema = z.object({
  institution: z.string().default(""),
  degree: z.string().default(""),
  field: z.string().default(""),
  startYear: z.string().default(""),
  endYear: z.string().default(""),
  notes: z.string().default(""),
});

export const ProjectSchema = z.object({
  name: z.string().default(""),
  description: z.string().default(""),
  link: z.string().default(""),
});

export const MasterProfileSchema = z.object({
  contact: ContactSchema.prefault({}),
  headline: z.string().default(""),
  summary: z.string().default(""),
  experience: z.array(ExperienceSchema).default([]),
  education: z.array(EducationSchema).default([]),
  skills: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  projects: z.array(ProjectSchema).default([]),
  /** Original CV section order — used for layout replication */
  originalSectionOrder: z.array(z.string()).default([]),
  /** Free-form facts collected via the dynamic questionnaire */
  additionalFacts: z.array(z.string()).default([]),
});
export type MasterProfile = z.infer<typeof MasterProfileSchema>;

/* ------------------------------------------------------------------ */
/* Dealbreakers ("Red Flags" module)                                   */
/* ------------------------------------------------------------------ */

export const DealbreakerSchema = z.object({
  id: z.string(),
  category: z.enum([
    "technology",
    "location",
    "work_model",
    "industry",
    "seniority",
    "other",
  ]),
  description: z.string(),
});
export type Dealbreaker = z.infer<typeof DealbreakerSchema>;

export const DealbreakerHitSchema = z.object({
  dealbreakerId: z.string(),
  dealbreakerText: z.string(),
  evidence: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});
export type DealbreakerHit = z.infer<typeof DealbreakerHitSchema>;

export const DealbreakerScanSchema = z.object({
  hits: z.array(DealbreakerHitSchema),
});
export type DealbreakerScan = z.infer<typeof DealbreakerScanSchema>;

/* ------------------------------------------------------------------ */
/* Quick check — short multiple-choice questions generated from the    */
/* CV to verify it is current, adapted to the detected role            */
/* ------------------------------------------------------------------ */

export const McqQuestionSchema = z.object({
  id: z.string(),
  /** e.g. "SQL", "Visualization", "Leadership" */
  topic: z.string().default(""),
  question: z.string(),
  options: z.array(z.string()).default([]),
  /**
   * single — pick exactly one option;
   * ranked — pick several, click order = priority (1 = highest).
   */
  selectType: z.enum(["single", "ranked"]).default("single"),
  /** Essential to bridge this CV to THIS job — must be answered. */
  required: z.boolean().default(false),
});
export const McqQuestionnaireSchema = z.object({
  questions: z.array(McqQuestionSchema).default([]),
});
export type McqQuestionnaire = z.infer<typeof McqQuestionnaireSchema>;

/** Hard cap on questions a user MUST answer before continuing. */
export const MAX_REQUIRED_QUESTIONS = 10;
/** Soft cap for the dynamically generated question pool. */
export const MAX_MCQ_POOL = 50;

/* ------------------------------------------------------------------ */
/* Dynamic questionnaire                                               */
/* ------------------------------------------------------------------ */

export const QuestionnaireSchema = z.object({
  questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      why: z.string(),
    })
  ),
});
export type Questionnaire = z.infer<typeof QuestionnaireSchema>;

/* ------------------------------------------------------------------ */
/* Tailored CV — generic section model so all templates + the inline   */
/* editor work off one shape                                           */
/* ------------------------------------------------------------------ */

export const CvItemSchema = z.object({
  id: z.string(),
  /** e.g. job title / degree / project name */
  primary: z.string().default(""),
  /** e.g. company / institution */
  secondary: z.string().default(""),
  /** e.g. dates + location */
  meta: z.string().default(""),
  bullets: z.array(z.string()).default([]),
});

export const CvSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  items: z.array(CvItemSchema).default([]),
});

export const TailoredCvSchema = z.object({
  contact: ContactSchema,
  headline: z.string().default(""),
  summary: z.string().default(""),
  sections: z.array(CvSectionSchema).default([]),
  skills: z.array(z.string()).default([]),
});
export type TailoredCv = z.infer<typeof TailoredCvSchema>;

/* ------------------------------------------------------------------ */
/* Diff / Insights report                                              */
/* ------------------------------------------------------------------ */

export const DiffChangeSchema = z.object({
  section: z.string(),
  type: z.enum(["added", "removed", "modified", "reordered"]),
  original: z.string().default(""),
  updated: z.string().default(""),
  reason: z.string().default(""),
});

export const DiffReportSchema = z.object({
  changes: z.array(DiffChangeSchema).default([]),
  gapAnalysis: z
    .object({
      matchScore: z.number().min(0).max(100).default(0),
      strengths: z.array(z.string()).default([]),
      gaps: z.array(z.string()).default([]),
      recommendations: z.array(z.string()).default([]),
    })
    .default({ matchScore: 0, strengths: [], gaps: [], recommendations: [] }),
});
export type DiffReport = z.infer<typeof DiffReportSchema>;

/* Interview simulation — the second deliverable file */
export const InterviewSimulationSchema = z.object({
  /** 30-second elevator pitch aligned to this job, in the candidate's voice */
  pitch: z.string().default(""),
  questions: z
    .array(
      z.object({
        question: z.string(),
        whyTheyAsk: z.string().default(""),
        howToAnswer: z.string().default(""),
        /** How the interviewer asks it — drives the comic illustration. */
        tone: z.enum(["friendly", "curious", "challenging"]).default("curious"),
      })
    )
    .default([]),
});
export type InterviewSimulation = z.infer<typeof InterviewSimulationSchema>;
export type InterviewTone = InterviewSimulation["questions"][number]["tone"];

export const GenerationResultSchema = z.object({
  cv: TailoredCvSchema,
  diff: DiffReportSchema,
  simulation: InterviewSimulationSchema.prefault({}),
  jobTitle: z.string().default(""),
  company: z.string().default(""),
});
export type GenerationResult = z.infer<typeof GenerationResultSchema>;

/* ------------------------------------------------------------------ */
/* Monetization                                                        */
/* ------------------------------------------------------------------ */

/**
 * Payment is the FINAL step: profile + (optionally) job description come
 * first, and the paywall appears right before generating the documents.
 * Tiers that require a job description stay locked until one is added.
 */
export const TIERS = {
  base: {
    name: "Base CV Update",
    priceUsd: 2,
    priceCents: 200,
    maxRevisions: 0,
    requiresJob: false,
    description: "Your old CV rebuilt into an updated, modernized base CV",
    includes: ["Updated & modernized base CV"],
  },
  match: {
    name: "Job Match",
    priceUsd: 3,
    priceCents: 300,
    maxRevisions: 0,
    requiresJob: true,
    description:
      "Base CV + a custom CV tailored to your job + a comparison report",
    includes: [
      "Updated base CV",
      "Custom CV tailored to the job",
      "Comparison report of every change",
    ],
  },
  full: {
    name: "Full Prep",
    priceUsd: 5,
    priceCents: 500,
    maxRevisions: 10,
    requiresJob: true,
    description:
      "Everything in Job Match + an interview simulation report",
    includes: [
      "Everything in Job Match",
      "Interview simulation report",
      "Up to 10 AI revisions",
    ],
  },
} as const;
export type TierId = keyof typeof TIERS;

/** Minimum cosine similarity between original and updated JD on revision */
export const JD_SIMILARITY_THRESHOLD = 0.85;

/**
 * The CV design gallery. All templates share one structured model (see
 * TailoredCv) and print to a single A4 page. The original ten differ in
 * typeface, spacing and color only ("linear" layout); newer designs (from
 * "ledger" on) add structural layouts. Each one can be previewed on a light
 * OR dark background via the global theme toggle — the design itself is
 * background-agnostic. Visual definitions live in
 * src/components/cv-renderer.tsx.
 */
export const CV_TEMPLATES = [
  "classic",
  "modern",
  "compact",
  "executive",
  "elegant",
  "technical",
  "contemporary",
  "minimal",
  "onyx",
  "midnight",
  "ledger",
  "index",
  "masthead",
  "marginalia",
  "panel",
  "columnrule",
  "rail",
  "grid",
  "timeline",
  "specsheet",
  "mono",
] as const;
export type CvTemplate = (typeof CV_TEMPLATES)[number];
