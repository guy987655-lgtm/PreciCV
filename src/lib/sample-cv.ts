import type { TailoredCv } from "@/lib/types";

/**
 * One realistic CV, used wherever the app has to show what a design LOOKS like
 * before the user has a document of their own — the design preview modal on a
 * run, and the /demo pages.
 *
 * Lives in lib rather than under src/app/demo (where it started) because a
 * production component importing from a demo route drags that whole route's
 * module graph into the main bundle. The demo pages re-export it from here.
 *
 * Deliberately dense: three roles with metric-carrying bullets, a full skills
 * list and an education block, so every template is exercised at a realistic
 * length rather than looking roomy because the sample is thin.
 */
export const sampleCv: TailoredCv = {
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
