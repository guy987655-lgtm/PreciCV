import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

/**
 * NOTE FOR THE OWNER: payment providers require a reachable refund policy, and
 * a buyer of a $3 digital item wants to see one before paying. The promises
 * here are deliberately ones you can keep by hand at this volume — a failed
 * generation is refunded, everything else is judgment. Not legal advice.
 */
export const metadata: Metadata = {
  title: "Refund Policy — SpeCV",
  description:
    "When SpeCV refunds a purchase, how to ask for one, and how long it takes.",
};

export default function RefundsPage() {
  return (
    <LegalPage title="Refund Policy" updated="27 July 2026">
      <p>
        SpeCV purchases are small, one-off and delivered immediately. The rule is
        simple: <strong>if the product didn&rsquo;t work, you get your money
        back.</strong>
      </p>

      <h2>We refund in full</h2>
      <ul>
        <li>
          The generation failed, or produced an empty or unusable file, and we
          cannot fix it for you.
        </li>
        <li>
          You paid but the paid version never unlocked, and support cannot
          resolve it.
        </li>
        <li>You were charged twice for the same job.</li>
        <li>You were charged for something you did not buy.</li>
      </ul>
      <p>
        In these cases, ask within <strong>30 days</strong> of the purchase.
      </p>

      <h2>We normally do not refund</h2>
      <ul>
        <li>
          A CV that was delivered as described but that you did not like. Use
          the revisions included in your tier, or write to us — we would rather
          fix the output than take your money for nothing.
        </li>
        <li>
          The outcome of your application. We cannot promise interviews or
          offers, and not hearing back from an employer is not a product fault.
        </li>
        <li>
          Purchases where the account shows abuse — bulk generation, resale, or
          working around usage limits.
        </li>
      </ul>
      <p>
        Beyond that, we will use judgment rather than hide behind this page. If
        you feel you paid for something you did not get, say so.
      </p>

      <h2>How to ask</h2>
      <p>
        Email <a href={supportMailto("Refund request")}>{SUPPORT_EMAIL}</a> with
        the email address you paid with, the job title, and one line about what
        went wrong. We reply within 3 business days.
      </p>

      <h2>How the money comes back</h2>
      <p>
        Payments are handled by Lemon Squeezy as seller of record, so approved
        refunds are issued through them to your original payment method.
        Depending on your bank, the money typically appears within 5&ndash;10
        business days.
      </p>

      <h2>Samples</h2>
      <p>
        The sample costs nothing and is watermarked and partly hidden by
        design, so there is nothing to refund. It exists so you can see the real
        quality of the output before paying.
      </p>
    </LegalPage>
  );
}
