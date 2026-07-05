import { FunnelState, McqAnswer } from "./funnel";
import { McqQuestionnaire } from "./types";

type MockQ = McqQuestionnaire["questions"][number];

const EXP_OPTS = [
  "Use it daily",
  "Used it in past roles",
  "Basic familiarity",
  "No experience",
];

/** 25-question mock pool across 5 topical categories (UI/UX phase). */
function q(
  id: string,
  topic: string,
  question: string,
  options: string[] = EXP_OPTS,
  selectType: "single" | "ranked" = "single"
): MockQ {
  return { id, topic, question, options, selectType, required: false };
}

const MOCK_POOL: MockQ[] = [
  // --- SQL ---
  q("sql1", "SQL", "Which SQL flavors do you use? Rank by usage.", ["PostgreSQL", "MySQL", "BigQuery", "SQL Server", "None of these"], "ranked"),
  q("sql2", "SQL", "How comfortable are you with window functions?"),
  q("sql3", "SQL", "Do you write CTE-heavy analytical queries?"),
  q("sql4", "SQL", "Have you optimized slow queries in production?"),
  q("sql5", "SQL", "Experience with stored procedures?"),
  // --- Visualization ---
  q("viz1", "Visualization", "Which viz tool do you still use weekly?", ["Tableau", "Power BI", "Looker"]),
  q("viz2", "Visualization", "Have you built executive-facing dashboards?"),
  q("viz3", "Visualization", "Do you design self-serve analytics for other teams?"),
  q("viz4", "Visualization", "Experience with embedded analytics?"),
  q("viz5", "Visualization", "Which charting libraries have you used?", ["Plotly", "matplotlib", "D3.js", "ggplot2"], "ranked"),
  // --- Databases ---
  q("db1", "Databases", "Is Snowflake still part of your stack?", ["Yes, daily", "Occasionally", "Not anymore"]),
  q("db2", "Databases", "Experience with dbt for transformations?"),
  q("db3", "Databases", "Have you designed data models / schemas?"),
  q("db4", "Databases", "Worked with streaming data (Kafka, Kinesis)?"),
  q("db5", "Databases", "Which cloud warehouses have you used?", ["Snowflake", "BigQuery", "Redshift", "Databricks"], "ranked"),
  // --- Analytics & Stats ---
  q("st1", "Analytics", "Do you run A/B tests end-to-end?"),
  q("st2", "Analytics", "Comfort level with statistical significance testing?"),
  q("st3", "Analytics", "Have you built forecasting models?"),
  q("st4", "Analytics", "Experience with Python for analysis (pandas)?"),
  q("st5", "Analytics", "Have you defined company KPIs from scratch?"),
  // --- Leadership ---
  q("ld1", "Leadership", "How many people do you currently manage?", ["None", "1-3", "4-10", "10+"]),
  q("ld2", "Leadership", "Do you own stakeholder communication?"),
  q("ld3", "Leadership", "Have you mentored junior analysts?"),
  q("ld4", "Leadership", "Experience presenting to C-level executives?"),
  q("ld5", "Leadership", "Have you led cross-functional projects?"),
];

// First 6 questions are the "required" set the launch flow gates on.
for (const mq of MOCK_POOL.slice(0, 6)) mq.required = true;

/** 21 of 25 answered — required set fully covered, 4 left as suggestions. */
const MOCK_MCQ_ANSWERS: Record<string, McqAnswer> = Object.fromEntries(
  MOCK_POOL.slice(0, 21).map((mq) => [
    mq.id,
    {
      selected:
        mq.selectType === "ranked"
          ? mq.options.slice(0, 2)
          : [mq.options[0]],
    },
  ])
);

/**
 * DEV/TEST ONLY — mock data injected by the User Status Selector so each
 * simulated state lands on a realistic, fully-populated experience.
 */

const MOCK_JD =
  "We are looking for a Senior Data Analyst to join our analytics team. " +
  "Requirements: 5+ years of SQL (PostgreSQL/BigQuery), dashboarding with " +
  "Tableau or Power BI, experience with cloud data warehouses such as " +
  "Snowflake, and dbt for transformation. You will lead a small team of " +
  "analysts, own stakeholder reporting, and drive experimentation and A/B " +
  "test analysis across product and marketing.";

export function mockFunnelState(opts?: { withJob?: boolean }): FunnelState {
  return {
    step: "gate",
    profile: {
      contact: {
        fullName: "Dana Levi",
        email: "dana@example.com",
        phone: "+972-50-000-0000",
        location: "Tel Aviv, Israel",
        linkedin: "linkedin.com/in/danalevi",
        website: "",
      },
      headline: "Senior Data Analyst",
      summary:
        "Data analyst with 6 years of experience turning messy data into " +
        "clear product and business decisions.",
      experience: [
        {
          company: "Acme",
          title: "Senior Data Analyst",
          location: "Tel Aviv",
          startDate: "2021",
          endDate: "",
          current: true,
          bullets: [
            "Built the company-wide KPI dashboard suite in Tableau",
            "Led a squad of 4 analysts across product and marketing",
          ],
          technologies: ["SQL", "Tableau", "Snowflake"],
        },
        {
          company: "Beta Labs",
          title: "Data Analyst",
          location: "Tel Aviv",
          startDate: "2018",
          endDate: "2021",
          current: false,
          bullets: ["Owned weekly executive reporting and cohort analyses"],
          technologies: ["SQL", "Python"],
        },
      ],
      education: [
        {
          institution: "Tel Aviv University",
          degree: "B.Sc.",
          field: "Statistics",
          startYear: "2014",
          endYear: "2017",
          notes: "",
        },
      ],
      skills: ["SQL", "Python", "Tableau", "Power BI", "dbt", "Snowflake"],
      certifications: [],
      languages: ["Hebrew", "English"],
      projects: [],
      originalSectionOrder: ["summary", "experience", "skills", "education"],
      additionalFacts: [],
    },
    rawText: "(mock raw CV text)",
    questionnaire: {
      questions: [
        {
          id: "q1",
          question: "How large was the team you led at Acme?",
          why: "Team size signals scope.",
        },
        {
          id: "q2",
          question: "What business impact did your dashboards have?",
          why: "Metrics strengthen bullets.",
        },
      ],
    },
    mcq: { questions: MOCK_POOL },
    mcqAnswers: MOCK_MCQ_ANSWERS,
    answers: { q1: "A squad of 4 analysts" },
    roleQuestionsLoaded: true,
    mcqIndex: 0,
    // The launch flow requires a job upfront — mocks always carry one.
    jdText: opts?.withJob === false ? "" : MOCK_JD,
    savedAt: Date.now(),
  };
}
