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

export const GenerationResultSchema = z.object({
  cv: TailoredCvSchema,
  diff: DiffReportSchema,
  jobTitle: z.string().default(""),
  company: z.string().default(""),
});
export type GenerationResult = z.infer<typeof GenerationResultSchema>;

/* ------------------------------------------------------------------ */
/* Monetization                                                        */
/* ------------------------------------------------------------------ */

export const TIERS = {
  standard: {
    name: "Standard",
    priceUsd: 10,
    priceCents: 1000,
    maxRevisions: 0,
    description: "1x Tailored CV PDF + 1x Insights Report PDF for a single job",
  },
  premium: {
    name: "Premium",
    priceUsd: 15,
    priceCents: 1500,
    maxRevisions: 10,
    description:
      "Standard + up to 10 distinct text revisions locked to the same job",
  },
} as const;
export type TierId = keyof typeof TIERS;

/** Minimum cosine similarity between original and updated JD on revision */
export const JD_SIMILARITY_THRESHOLD = 0.85;

export const CV_TEMPLATES = ["classic", "modern", "compact"] as const;
export type CvTemplate = (typeof CV_TEMPLATES)[number];
