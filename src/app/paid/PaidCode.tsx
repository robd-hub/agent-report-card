"use client";
import { useEffect, useState } from "react";
import { GRADE_REQUEST_URL } from "@/lib/links";

const SESSION = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type State = { kind: "checking" } | { kind: "opened"; request: string } | { kind: "manual" } | { kind: "error"; message: string };

/**
 * After a card payment: asks the server (src/server/card.ts) for the grade
 * request Stripe's webhook opened, and opens it here if the webhook is slow.
 * Where there's no server (the GitHub Pages copy), or the payment page didn't
 * ask for the agent's link, it shows the payment code and a request form with
 * the code filled in.
 */
export function PaidCode() {
  const [code, setCode] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("session") ?? "";
    setCode(SESSION.test(s) ? s : "");
  }, []);

  useEffect(() => {
    if (!code) return;
    let stopped = false;
    const started = Date.now();
    const poll = async () => {
      if (stopped) return;
      const waited = Date.now() - started;
      // Give the webhook about 12 seconds to open the request, then open it from here.
      const create = waited > 12_000 ? "&create=1" : "";
      try {
        const res = await fetch(`${BASE}/api/card-order/?session=${encodeURIComponent(code)}${create}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { status?: string; request?: string; error?: string };
        if (stopped) return;
        if (body.status === "opened" && body.request) return setState({ kind: "opened", request: body.request });
        if (body.status === "invalid") return setState({ kind: "error", message: body.error ?? "We couldn't check that payment." });
        if (!res.ok || body.status === "manual" || waited > 90_000) return setState({ kind: "manual" });
      } catch {
        return setState({ kind: "manual" });
      }
      setTimeout(poll, 3_000);
    };
    poll();
    return () => {
      stopped = true;
    };
  }, [code]);

  if (code === null) return null;
  if (!code) {
    return <p className="muted">We couldn't find a payment code in this link. If you paid, reply to your Stripe receipt and we'll sort it out.</p>;
  }
  if (state.kind === "checking") {
    return <p>Opening your grade request, this takes a few seconds…</p>;
  }
  if (state.kind === "opened") {
    return (
      <>
        <p>Your grade request is open. The grader replies there with your grade, report page and badge, usually within half an hour.</p>
        <div className="cta-row">
          <a className="btn btn-primary" href={state.request}>See your grade request →</a>
        </div>
        <p className="muted">
          Bookmark that link. Your payment code is <span className="mono">{code}</span>; keep it in case you need to contact us.
        </p>
      </>
    );
  }
  const request = `${GRADE_REQUEST_URL}&payment=${encodeURIComponent(code)}`;
  return (
    <>
      {state.kind === "error" && <p className="muted">{state.message}</p>}
      <p>Your payment code:</p>
      <pre className="mono">{code}</pre>
      <div className="cta-row">
        <a className="btn btn-primary" href={request}>Request your grade →</a>
      </div>
      <p className="muted">The request form opens with the code already filled in. Add your agent's link and what it does, and submit. Keep the code: it's how we match your payment.</p>
    </>
  );
}
