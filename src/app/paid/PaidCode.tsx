"use client";
import { useEffect, useState } from "react";
import { GRADE_REQUEST_URL } from "@/lib/links";

/** Shows the Stripe checkout id from the URL, and a request link with it already filled in. */
export function PaidCode() {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("session") ?? "";
    setCode(/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(s) ? s : "");
  }, []);
  if (code === null) return null;
  if (!code) {
    return <p className="muted">We couldn't find a payment code in this link. If you paid, reply to your Stripe receipt and we'll sort it out.</p>;
  }
  const request = `${GRADE_REQUEST_URL}&payment=${encodeURIComponent(code)}`;
  return (
    <>
      <p>Your payment code:</p>
      <pre className="mono">{code}</pre>
      <div className="cta-row">
        <a className="btn btn-primary" href={request}>Request your grade →</a>
      </div>
      <p className="muted">The request form opens with the code already filled in. Add your agent's link and what it does, and submit. Keep the code: it's how we match your payment.</p>
    </>
  );
}
