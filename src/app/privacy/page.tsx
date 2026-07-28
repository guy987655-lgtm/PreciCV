import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { SUPPORT_EMAIL } from "@/lib/support";

/**
 * NOTE FOR THE OWNER: this is a plain-language policy written to match what
 * the code actually does (see the sub-processor list below — keep it in sync
 * if a provider changes). It is not legal advice; have a lawyer review it
 * before you market the product in the EU/UK.
 */
export const metadata: Metadata = {
  title: "Privacy Policy — SpeCV",
  description:
    "What SpeCV collects, where it is stored, who processes it, and how to delete it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="27 July 2026">
      <p>
        SpeCV (&ldquo;we&rdquo;) turns your CV and a job description into a
        tailored one-page CV. This page explains exactly what that involves for
        your data. Questions or requests:{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your CV and your answers.</strong> The file you upload, the
          text extracted from it, and the answers you give in the questionnaire.
        </li>
        <li>
          <strong>Job descriptions</strong> you paste, and the CVs, comparison
          reports and interview questions we generate from them.
        </li>
        <li>
          <strong>Account details</strong> if you sign in: your email address
          and name, received from Google or GitHub through our authentication
          provider. We never receive your password.
        </li>
        <li>
          <strong>Purchase records</strong> — which tier you bought, for which
          job, the amount, and the payment provider&rsquo;s order reference.{" "}
          <strong>We never see or store your card details.</strong>
        </li>
        <li>
          <strong>Basic usage data</strong> — aggregate page and event
          analytics, plus standard server logs (IP address, browser, timestamps)
          which we also use to enforce usage limits and prevent abuse.
        </li>
      </ul>

      <h2>Where it is stored</h2>
      <p>
        <strong>Before you sign in, your CV data stays in your browser.</strong>{" "}
        The trial flow keeps your profile in your browser&rsquo;s local storage
        and does not save it on our servers — clearing your browser data erases
        it. The text is still sent to our AI provider for processing while a CV
        is being generated (see below).
      </p>
      <p>
        Once you have an account, your profile, jobs, generated CVs and
        purchases are stored in our database with row-level security, so rows
        are readable only by the account that owns them.
      </p>

      <h2>Who else processes it</h2>
      <p>
        We use a small number of service providers, and only to run the product:
      </p>
      <ul>
        <li>
          <strong>Supabase</strong> — database and sign-in.
        </li>
        <li>
          <strong>Vercel</strong> — hosting and aggregate traffic analytics.
        </li>
        <li>
          <strong>Anthropic (Claude) and/or Google (Gemini)</strong> — the AI
          models that read your CV and the job description and write the
          tailored output. Your text is sent to them to produce your result.
        </li>
        <li>
          <strong>Lemon Squeezy</strong> — payments. They are the seller of
          record and handle your card details under their own privacy policy.
        </li>
      </ul>
      <p>
        We do not sell your data, and we do not use your CV to train AI models.
        Processing may take place in countries other than yours, including the
        United States.
      </p>

      <h2>Cookies</h2>
      <p>
        We use a session cookie to keep you signed in, and a signed cookie that
        counts generations so usage limits can be enforced. Both are
        necessary for the service to work; neither is used for advertising and
        we do not sell cookie data to anyone.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Account data is kept while your account exists, so you can return to a
        past application. Purchase records are kept as long as required for tax
        and accounting purposes. Delete your account and everything else goes
        with it.
      </p>

      <h2>Your rights</h2>
      <p>
        You can access, correct, export or delete your data at any time.{" "}
        <strong>
          Settings &rarr; &ldquo;Delete My Account &amp; Data&rdquo;
        </strong>{" "}
        removes your profile, jobs, answers and generated CVs permanently and
        immediately. For anything you cannot do yourself — a copy of your data,
        a correction, or an objection to how we process it — write to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will
        answer within 30 days.
      </p>

      <h2>Children</h2>
      <p>
        SpeCV is not intended for anyone under 16. We do not knowingly collect
        data from children.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy we will update the date at the top of this
        page, and tell signed-in users by email when the change is significant.
      </p>
    </LegalPage>
  );
}
