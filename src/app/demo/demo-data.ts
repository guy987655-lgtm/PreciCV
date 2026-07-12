import { DealbreakerHit, DiffReport, TailoredCv } from "@/lib/types";

/** Shared mock data for the /demo pages. */

export const demoCv: TailoredCv = {
  hiddenSectionIds: [],
  contact: {
    fullName: "Dana Cohen",
    email: "dana.cohen@email.com",
    phone: "+972-54-123-4567",
    location: "Tel Aviv, Israel",
    linkedin: "linkedin.com/in/danacohen",
    website: "",
  },
  headline: "Senior Frontend Engineer · React & TypeScript",
  summary:
    "Frontend engineer with 7 years building high-scale React applications. Led a 4-person squad that rebuilt a checkout flow serving 2M monthly users, lifting conversion 18%. Deep TypeScript, performance and design-system expertise.",
  sections: [
    {
      id: "exp",
      title: "Experience",
      items: [
        {
          id: "exp-1",
          primary: "Senior Frontend Engineer",
          secondary: "Wixly",
          meta: "2021 – Present · Tel Aviv",
          bullets: [
            "Led migration of a 400-component codebase to TypeScript strict mode, cutting production bugs 35%",
            "Rebuilt checkout flow with React Server Components — 18% conversion lift for 2M monthly users",
            "Mentored 3 junior engineers; ran the frontend guild's performance workshops",
          ],
        },
        {
          id: "exp-2",
          primary: "Frontend Engineer",
          secondary: "Monday Labs",
          meta: "2018 – 2021 · Tel Aviv",
          bullets: [
            "Built the design system used by 40+ engineers across 6 product teams",
            "Cut bundle size 42% via code-splitting and dependency audits",
          ],
        },
        {
          id: "exp-3",
          primary: "Junior Web Developer",
          secondary: "Startup Nation Digital",
          meta: "2017 – 2018 · Herzliya",
          bullets: ["Shipped marketing sites and internal dashboards (React, Node.js)"],
        },
      ],
    },
    {
      id: "edu",
      title: "Education",
      items: [
        {
          id: "edu-1",
          primary: "B.Sc. Computer Science",
          secondary: "Tel Aviv University",
          meta: "2013 – 2017",
          bullets: [],
        },
      ],
    },
  ],
  skills: [
    "React",
    "TypeScript",
    "Next.js",
    "React Server Components",
    "Node.js",
    "GraphQL",
    "Design Systems",
    "Web Performance",
    "Jest / Playwright",
  ],
};

export const demoDiff: DiffReport = {
  changes: [
    {
      section: "Summary",
      type: "modified",
      original:
        "Experienced frontend developer who loves building beautiful web experiences with modern tools.",
      updated:
        "Frontend engineer with 7 years building high-scale React applications. Led a 4-person squad that rebuilt a checkout flow serving 2M monthly users, lifting conversion 18%.",
      reason:
        "The JD emphasizes scale and measurable impact — replaced generic phrasing with quantified achievements.",
    },
    {
      section: "Experience · Wixly",
      type: "added",
      original: "",
      updated:
        "Rebuilt checkout flow with React Server Components — 18% conversion lift for 2M monthly users",
      reason:
        "The JD explicitly requires React Server Components experience; surfaced this achievement from your Master Data Lake.",
    },
    {
      section: "Experience · Freelance 2016",
      type: "removed",
      original: "Freelance WordPress sites for local businesses (2016–2017)",
      updated: "",
      reason:
        "Irrelevant to a senior React role and costs space on a one-page CV.",
    },
    {
      section: "Skills",
      type: "reordered",
      original: "Node.js, React, GraphQL, TypeScript…",
      updated: "React, TypeScript, Next.js, React Server Components…",
      reason: "Reordered to mirror the JD's own priority of requirements (ATS alignment).",
    },
  ],
  gapAnalysis: {
    matchScore: 87,
    strengths: [
      "7 years of React — JD asks for 5+",
      "Direct RSC production experience (JD's top requirement)",
      "Design-system leadership matches the platform-team scope",
    ],
    gaps: [
      "JD mentions React Native — no mobile experience in your profile",
      "No formal team-lead title (you led a squad, but not as a manager)",
    ],
    recommendations: [
      "In the interview, frame the checkout squad as de-facto team leadership",
      "Mention any React Native exposure, even side projects — or be upfront and pivot to your fast-learning track record",
    ],
  },
};

export const demoHits: DealbreakerHit[] = [
  {
    dealbreakerId: "demo-db",
    dealbreakerText: "Remote only — no more than 1 office day per week",
    evidence: "This is a hybrid role: 3 days per week in our Ramat Gan office",
    confidence: "high",
  },
];
