import { CARD_LINK, GRADE_PRICE_USD, GRADE_REQUEST_URL, PAY_ADDRESS, PAY_URL, REGRADE_PRICE_USD } from "@/lib/links";
import { RequestForm } from "./RequestForm";

export const metadata = { title: "Request a grade · Agent Report Card", alternates: { canonical: "/request/" } };

/** The grade request form for buyers who paid in USDC. No GitHub account needed. */
export default function RequestPage() {
  return (
    <main>
      <section className="cta-panel request-panel">
        <div>
          <h2>Request a grade (paid in USDC)</h2>
          <ol className="pay-steps muted">
            <li>Tell us where to find your agent and what it does.</li>
            <li>
              Pay <strong>${GRADE_PRICE_USD} USDC on Base</strong> (${REGRADE_PRICE_USD} if your agent is already graded) with your wallet in one step, or send it to{" "}
              <a className="mono pay-address" href={PAY_URL}>{PAY_ADDRESS}</a> yourself and paste the transaction.
            </li>
            <li>We check the payment, open your request and reply there with your grade, usually within half an hour.</li>
          </ol>
          {CARD_LINK && (
            <p className="muted">
              No crypto? <a href={CARD_LINK}>Pay ${GRADE_PRICE_USD} by card instead</a>; Stripe asks for your agent's link and you don't need this form.
            </p>
          )}
          <RequestForm />
          <p className="muted small">
            Paying in CCD, or adding a Concordium badge? Use the <a href={GRADE_REQUEST_URL}>GitHub request form</a> instead.
          </p>
        </div>
      </section>
    </main>
  );
}
