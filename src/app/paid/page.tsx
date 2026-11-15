import { PaidCode } from "./PaidCode";

export const metadata = { title: "Payment received · Agent Report Card" };

/** Where Stripe sends buyers after a card payment (?session={CHECKOUT_SESSION_ID}). */
export default function Paid() {
  return (
    <main>
      <section className="cta-panel">
        <div>
          <h2>Thanks, your payment went through</h2>
          <PaidCode />
        </div>
      </section>
    </main>
  );
}
